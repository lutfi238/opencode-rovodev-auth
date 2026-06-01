# Rovo OpenCode V2 Phase 1-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the current Rovo proxy into a modular local compatibility runtime, keep the existing `serve` path working, and move more OpenCode-facing behavior into our own runtime layer.

**Architecture:** Introduce a thin OpenCode plugin, a local runtime server with OpenAI-compatible handlers, a session/runtime layer that owns normalization and response shaping, and a `RovoServeDriver` that isolates all `acli rovodev serve` behavior behind a backend interface. Keep `rovodev-proxy.ts` working as a bootstrap-compatible entry while progressively delegating logic into `src/runtime/*` modules.

**Tech Stack:** TypeScript, ESM, `@opencode-ai/plugin`, Node 20+, Bun runtime for the local server bootstrap, Web `Request`/`Response`/`Headers`, `TransformStream`, optional Node built-in test runner if tests are added.

---

## File Structure Map

**Create:**
- `src/runtime/backend/types.ts` - backend request/event/capability contracts
- `src/runtime/backend/rovo-serve-driver.ts` - adapter from runtime contract to `rovodev serve`
- `src/runtime/diagnostics/logger.ts` - centralized runtime logging helpers
- `src/runtime/openai/chat.ts` - `/v1/chat/completions` handlers
- `src/runtime/openai/models.ts` - `/v1/models` handler
- `src/runtime/openai/responses.ts` - `/v1/responses` handlers
- `src/runtime/policy/capability-policy.ts` - backend capability declarations and fallback policy
- `src/runtime/policy/model-policy.ts` - model id normalization and exposure rules
- `src/runtime/server.ts` - main local runtime HTTP server factory and routing
- `src/runtime/session/message-compiler.ts` - request normalization and prompt compilation
- `src/runtime/session/response-builder.ts` - OpenAI/Responses response shaping helpers
- `src/runtime/session/session-store.ts` - local session state abstraction
- `src/runtime/stream/sse-mapper.ts` - translate backend events into OpenAI/Responses SSE events
- `src/runtime/stream/sse-parser.ts` - parse upstream SSE chunks into driver-neutral events

**Modify:**
- `src/plugin.ts` - keep thin; route requests to the runtime surface only
- `rovodev-proxy.ts` - delegate to `src/runtime/*` modules instead of owning all logic inline
- `tsconfig.json` - include new runtime modules if needed
- `package.json` - only if a test script is added
- `README.md` - update architecture and entrypoint docs after the refactor stabilizes

**Test (if added in this phase):**
- `test/runtime/message-compiler.test.ts`
- `test/runtime/response-builder.test.ts`
- `test/runtime/sse-parser.test.ts`

### Task 1: Create Runtime Contracts And Session Scaffolding

**Files:**
- Create: `src/runtime/backend/types.ts`
- Create: `src/runtime/session/session-store.ts`
- Create: `src/runtime/session/message-compiler.ts`
- Create: `src/runtime/policy/model-policy.ts`
- Create: `src/runtime/policy/capability-policy.ts`

- [ ] **Step 1: Create backend types contract**

```ts
export type RuntimeMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

export type BackendCapabilities = {
  trueModelSelection: boolean;
  multimodalInput: boolean;
  nativeToolCalling: boolean;
  concurrentSessions: boolean;
  accurateUsage: boolean;
  resumableResponses: boolean;
};

export type BackendTurnRequest = {
  sessionId: string;
  model: string;
  messages: RuntimeMessage[];
  stream: boolean;
};

export type BackendTurnEvent =
  | { type: "text-delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "completed"; finishReason: string }
  | { type: "error"; message: string; status?: number };

export interface BackendDriver {
  getCapabilities(): BackendCapabilities;
  sendTurn(request: BackendTurnRequest): Promise<Response | ReadableStream<Uint8Array>>;
}
```

- [ ] **Step 2: Create minimal session-store interface**

```ts
import type { RuntimeMessage } from "../backend/types.js";

export type RuntimeSession = {
  id: string;
  messages: RuntimeMessage[];
};

export interface SessionStore {
  get(sessionId: string): RuntimeSession;
  replace(sessionId: string, messages: RuntimeMessage[]): RuntimeSession;
  append(sessionId: string, message: RuntimeMessage): RuntimeSession;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, RuntimeSession>();
  // Fill methods in implementation task.
}
```

- [ ] **Step 3: Move request normalization into message-compiler**

```ts
export function extractTextFromContentPart(part: unknown): string {
  // Move the current extraction logic here unchanged first.
}

export function extractTextFromMessageContent(content: unknown): string {
  // Move the current extraction logic here unchanged first.
}

export function parseResponsesAPIInput(body: any): RuntimeMessage[] {
  // Move the current parser here unchanged first.
}

export function normalizeIncomingMessages(body: any): RuntimeMessage[] {
  // Move the current normalization here unchanged first.
}

export function formatMessages(messages: RuntimeMessage[]): string {
  // Move the current prompt compiler here unchanged first.
}
```

