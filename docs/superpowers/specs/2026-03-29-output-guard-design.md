# Output Guard Design

**Goal**

Reduce user-visible internal Rovo agent narration such as repository-inspection work logs while preserving normal assistant answers and keeping the current runtime split intact.

## Problem

The current runtime forwards backend text almost verbatim once it has been normalized into OpenAI-style chat or Responses output. This works for normal answers, but it also allows agentic preambles like `Let me review...`, `Now let me look...`, or file-inspection narration to leak through to the user when Rovo Dev emits them.

This is a fidelity problem, not a transport failure. The runtime now owns request normalization, SSE parsing, and response shaping, so it is the correct layer to add a user-facing output guard before content reaches OpenCode.

## Chosen Mode

Use a **balanced** guard.

The guard should remove only strong internal-agent narration patterns and leave ordinary assistant prose untouched. It should not rewrite answers, summarize them, or invent replacement text.

## Recommended Approach

Add a small runtime module, likely `src/runtime/session/output-guard.ts`, and apply it from both:

- `src/runtime/openai/chat.ts`
- `src/runtime/openai/responses.ts`

The module should operate on text headed to the client, not on request messages headed to Rovo Dev.

### Why this approach

- It fits the new runtime-centered architecture without pushing more logic back into `rovodev-proxy.ts`.
- It works for both streaming and non-streaming paths.
- It keeps the backend driver transport-agnostic.
- It is small enough for an incremental first pass but leaves room for tighter heuristics later.

## Scope

### In scope

- Detect strong internal narration at the start of a backend answer.
- Drop or trim that narration before it is emitted to the client.
- Share the same core heuristics between chat and Responses handlers.
- Support both streaming and non-streaming outputs.
- Add concise warning logs when the guard removes content.

### Out of scope

- Rewriting backend answers into cleaner prose.
- Detecting every possible hidden chain-of-thought form.
- Adding new backend APIs or changing Rovo Serve transport behavior.
- Changing request normalization or model routing.

## Detection Model

The guard should be heuristic and conservative.

It should only trigger on combinations that strongly indicate internal work-log narration, for example:

- phrases such as `Let me review`, `Let me look`, `Let me inspect`, `Now let me`, `I can see there's already`
- explicit repo inspection language near the beginning of the output
- references to inspecting workspace files, source files, `AGENTS.md`, runtime files, or codebase structure as immediate next-step narration rather than as part of a direct answer
- multiple sequential narration sentences that describe what the backend is about to do rather than answering the user

The guard should avoid triggering on ordinary explanatory text that merely mentions files or code.

## Runtime Behavior

### Streaming

For streaming handlers, the guard needs small per-response state.

At minimum it should track:

- buffered leading text not yet released to the client
- whether the opening text has been classified as internal narration
- whether safe user-facing output has started

Expected behavior:

1. Buffer the beginning of the stream.
2. Run balanced heuristics on that leading text.
3. If the leading text looks like internal narration, suppress it.
4. Once the text looks like a real answer, emit that text and pass through subsequent deltas normally.
5. If no safe answer text ever appears, complete the stream without replaying the suppressed narration.

This keeps the guard focused on the opening leak pattern rather than trying to police every later token.

### Non-streaming

For non-streaming handlers:

1. Collect the full backend text as today.
2. Run the same guard logic once on the full text.
3. Return the cleaned text.

If the entire output is classified as internal narration, return an empty assistant content string in the first version rather than inventing a fallback message.

## Module Shape

The new module should stay small and explicit. A reasonable shape is:

- `createOutputGuard()` for streaming state
- `cleanOutputText(text)` for non-streaming cleanup
- helper(s) for balanced narration detection and trimming

The module should not know anything about OpenAI response envelopes. It should only accept and return text plus guard state.

## Logging

When narration is suppressed, emit a concise warning via runtime logging, for example a message indicating that internal preamble text was dropped.

Logs should not include full raw response bodies. A short preview or count is enough.

## Error Handling

- If heuristics are inconclusive, prefer passing text through.
- If the guard state logic fails unexpectedly, do not break the stream; fall back to current text passthrough behavior where practical.
- Keep current structured error responses unchanged.

## Verification

Minimum verification for implementation:

- `npm run typecheck`
- `npm run build`
- targeted smoke coverage for:
  - a streaming narration preamble that should be removed
  - a normal answer that should pass unchanged
  - a non-streaming narration-only answer that should become empty content

## Acceptance Criteria

- Strong internal-agent narration at the start of a response no longer reaches the user.
- Ordinary direct answers still pass through unchanged.
- Chat and Responses handlers share the same guard behavior.
- Streaming remains well-formed and still sends terminal completion events.
- The change is isolated to runtime output shaping, not backend transport.
