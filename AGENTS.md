# Agent Notes: opencode-rovodev-auth

Purpose: OpenCode authentication plugin for Atlassian Rovo Dev plus an optional local proxy that exposes an OpenAI-compatible `/v1/*` API.

## Environment
- Node: `>=20` (`package.json#engines`)
- Package manager: `npm` (`package-lock.json` present)
- Language: TypeScript + ESM
- Compiler: `tsc`
- Optional runtime for local proxy: `bun`
- Optional external dependency for local proxy flow: Atlassian CLI `acli` authenticated for `rovodev`

Install with `npm ci`. Use `npm install` only when intentionally changing dependencies.

## Build, Lint, Typecheck, Test

### Available commands
```bash
npm run build
npm run typecheck
```

### Current tool state
- Build: configured via `tsc`, emits `dist/`
- Typecheck: configured via `tsc --noEmit`
- Lint: not configured
- Formatter: not configured
- Tests: not configured

### Single-test guidance
There is no test runner wired into this repo today. Do not claim tests exist unless you add them.

If you add tests, pick one runner and add scripts in `package.json`. Good single-test commands would be:

```bash
node --test test/my-feature.test.ts
node --test --test-name-pattern "parses SSE" test/my-feature.test.ts
npx vitest test/my-feature.test.ts
npx vitest -t "parses SSE" test/my-feature.test.ts
bun test test/my-feature.test.ts
bun test -t "parses SSE" test/my-feature.test.ts
```

### Verification expectations
- Run `npm run typecheck` before finishing any source change
- Run `npm run build` when changing published code under `src/`
- If you add a test runner, run the smallest relevant test first, then broader verification if needed

## Local Proxy Workflow
The plugin is designed to work with a local Bun proxy that forwards OpenAI-style requests to Rovo Dev serve mode.

### Start Rovo Dev serve mode
```bash
acli rovodev serve 8123 --disable-session-token
```

### Start proxy
```bash
bun rovodev-proxy.ts
```
Or run:
```bash
bun rovodev-proxy.ts --rovodev-port 8123 --proxy-port 4100
```

Windows helper:
- `start-rovodev.bat`

Useful smoke checks:
```bash
curl http://localhost:4100/health
curl http://localhost:4100/v1/models
```

## Repository Layout
- `src/plugin.ts`: OpenCode plugin auth hook and request URL rewriting
- `src/index.ts`: library entry point that re-exports the plugin
- `rovodev-proxy.ts`: Bun proxy server translating `/v1/*` requests to Rovo Dev `/v3/*`
- `tsconfig.json`: strict TS config; only includes `src/**/*`
- `dist/`: generated build output; do not edit manually

Important nuance: `rovodev-proxy.ts` is not included by the current `tsconfig.json`, so `npm run build` and `npm run typecheck` validate `src/` only.

## Imports And Modules
- Use `import` / `export` only; never add CommonJS `require`
- Use `.js` extensions in relative imports inside TS source that compiles to JS
- Prefer `import type` for type-only imports
- Keep imports at the top of the file
- Group imports in this order with a blank line between groups:
  1. Node built-ins
  2. External packages
  3. Local modules

## Formatting
- Follow existing style; there is no formatter enforcing it
- Indentation: 2 spaces
- Strings: double quotes
- Semicolons: required
- Use trailing commas in multiline objects and arrays
- Wrap long ternaries, chains, and object literals for readability
- Keep comments sparse and only where the code would otherwise be hard to follow

## TypeScript Guidance
- `strict: true` is enabled; preserve strict typing
- Prefer `unknown` plus narrowing over `any`
- Keep unavoidable `any` at parsing boundaries only
- Prefer small local helper types over repeating large inline object types
- Use `as const` for fixed string literals where narrow types matter
- Prefer Web standard request/response types (`Request`, `Response`, `Headers`) where applicable

## Naming
- Types, interfaces, classes: `PascalCase`
- Functions, variables: `camelCase`
- Module-level constants: `SCREAMING_SNAKE_CASE`
- Use domain abbreviations only when standard and already established: `SSE`, `HTTP`, `URL`, `SDK`

## Error Handling
- Treat request bodies, JSON payloads, and upstream responses as untrusted
- Wrap JSON parsing and network boundaries in `try/catch`
- Prefer `catch (err: unknown)` and narrow before reading properties
- Do not leak credentials, tokens, or raw auth headers in errors or logs
- Return structured proxy errors like `{ "error": { "message": "...", "type": "invalid_request_error" } }` and `{ "error": { "message": "...", "type": "proxy_error" } }`
- Use status codes deliberately: `400` invalid input, `404` unknown route, `502` upstream/proxy failures

## Streaming And Proxy-Specific Rules
- Preserve the request queue and `enqueue` semantics; do not parallelize proxy requests casually
- Buffer partial SSE lines between chunks
- Ignore blank SSE lines and comment lines beginning with `:`
- Skip malformed JSON events rather than crashing the stream
- Ensure the client still receives a terminal stop event and `[DONE]` when upstream ends early
- Preserve the text extraction fallbacks unless you have concrete evidence they are wrong
- Be careful with retries around Rovo Dev `409` busy responses; session reset behavior matters

## HTTP And Header Handling
- Do not mutate caller-provided headers directly; copy with `new Headers(...)`
- The plugin intentionally strips `Authorization` before proxying local requests
- Keep `Content-Type: application/json` where the current flow expects JSON
- Use timeouts for probes or health checks when waiting on Rovo Dev readiness

## File Editing Rules
- Prefer changing `src/` over `dist/`
- Never hand-edit `dist/`; regenerate it with `npm run build`
- Keep diffs focused; avoid unrelated refactors while touching proxy or plugin logic
- If you add a new published entry point, update `package.json` fields such as `main`, `types`, and `files`

## Cursor And Copilot Rules
- No `.cursor/rules/` directory found
- No `.cursorrules` file found
- No `.github/copilot-instructions.md` file found

## Before Finishing Work
- Re-read the changed file boundaries and make sure behavior matches the current plugin/proxy contract
- Run `npm run typecheck` for source changes
- Run `npm run build` for changes under `src/` that affect the published package
- Report explicitly if something could not be verified because the repo has no test/lint setup yet