- [ ] **Step 4: Add model and capability policies**

```ts
export const DEFAULT_MODEL = "rovodev-auto";

export function normalizeRequestedModel(model: unknown): string {
  return typeof model === "string" && model ? model : DEFAULT_MODEL;
}
```

```ts
import type { BackendCapabilities } from "../backend/types.js";

export const ROVO_SERVE_CAPABILITIES: BackendCapabilities = {
  trueModelSelection: false,
  multimodalInput: false,
  nativeToolCalling: false,
  concurrentSessions: false,
  accurateUsage: false,
  resumableResponses: false,
};
```

- [ ] **Step 5: Verify the extracted scaffolding compiles**

Run: `npm run typecheck`
Expected: PASS with no TypeScript errors after creating the new modules and imports.

### Task 2: Extract SSE Parsing, Mapping, And Diagnostics

**Files:**
- Create: `src/runtime/stream/sse-parser.ts`
- Create: `src/runtime/stream/sse-mapper.ts`
- Create: `src/runtime/diagnostics/logger.ts`
- Modify: `rovodev-proxy.ts`

- [ ] **Step 1: Move SSE line parsing out of the legacy proxy**

```ts
export type ParsedSSEChunk =
  | { type: "data"; payload: any }
  | { type: "done" };

export function parseSSELines(lines: string[]): ParsedSSEChunk[] {
  // Move blank-line skipping, comment skipping, JSON parsing, and [DONE] handling here.
}
```

- [ ] **Step 2: Move text extraction and end detection helpers into stream modules**

```ts
export function extractBackendText(data: any): string | null {
  // Move current extractText logic here.
}

export function isBackendStreamEnd(data: any): boolean {
  // Move current isStreamEnd logic here.
}
```

- [ ] **Step 3: Build reusable mappers for Chat Completions and Responses SSE**

```ts
export function buildChatCompletionChunk(args: {
  id: string;
  created: number;
  model: string;
  text: string;
}) {
  return {
    id: args.id,
    object: "chat.completion.chunk",
    created: args.created,
    model: args.model,
    choices: [{ index: 0, delta: { content: args.text }, finish_reason: null }],
  };
}
```

```ts
export function buildResponsesDeltaEvent(/* shape */) {
  // Move the response.output_text.delta builder here.
}
```

- [ ] **Step 4: Centralize runtime logs**

```ts
export function logRequestSummary(scope: string, summary: string): void {
  console.log(`[runtime] ${scope} | ${summary}`);
}

export function logWarning(scope: string, message: string): void {
  console.warn(`[runtime] ${scope} | ${message}`);
}
```

- [ ] **Step 5: Replace duplicated inline parsing calls in `rovodev-proxy.ts` with imports**

```ts
import {
  parseSSELines,
  extractBackendText,
  isBackendStreamEnd,
} from "./src/runtime/stream/sse-parser.js";
```

- [ ] **Step 6: Verify the extraction compiles without behavior change**

Run: `npm run typecheck`
Expected: PASS with the legacy proxy still compiling after imports are rewired.

### Task 3: Introduce The `RovoServeDriver`

**Files:**
- Create: `src/runtime/backend/rovo-serve-driver.ts`
- Modify: `rovodev-proxy.ts`
- Modify: `src/runtime/backend/types.ts`

- [ ] **Step 1: Move raw Rovo Dev transport helpers into the driver**

```ts
export class RovoServeDriver implements BackendDriver {
  constructor(
    private readonly baseUrl: string,
    private readonly capabilities = ROVO_SERVE_CAPABILITIES,
  ) {}

  getCapabilities(): BackendCapabilities {
    return this.capabilities;
  }

  async sendTurn(request: BackendTurnRequest): Promise<Response> {
    const prompt = formatMessages(request.messages);
    return sendAndStream(prompt);
  }
}
```

- [ ] **Step 2: Move queue, idle-wait, and retry behavior into driver-local helpers**

```ts
async function waitForAgentIdle(baseUrl: string, maxWaitMs = 60_000): Promise<void> {
  // Move current waitForAgentIdle implementation here.
}

async function sendAndStream(prompt: string): Promise<Response> {
  // Move current setMessage + retry loop here.
}
```

- [ ] **Step 3: Leave only bootstrap/route responsibilities in `rovodev-proxy.ts`**

```ts
const driver = new RovoServeDriver(ROVODEV_BASE);
```

The legacy entry should stop owning message parsing and Rovo session logic directly.

- [ ] **Step 4: Verify request queue behavior still exists after extraction**

Run: `npm run typecheck`
Expected: PASS; queueing logic still reachable through `RovoServeDriver`.

### Task 4: Build The Runtime Server And OpenAI Handlers

**Files:**
- Create: `src/runtime/server.ts`
- Create: `src/runtime/openai/chat.ts`
- Create: `src/runtime/openai/responses.ts`
- Create: `src/runtime/openai/models.ts`
- Modify: `rovodev-proxy.ts`
- Modify: `src/plugin.ts`

- [ ] **Step 1: Create `models` handler first**

