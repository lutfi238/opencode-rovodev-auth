# Output Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a balanced runtime output guard that suppresses strong internal Rovo work-log narration before it reaches OpenCode users.

**Architecture:** Add one small text-focused module under `src/runtime/session/` that owns narration detection, leading-text buffering, and cleanup. Wire it into both chat and Responses handlers so streaming and non-streaming paths share the same behavior while leaving backend transport and request normalization unchanged.

**Tech Stack:** TypeScript, ESM, Bun runtime entrypoint, Node-based smoke checks, existing runtime modules under `src/runtime/`

---

## File Structure

- Create: `src/runtime/session/output-guard.ts`
  - Own balanced narration heuristics, streaming guard state, and non-stream cleanup.
- Modify: `src/runtime/openai/chat.ts`
  - Apply the guard to streaming deltas and non-streaming final text.
- Modify: `src/runtime/openai/responses.ts`
  - Apply the same guard to streaming Responses events and non-streaming final text.
- Modify: `src/runtime/diagnostics/logger.ts`
  - Add a small helper for concise output-guard warning logs, or reuse `logWarning()` consistently.
- Modify: `README.md`
  - Document that the runtime now suppresses strong internal-agent narration heuristically.

No new formal test runner is required for this task. Verification will use `npm run typecheck`, `npm run build`, and targeted Node smoke commands against built runtime modules.

### Task 1: Build Output Guard Module

**Files:**
- Create: `src/runtime/session/output-guard.ts`
- Modify: `src/runtime/diagnostics/logger.ts`

- [ ] **Step 1: Create the guard module with explicit types and pure helpers**

Create `src/runtime/session/output-guard.ts` with a small API that keeps OpenAI envelopes out of the module:

```ts
export type OutputGuardDecision = {
  shouldSuppressLeadingNarration: boolean;
  cleanedText: string;
  suppressedPrefix: string;
};

export type StreamingOutputGuard = {
  push(delta: string): { emitText: string; suppressedText: string };
  finish(): { emitText: string; suppressedText: string };
};

const STRONG_NARRATION_PATTERNS = [
  /\blet me review\b/i,
  /\blet me look\b/i,
  /\blet me inspect\b/i,
  /\bnow let me\b/i,
  /\bi can see there'?s already\b/i,
  /\blook at the source files\b/i,
  /\bcomplete picture before\b/i,
  /\bupdating agents\.md\b/i,
];
```

- [ ] **Step 2: Implement balanced narration detection as a pure text function**

Implement a helper that only strips a leading internal preamble when multiple strong signals appear near the start of the text:

```ts
function normalizeGuardText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function looksLikeInternalNarrationStart(text: string): boolean {
  const normalized = normalizeGuardText(text).slice(0, 400);
  const matchCount = STRONG_NARRATION_PATTERNS.filter((pattern) =>
    pattern.test(normalized),
  ).length;

  const mentionsRepoInspection =
    /\b(workspace|codebase|source files|runtime files|agents\.md)\b/i.test(normalized);

  return matchCount >= 2 || (matchCount >= 1 && mentionsRepoInspection);
}
```

- [ ] **Step 3: Implement non-stream cleanup for full-text responses**

Implement a helper that removes only the leading narration block and leaves the rest untouched:

```ts
export function cleanOutputText(text: string): OutputGuardDecision {
  if (!text.trim()) {
    return {
      shouldSuppressLeadingNarration: false,
      cleanedText: text,
      suppressedPrefix: "",
    };
  }

  const splitIndex = text.search(/(?<=[.!?])\s+(?=[A-Z0-9`])/);
  const candidatePrefix = splitIndex === -1 ? text : text.slice(0, splitIndex).trim();

  if (!looksLikeInternalNarrationStart(candidatePrefix)) {
    return {
      shouldSuppressLeadingNarration: false,
      cleanedText: text,
      suppressedPrefix: "",
    };
  }

  const cleanedText = splitIndex === -1 ? "" : text.slice(splitIndex).trimStart();
  return {
    shouldSuppressLeadingNarration: true,
    cleanedText,
    suppressedPrefix: candidatePrefix,
  };
}
```

- [ ] **Step 4: Implement streaming guard state with a small leading buffer**

Add a factory that buffers the beginning of the stream until the guard decides whether to suppress or release it:

```ts
export function createOutputGuard(): StreamingOutputGuard {
  let leadingBuffer = "";
  let released = false;
  let suppressing = false;

  return {
    push(delta) {
      if (released) {
        return { emitText: delta, suppressedText: "" };
      }

      leadingBuffer += delta;

      if (!suppressing && looksLikeInternalNarrationStart(leadingBuffer)) {
        suppressing = true;
      }

      if (!suppressing && leadingBuffer.length < 240 && !/[.!?]\s/.test(leadingBuffer)) {
        return { emitText: "", suppressedText: "" };
      }

      if (suppressing) {
        const decision = cleanOutputText(leadingBuffer);
        if (!decision.cleanedText && leadingBuffer.length < 400) {
          return { emitText: "", suppressedText: "" };
        }

        released = true;
        leadingBuffer = "";
        return {
          emitText: decision.cleanedText,
          suppressedText: decision.suppressedPrefix,
        };
      }

      released = true;
      const emitText = leadingBuffer;
      leadingBuffer = "";
      return { emitText, suppressedText: "" };
    },

    finish() {
      if (released || !leadingBuffer) {
        return { emitText: "", suppressedText: "" };
      }

      released = true;
      const decision = cleanOutputText(leadingBuffer);
      leadingBuffer = "";
      return {
        emitText: decision.cleanedText,
        suppressedText: decision.suppressedPrefix,
      };
    },
  };
}
```

- [ ] **Step 5: Add concise warning logging for suppressed narration**

Update `src/runtime/diagnostics/logger.ts` to keep warning logs short:

```ts
export function summarizeTextPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}
```

Use this for output-guard warnings instead of logging full raw text.

- [ ] **Step 6: Verify the module compiles cleanly**

Run: `npm run typecheck`

Expected: command exits successfully with no TypeScript errors.

### Task 2: Wire Guard Into Chat And Responses Handlers

**Files:**
- Modify: `src/runtime/openai/chat.ts`
- Modify: `src/runtime/openai/responses.ts`
- Modify: `src/runtime/diagnostics/logger.ts`
- Modify: `src/runtime/session/output-guard.ts`

- [ ] **Step 1: Apply streaming guard in chat completions**

In `src/runtime/openai/chat.ts`, instantiate one guard per streaming response and pass parsed text through it before building completion chunks:

```ts
const outputGuard = createOutputGuard();
```

Inside the streaming line processor, replace direct emission with guarded emission:

```ts
if (chunk.text) {
  const guarded = outputGuard.push(chunk.text);

  if (guarded.suppressedText) {
    logWarning(
      "proxy",
      `suppressed internal narration: ${summarizeTextPreview(guarded.suppressedText)}`,
    );
  }

  if (guarded.emitText) {
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify(
          buildChatCompletionChunk({
            id: chatId,
            created: timestamp,
            model,
            content: guarded.emitText,
          }),
        )}\n\n`,
      ),
    );
  }
}
```

- [ ] **Step 2: Flush any remaining guarded text at chat stream end**

In `flush(controller)`, release any final cleaned text before sending the terminal stop chunk:

```ts
const finalGuarded = outputGuard.finish();
if (finalGuarded.suppressedText) {
  logWarning(
    "proxy",
    `suppressed internal narration: ${summarizeTextPreview(finalGuarded.suppressedText)}`,
  );
}
if (finalGuarded.emitText) {
  controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify(
        buildChatCompletionChunk({
          id: chatId,
          created: timestamp,
          model,
          content: finalGuarded.emitText,
        }),
      )}\n\n`,
    ),
  );
}
```

- [ ] **Step 3: Apply non-stream guard in chat completions**

In `handleNonStreamingCompletion()`, clean the final concatenated text before returning it:

```ts
const decision = cleanOutputText(content);
if (decision.suppressedPrefix) {
  logWarning(
    "proxy",
    `suppressed internal narration: ${summarizeTextPreview(decision.suppressedPrefix)}`,
  );
}
content = decision.cleanedText;
```

- [ ] **Step 4: Apply the same streaming guard in Responses API**

In `src/runtime/openai/responses.ts`, create one guard per streaming response and guard `response.output_text.delta` emission:

```ts
const outputGuard = createOutputGuard();
```

Before emitting `response.output_text.delta`, replace raw text with guarded text and only append cleaned text to `fullText`:

```ts
if (parsed.text) {
  const guarded = outputGuard.push(parsed.text);

  if (guarded.suppressedText) {
    logWarning(
      "proxy",
      `suppressed internal narration: ${summarizeTextPreview(guarded.suppressedText)}`,
    );
  }

  if (guarded.emitText) {
    fullText += guarded.emitText;
    emit(controller, "response.output_text.delta", {
      ...buildResponsesOutputTextDelta({
        itemId,
        outputIndex: 0,
        contentIndex: 0,
        delta: guarded.emitText,
      }),
    });
  }
}
```

- [ ] **Step 5: Flush remaining guarded text in Responses API**

At the end of the stream, release buffered text before `response.output_text.done` and `response.completed`:

```ts
const finalGuarded = outputGuard.finish();
if (finalGuarded.suppressedText) {
  logWarning(
    "proxy",
    `suppressed internal narration: ${summarizeTextPreview(finalGuarded.suppressedText)}`,
  );
}
if (finalGuarded.emitText) {
  fullText += finalGuarded.emitText;
  emit(controller, "response.output_text.delta", {
    ...buildResponsesOutputTextDelta({
      itemId,
      outputIndex: 0,
      contentIndex: 0,
      delta: finalGuarded.emitText,
    }),
  });
}
```

- [ ] **Step 6: Apply non-stream guard in Responses API**

In `handleNonStreamingResponses()`, clean the final `content` string before building the JSON response:

```ts
const decision = cleanOutputText(content);
if (decision.suppressedPrefix) {
  logWarning(
    "proxy",
    `suppressed internal narration: ${summarizeTextPreview(decision.suppressedPrefix)}`,
  );
}
content = decision.cleanedText;
```

- [ ] **Step 7: Verify wiring and build output**

Run: `npm run typecheck && npm run build`

Expected: both commands pass successfully.

### Task 3: Document And Smoke-Verify Balanced Guard Behavior

**Files:**
- Modify: `README.md`
- Modify: `src/runtime/session/output-guard.ts`
- Modify: `src/runtime/openai/chat.ts`
- Modify: `src/runtime/openai/responses.ts`

- [ ] **Step 1: Update README with the new guard behavior**

Add a short section to `README.md` describing that the runtime now heuristically suppresses strong internal-agent narration at the beginning of a response, while leaving normal answers unchanged.

Example text to add:

```md
### Output Guard

