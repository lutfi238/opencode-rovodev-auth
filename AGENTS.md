# AGENTS.md

## Project Overview

`opencode-rovodev-auth` is an OpenCode authentication plugin for Atlassian Rovo Dev plus an optional local runtime proxy. The plugin rewrites OpenCode provider traffic to a local OpenAI-compatible `/v1/*` API, and the proxy forwards turns to `acli rovodev serve` on its `/v3/*` endpoints. The project is a local development utility, not a hosted service. It is text-first and intentionally models Rovo Dev serve mode as a constrained backend with single-session semantics.

## Tech Stack

- Runtime/package: Node.js `>=20`, npm, ESM (`"type": "module"`)
- Language: TypeScript with `strict: true`
- Build/typecheck: `tsc`; `src/**/*` compiles to `dist/`
- OpenCode integration: `@opencode-ai/plugin`
- Local proxy runtime: Bun executes `rovodev-proxy.ts`
- External local dependency: Atlassian CLI `acli` authenticated for Rovo Dev
- HTTP/SSE primitives: Web `Request`, `Response`, `Headers`, `TransformStream`
- Tests/lint/formatter: no test runner, lint script, or formatter is configured

## Architecture

### Frontend/UI

There is no frontend UI in this repository. OpenCode is the client, configured to use the plugin/provider and local proxy.

### Backend/runtime

The runtime is a local Bun server. `rovodev-proxy.ts` is the thin bootstrap: it parses `--rovodev-port` and `--proxy-port`, creates a `RovoServeDriver`, and serves `createRuntimeServer(driver)`.

High-level flow:

```text
OpenCode
  -> src/plugin.ts auth/fetch hook
  -> http://localhost:4100/v1/*
  -> rovodev-proxy.ts Bun bootstrap
  -> src/runtime/server.ts router
  -> src/runtime/openai/* request handlers
  -> src/runtime/backend/rovo-serve-driver.ts
  -> acli rovodev serve /v3/*
```

### Data layer/database

No database, ORM, migrations, or persistent data store are present. `src/runtime/session/session-store.ts` contains an in-memory session abstraction, but the active Rovo serve driver treats Rovo Dev as a single local agent session.

### API layer

`src/runtime/server.ts` exposes:

- `GET /health`
- `GET /healthcheck`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `OPTIONS *` for CORS preflight

The OpenAI-compatible handlers normalize incoming Chat Completions and Responses request bodies, strip/fallback unsupported capabilities, and shape streaming/non-streaming responses.

### Authentication/authorization

OpenCode auth uses the plugin’s API-key auth method, but the entered key is only a placeholder. `src/plugin.ts` strips `Authorization` before proxying because real auth is the local Atlassian CLI session used by `acli rovodev serve`.

### External integrations

- OpenCode loads the package from `dist/index.js`.
- `acli rovodev serve 8123 --disable-session-token` provides the upstream local Rovo Dev API.
- Bun runs the local proxy entrypoint.

### Deployment/runtime model

The published package output is `dist/`. The local proxy is a development utility started manually with Bun or `start-rovodev.bat`. Do not treat this as a production network service; it has CORS enabled and no proxy-level authentication.

## Important Directories

```text
src/
  index.ts                          # package entry point; re-exports plugin
  plugin.ts                         # OpenCode auth hook and URL rewriting
  runtime/
    server.ts                       # local OpenAI-compatible router
    backend/
      types.ts                      # backend capability/request contracts
      rovo-serve-driver.ts          # serialized Rovo Dev /v3 transport
    diagnostics/
      logger.ts                     # proxy logging helpers
    openai/
      chat.ts                       # /v1/chat/completions
      models.ts                     # /v1/models
      responses.ts                  # /v1/responses
    policy/
      capability-policy.ts          # backend capability fallbacks
      model-policy.ts               # default model helpers
    session/
      message-compiler.ts           # request normalization and prompt formatting
      output-guard.ts               # suppresses leading internal narration
      response-builder.ts           # usage and finish-reason helpers
      session-store.ts              # in-memory session abstraction
    stream/
      sse-parser.ts                 # upstream SSE parsing/text extraction
      sse-mapper.ts                 # OpenAI-compatible SSE event builders
rovodev-proxy.ts                    # Bun bootstrap; not included by tsconfig
start-rovodev.bat                   # Windows helper for serve mode + proxy
docs/superpowers/                   # design specs and implementation plans
dist/                               # generated tsc output; do not edit
node_modules/                       # dependencies; do not edit
.worktrees/                         # local worktree data; do not edit unless asked
```

## Development Commands

Install dependencies:

```bash
npm ci
```

Build `src/` into `dist/`:

```bash
npm run build
```

Typecheck `src/` without emitting files:

```bash
npm run typecheck
```

Start Rovo Dev serve mode:

```bash
acli rovodev serve 8123 --disable-session-token
```

Start the proxy with default ports:

```bash
bun rovodev-proxy.ts
```

Start the proxy with explicit ports:

```bash
bun rovodev-proxy.ts --rovodev-port 8123 --proxy-port 4100
```

Windows helper:

```bat
start-rovodev.bat
```

Smoke checks:

```bash
curl http://localhost:4100/health
curl http://localhost:4100/v1/models
```

## Environment Variables

No project-specific environment variables are documented or read from source. Runtime configuration is currently via CLI arguments:

