# Rovo OpenCode V2 Design

## Goal

Build a second-generation architecture for `opencode-rovodev-auth` that preserves as much native OpenCode behavior as possible while still allowing Rovo-backed model access. The current `rovodev serve` flow remains supported, but it should become a swappable backend driver rather than the core runtime model.

## Why V2 Exists

The current architecture works as a compatibility bridge, but it still leaks Rovo Dev runtime behavior into user-facing OpenCode flows. The largest source of mismatch is architectural: OpenCode expects a provider-like backend, while `acli rovodev serve` behaves like a full agent runtime with its own session semantics.

This means the current repo can provide good compatibility, but not full parity. V2 exists to move as much behavior as possible into a local compatibility runtime that we control.

## Scope

In scope:
- Preserve the existing working `serve`-based path
- Refactor the repo into clear runtime, driver, and transport boundaries
- Move OpenCode-facing compatibility logic into our own runtime
- Prepare the codebase for a future non-`serve` backend if one is ever discovered
- Improve user-facing fidelity where possible without changing the public setup story too much

Out of scope:
- Claiming 100% parity with native OpenCode while still depending on `rovodev serve`
- Depending on undocumented or highly unstable backend integrations as the default architecture
- Large speculative implementation of a direct Rovo backend before a viable lower-level backend path is proven

## Architecture

V2 is a layered system:

```text
OpenCode
-> Provider Adapter
-> Session Runtime
-> Backend Driver
-> Backend Transport
```

### Provider Adapter

This is the layer OpenCode talks to. It should remain small and stable.

Responsibilities:
- Register auth/provider integration
- Route requests to the local runtime server
- Keep OpenCode setup simple and familiar

The adapter should avoid backend-specific logic beyond local routing and auth bootstrapping.

### Session Runtime

This is the most important new layer. It becomes the compatibility brain.

Responsibilities:
- Own request normalization
- Maintain local session state and history compilation
- Enforce model and capability policy
- Convert backend events into OpenAI-compatible and Responses-compatible outputs
- Provide stable behavior even when backend behavior is imperfect

The runtime should be treated as the user-facing behavior layer. If the system feels like OpenCode, it should be because this runtime makes it feel that way.

### Backend Driver

This is the abstraction between the compatibility runtime and any specific backend.

Responsibilities:
- Accept a normalized turn request from the runtime
- Emit backend-neutral stream events back to the runtime
- Hide transport details and backend quirks

The first driver is `RovoServeDriver`. A future `RovoDirectDriver` may be added if a viable lower-level backend path is found.

### Backend Transport

This is the lowest layer.

Responsibilities:
- Raw HTTP/SSE communication
- Session reset/retry behavior
- Timeouts and connectivity handling
- Minimal protocol decoding before handing data to the driver

## Components

### Keep Thin
- `src/plugin.ts`

### New Runtime Surface
- `src/runtime/server.ts`
- `src/runtime/openai/chat.ts`
- `src/runtime/openai/responses.ts`
- `src/runtime/openai/models.ts`

### Session Layer
- `src/runtime/session/session-store.ts`
- `src/runtime/session/message-compiler.ts`
- `src/runtime/session/response-builder.ts`

### Backend Layer
- `src/runtime/backend/types.ts`
- `src/runtime/backend/rovo-serve-driver.ts`
- `src/runtime/backend/rovo-direct-driver.ts`

### Streaming Layer
- `src/runtime/stream/sse-parser.ts`
- `src/runtime/stream/sse-mapper.ts`

### Policy Layer
- `src/runtime/policy/model-policy.ts`
- `src/runtime/policy/capability-policy.ts`

### Diagnostics
- `src/runtime/diagnostics/logger.ts`

### Legacy Entry
- `rovodev-proxy.ts` should eventually become a thin bootstrap or compatibility wrapper around the new runtime.

## Backend Driver Contract

Every backend should conform to one internal contract so the runtime stays independent of backend quirks.

Example shape:

```ts
type BackendTurnRequest = {
  sessionId: string;
  model: string;
  messages: RuntimeMessage[];
  tools: RuntimeTool[];
  stream: boolean;
};

type BackendTurnStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; name: string; arguments: string; callId: string }
  | { type: "tool-result-request"; callId: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "completed"; finishReason: string }
  | { type: "error"; message: string; status?: number };
```

The exact contract can evolve, but the principle should hold: OpenCode-facing layers never consume raw Rovo events directly.

## Capability Model

Each backend driver should explicitly declare its real capabilities.

Example:

```ts
type BackendCapabilities = {
  trueModelSelection: boolean;
  multimodalInput: boolean;
  nativeToolCalling: boolean;
  concurrentSessions: boolean;
  accurateUsage: boolean;
  resumableResponses: boolean;
};
```

Expected values for `RovoServeDriver` today are mostly conservative:
- `trueModelSelection: false`
- `multimodalInput: false`
- `nativeToolCalling: false`
- `concurrentSessions: false`
- `accurateUsage: partial`
- `resumableResponses: limited`

This avoids pretending the backend can do things it cannot actually do.

## Fidelity Strategy

The runtime should improve parity in the following order:

1. Correct request normalization
2. Stable session/history compilation
3. Accurate response lifecycle shaping
4. Better error mapping
5. Better usage and finish metadata
6. Explicit fallback behavior for unsupported features

This ordering gives the best user-facing improvement without depending on backend breakthroughs.

## What V2 Can Improve Even With `serve`

- More accurate OpenAI and Responses envelopes
- More stable request parsing across OpenCode request shapes
- Better synthetic but consistent usage/finish reasons
- Cleaner separation between session logic and backend quirks
- Better diagnostics and debugging of fidelity gaps

## Hard Limits While Still Using `serve`

These should be considered architectural constraints, not bugs:
- Single-session request serialization remains necessary
- True model routing likely remains unavailable unless upstream exposes it
- Tool calling cannot become truly native if upstream remains text/session oriented
- Multimodal parity is blocked if upstream input stays text-only
- Full OpenCode parity remains impossible while the upstream runtime remains a separate agent orchestrator

## Migration Path

### Phase 1: Extract architecture
- Move parsing, shaping, and SSE logic into runtime modules
- Define backend driver interfaces
- Wrap current behavior as `RovoServeDriver`

### Phase 2: Shift compatibility into runtime
- Centralize session state
- Centralize policy and response shaping
- Reduce accidental dependence on raw Rovo behavior

### Phase 3: Prepare backend seam
- Add `RovoDirectDriver` stub
- Add configuration and capability selection

### Phase 4: Evaluate direct backend only if discovered
- Compare direct backend against `serve`
- Promote it only if it materially improves fidelity and remains maintainable

### Phase 5: Collapse legacy path
- Make the legacy proxy file a thin wrapper or retire it once the runtime server becomes the main entry point

## Risks

- Refactor complexity without immediate user-visible gains if phases are not kept small
- Over-designing a direct backend path before a real lower-level backend exists
- Mixing compatibility logic and backend logic again if module boundaries are not enforced

## Recommended Direction

Proceed with Phase 1 and Phase 2 first.

This keeps the current working system alive, improves fidelity where it is actually controllable, and prepares a safe pivot path for a future backend replacement without making the architecture depend on an unproven non-`serve` integration.