The runtime applies a balanced output guard before returning text to OpenCode clients.
It is designed to suppress strong internal Rovo work-log narration such as repository-inspection preambles while preserving normal assistant answers. The guard is heuristic and conservative: it trims only strong leading narration signals and does not rewrite the remaining answer.
```

- [ ] **Step 2: Smoke-check non-stream chat cleanup against built output**

Run this command from the repo root after `npm run build`:

```bash
node --input-type=module -e "import assert from 'node:assert/strict'; import { handleChatCompletionsRequest } from './dist/runtime/openai/chat.js'; const driver = { async sendTurn() { return new Response('data: {\"event_kind\":\"part_start\",\"part\":{\"part_kind\":\"text\",\"content\":\"Let me review the codebase first. Now let me look at AGENTS.md. Final answer starts here.\"}}\n\n'); }, getCapabilities() { return { toolCalling: false, nativeToolCalling: false, multimodalInput: false, accurateUsage: false, parallelRequests: false, sessionIsolation: false }; }, getBaseUrl() { return 'http://localhost:8123'; }, checkHealth() { return Promise.resolve(true); } }; const response = await handleChatCompletionsRequest({ messages: [{ role: 'user', content: 'hi' }], stream: false }, driver); const json = await response.json(); assert.equal(response.status, 200); assert.equal(json.choices[0].message.content.includes('Let me review'), false); console.log('smoke: chat guard ok');"
```

Expected: prints `smoke: chat guard ok`.

- [ ] **Step 3: Smoke-check non-stream normal answer passthrough**

Run:

```bash
node --input-type=module -e "import assert from 'node:assert/strict'; import { handleChatCompletionsRequest } from './dist/runtime/openai/chat.js'; const driver = { async sendTurn() { return new Response('data: {\"event_kind\":\"part_start\",\"part\":{\"part_kind\":\"text\",\"content\":\"Ini jawaban langsung tanpa narasi internal.\"}}\n\n'); }, getCapabilities() { return { toolCalling: false, nativeToolCalling: false, multimodalInput: false, accurateUsage: false, parallelRequests: false, sessionIsolation: false }; }, getBaseUrl() { return 'http://localhost:8123'; }, checkHealth() { return Promise.resolve(true); } }; const response = await handleChatCompletionsRequest({ messages: [{ role: 'user', content: 'hi' }], stream: false }, driver); const json = await response.json(); assert.equal(json.choices[0].message.content, 'Ini jawaban langsung tanpa narasi internal.'); console.log('smoke: passthrough ok');"
```

Expected: prints `smoke: passthrough ok`.

- [ ] **Step 4: Smoke-check Responses narration-only cleanup**

Run:

```bash
node --input-type=module -e "import assert from 'node:assert/strict'; import { handleResponsesRequest } from './dist/runtime/openai/responses.js'; const driver = { async sendTurn() { return new Response('data: {\"event_kind\":\"part_start\",\"part\":{\"part_kind\":\"text\",\"content\":\"Let me inspect the runtime files before updating AGENTS.md.\"}}\n\n'); }, getCapabilities() { return { toolCalling: false, nativeToolCalling: false, multimodalInput: false, accurateUsage: false, parallelRequests: false, sessionIsolation: false }; }, getBaseUrl() { return 'http://localhost:8123'; }, checkHealth() { return Promise.resolve(true); } }; const response = await handleResponsesRequest({ input: 'hi', stream: false }, driver); const json = await response.json(); assert.equal(response.status, 200); assert.equal(json.output[0].content[0].text, ''); console.log('smoke: responses guard ok');"
```

Expected: prints `smoke: responses guard ok`.

- [ ] **Step 5: Final verification**

Run: `npm run typecheck && npm run build`

Expected: both commands pass after README and runtime updates.

## Self-Review

### Spec coverage

- Balanced mode: covered by Task 1 heuristics and stateful guard.
- Streaming and non-streaming support: covered by Task 2 and Task 3 smoke checks.
- Shared behavior across chat and Responses: covered by Task 2.
- Concise warning logs: covered by Task 1 and Task 2.
- No backend transport changes: preserved because all tasks touch runtime output shaping only.

No uncovered spec requirement remains.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- All commands, file paths, and helper names are concrete.

### Type consistency

- `createOutputGuard()` and `cleanOutputText()` are introduced once and reused consistently.
- Logging helper name is consistent as `summarizeTextPreview()`.
- Guard return shape is consistent as `{ emitText, suppressedText }` for streaming.