```ts
export const MODEL_LIST = {
  object: "list",
  data: [
    { id: "rovodev-auto", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-claude-sonnet-4-5", object: "model", owned_by: "atlassian-rovodev" },
  ],
};

export function handleModels(): Response {
  return Response.json(MODEL_LIST);
}
```

- [ ] **Step 2: Move `/v1/chat/completions` routing into `chat.ts`**

```ts
export async function handleChatCompletions(args: {
  body: any;
  driver: BackendDriver;
}): Promise<Response> {
  const messages = normalizeIncomingMessages(args.body);
  const model = normalizeRequestedModel(args.body.model);
  const stream = args.body.stream ?? false;
  // Reuse extracted builders and driver contract.
}
```

- [ ] **Step 3: Move `/v1/responses` routing into `responses.ts`**

```ts
export async function handleResponses(args: {
  body: any;
  driver: BackendDriver;
}): Promise<Response> {
  const messages = normalizeIncomingMessages(args.body);
  const model = normalizeRequestedModel(args.body.model);
  const stream = args.body.stream ?? false;
  // Reuse extracted builders and driver contract.
}
```

- [ ] **Step 4: Create a central runtime server router**

```ts
export function createRuntimeServer(driver: BackendDriver) {
  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      // Route OPTIONS, /health, /v1/models, /v1/chat/completions, /v1/responses.
    },
  };
}
```

- [ ] **Step 5: Reduce `rovodev-proxy.ts` to server bootstrap**

```ts
const driver = new RovoServeDriver(ROVODEV_BASE);
const runtime = createRuntimeServer(driver);

Bun.serve({
  port: PROXY_PORT,
  idleTimeout: 255,
  fetch: runtime.fetch,
});
```

- [ ] **Step 6: Keep `src/plugin.ts` thin and explicit**

```ts
// Preserve only provider registration, local proxy target URL resolution,
// and header cleanup.
```

- [ ] **Step 7: Verify the refactored runtime still builds**

Run: `npm run build`
Expected: PASS with `dist/` emitted from `src/*` and no changes needed to the published entrypoint behavior.

### Task 5: Improve Fidelity Ownership In Phase 2

**Files:**
- Modify: `src/runtime/session/response-builder.ts`
- Modify: `src/runtime/openai/chat.ts`
- Modify: `src/runtime/openai/responses.ts`
- Modify: `src/runtime/policy/capability-policy.ts`
- Modify: `README.md`

- [ ] **Step 1: Centralize synthetic usage and finish-reason policy**

```ts
export function buildUsage(args: {
  inputTokens?: number;
  outputTokens?: number;
  accurateUsage: boolean;
}) {
  const input = args.inputTokens ?? 0;
  const output = args.outputTokens ?? 0;
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
  };
}
```

- [ ] **Step 2: Emit Responses lifecycle events consistently even for sparse output**

```ts
// Ensure response.created / response.in_progress are emitted before first text delta,
// not only after text appears.
```

- [ ] **Step 3: Add capability-aware fallbacks**

```ts
export function applyCapabilityFallbacks(/* request */) {
  // Example: if multimodalInput is false, degrade to extracted text and log it.
}
```

- [ ] **Step 4: Document the new runtime-centered architecture**

```md
OpenCode -> plugin -> local runtime -> backend driver -> Rovo Serve
```

- [ ] **Step 5: Verify source changes after Phase 2**

Run: `npm run typecheck && npm run build`
Expected: PASS with runtime modules compiled and README updated.

### Task 6: Optional Minimal Test Coverage For Extracted Modules

**Files:**
- Create: `test/runtime/message-compiler.test.ts`
- Create: `test/runtime/sse-parser.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a minimal Node test script if tests are introduced in this phase**

```json
{
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Add message normalization tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeIncomingMessages } from "../../src/runtime/session/message-compiler.js";

test("normalizes responses input text blocks", () => {
  const messages = normalizeIncomingMessages({
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
  });

  assert.deepEqual(messages, [{ role: "user", content: "hello" }]);
});
```

- [ ] **Step 3: Add SSE parser tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { parseSSELines } from "../../src/runtime/stream/sse-parser.js";

test("parses done marker", () => {
  assert.deepEqual(parseSSELines(["data: [DONE]"]), [{ type: "done" }]);
});
```

- [ ] **Step 4: Run the smallest relevant tests first**

Run: `node --test test/runtime/message-compiler.test.ts`
Expected: PASS

Run: `node --test test/runtime/sse-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Run broader verification only after focused tests pass**

Run: `node --test`
Expected: PASS

## Self-Review

- Spec coverage: Phase 1 extraction, Phase 2 runtime ownership, backend seam, and migration path are all represented by Tasks 1-5. Optional tests are isolated in Task 6 so they do not expand mandatory scope accidentally.
- Placeholder scan: removed vague references and tied each task to explicit files, commands, and code skeletons.
- Type consistency: `BackendDriver`, `BackendCapabilities`, `BackendTurnRequest`, and `RuntimeMessage` are introduced once and reused consistently across tasks.