- `--rovodev-port` defaults to `8123`
- `--proxy-port` defaults to `4100`

Never document or commit Atlassian credentials, API keys, tokens, or raw auth headers.

## Database Notes

No database is configured. Do not add database tooling unless explicitly requested.

## API Notes

- Return structured error payloads shaped like `{ "error": { "message": string, "type": "invalid_request_error" | "proxy_error" } }`.
- Use `400` for invalid input, `404` for unknown routes, and `502` for upstream/proxy failures.
- Treat request bodies, JSON payloads, and upstream SSE as untrusted.
- `RovoServeDriver` preserves a request queue because Rovo Dev serve mode behaves like a single active session. Do not parallelize requests casually.
- Rovo Dev `409` means the agent is busy; the driver waits/retries and may need to resend the message after idle.
- Current backend capabilities are conservative: no true model selection, no native tool calling, no multimodal input, no concurrent sessions, no accurate usage, and no resumable responses.
- Usage/token accounting is synthetic unless a future backend provides reliable values.

## UI Notes

No UI framework or component system is present.

## Testing Notes

There is no test runner configured. Do not claim tests exist unless you add and wire one in `package.json`.

If tests are added later, pick one runner and document exact commands. Reasonable options for this stack include Node’s built-in test runner, Vitest, or Bun test.

## Coding Conventions

### Modules/imports

- Package is ESM. Use `import`/`export`; do not add CommonJS `require`.
- In TypeScript under `src/`, relative imports should use `.js` extensions so emitted ESM resolves correctly.
- `rovodev-proxy.ts` is run directly by Bun and may import source files with `.ts` extensions.
- Prefer `import type` for type-only imports.
- Keep imports at the top, grouped as: Node built-ins, external packages, local modules.

### Formatting

- Indentation: 2 spaces
- Strings: double quotes
- Semicolons: required
- Trailing commas in multiline objects/arrays/calls
- Wrap long ternaries, chains, and object literals for readability
- Comments should explain non-obvious constraints, not restate code

### TypeScript

- Preserve `strict: true`.
- Prefer `unknown` plus narrowing over `any`.
- Keep unavoidable `any` at JSON/SSE parsing boundaries only.
- Prefer small named helper types over repeated large inline object types.
- Use `as const` for narrow literal fields where useful.
- Prefer Web standard request/response types where applicable.

### Naming

- Types, interfaces, classes: `PascalCase`
- Functions and variables: `camelCase`
- Module-level constants: `SCREAMING_SNAKE_CASE`
- Use domain abbreviations only when standard or already established: SSE, HTTP, URL, SDK

## Security Rules

- Do not leak credentials, tokens, or raw auth headers in errors or logs.
- Copy headers before mutating: `const headers = new Headers(init?.headers);`.
- Keep the plugin behavior that strips `Authorization` for local proxy requests unless the auth model is intentionally redesigned.
- The proxy is local-development-only; do not expose it to untrusted networks.
- Use timeouts for Rovo Dev probes/health checks.

## Streaming/SSE Rules

- Buffer partial SSE lines between chunks.
- Ignore blank lines and comment lines beginning with `:`.
- Skip malformed JSON SSE events rather than crashing the stream.
- Preserve text extraction fallbacks in `sse-parser.ts` unless concrete evidence shows they are wrong.
- Always emit a terminal stop event and `[DONE]` for Chat Completions streams when upstream ends early.
- Keep Responses API event ordering well-formed: created/in-progress, output item/content part added, deltas, done/completed.

## Agent Workflow Rules

AI agents working in this repo must:

1. Inspect existing files before editing.
2. Prefer minimal, targeted changes.
3. Preserve the runtime/backend/session/stream separation unless explicitly asked to refactor.
4. Update `README.md` and this file when changing architecture, commands, endpoints, runtime ports, environment/config behavior, or setup flow.
5. Avoid generated files, dependencies, build outputs, secrets, and local worktree data.
6. Run `npm run typecheck` for source changes under `src/`.
7. Run `npm run build` when changing published code under `src/`.
8. For `rovodev-proxy.ts` changes, remember it is not covered by `tsconfig.json`; validate with Bun if available and explain any validation gap.
9. Before finishing merge/conflict work, run a conflict-marker scan such as `git --no-pager diff --check` or grep for `<<<<<<<`, `=======`, `>>>>>>>`.
10. Report exactly what changed and what was not verified.

## Do Not Edit Unless Asked

- `dist/` generated build output
- `node_modules/`
- `.worktrees/`
- `.git/`
- lock files unless intentionally changing dependencies
- secret-bearing files such as `.env` if added later

## Known Pitfalls

- `rovodev-proxy.ts` is intentionally outside `tsconfig.json`; `npm run build` and `npm run typecheck` validate `src/**/*` only.
- If the proxy port changes, update `PROXY_BASE` in `src/plugin.ts` and rebuild.
- The OpenCode API key prompt accepts any placeholder string because authentication is via local `acli`.
- Starting `acli rovodev serve` from the wrong directory can cause workspace/Git warnings; on Windows, prefer `start-rovodev.bat`.
- Rovo Dev serve mode can return `409 busy`; this is expected and handled through serialized requests and retry/backoff.
- Multimodal/tool-calling fields are stripped conservatively because the current backend is text-first.
- Merge conflict markers in source/docs will block pushes; resolve them and stage the resolved files before pushing.
