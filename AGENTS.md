# Agent Notes: opencode-rovodev-auth

Purpose: OpenCode authentication plugin for Atlassian Rovo Dev + optional local proxy.

## Tooling / Environment
- Node: >= 20 (see `package.json#engines`)
- Package manager: npm (lockfile: `package-lock.json`)
- TypeScript: `tsc` (build + typecheck)
- Optional runtime for proxy: Bun (`rovodev-proxy.ts` is executed by bun)

## Common Commands

### Install
```bash
npm ci
# or (if updating deps)
npm install
```

### Build (emits `dist/`)
```bash
npm run build
```

### Typecheck (no output)
```bash
npm run typecheck
```

### Run Local Rovo Dev Proxy (dev utility)
Prereqs: `bun` + Atlassian CLI (`acli`) authenticated.

```bash
# 1) Start Rovo Dev serve mode (default port 8123)
acli rovodev serve 8123 --disable-session-token

# 2) Start proxy (default port 4100)
bun rovodev-proxy.ts
# or:
bun rovodev-proxy.ts --rovodev-port 8123 --proxy-port 4100
```

Windows helper:
- `start-rovodev.bat` (starts both `acli rovodev serve` and `bun rovodev-proxy.ts`)

Quick smoke checks: `curl http://localhost:4100/health` and `curl http://localhost:4100/v1/models`

## Lint / Format / Tests (Current State)
- Lint: not configured (no ESLint/Biome script).
- Formatting: not enforced by tooling; keep existing style consistent.
- Tests: no test runner configured.

### Running A Single Test (If/When Tests Are Added)
Pick ONE runner and wire it into `package.json`. Suggested options:

- Node built-in test runner:
  - `node --test test/my-feature.test.ts`
  - `node --test --test-name-pattern "parses SSE" test/my-feature.test.ts`

- Vitest:
  - `npx vitest test/my-feature.test.ts`
  - `npx vitest -t "parses SSE" test/my-feature.test.ts`

- Bun:
  - `bun test test/my-feature.test.ts` (supports `-t "name"`)

(Agents: do not claim tests exist unless you add them.)

## Repository Layout
- `src/plugin.ts`: OpenCode plugin (default export)
- `src/index.ts`: library entry point; re-exports plugin (note the `.js` import extension)
- `tsconfig.json`: strict TS build to `dist/`
- `rovodev-proxy.ts`: Bun server translating OpenAI-style `/v1/*` to Rovo Dev `/v3/*`
- `dist/`: generated output (ignored by git; do not edit manually)
- `node_modules/`: ignored by git

## TypeScript + ESM Style Guide

### Module system / imports
- This package is ESM (`"type": "module"`). Use `import` / `export` only.
- Use `.js` extensions in relative imports in TS source that will run as JS:
  - Good: `export { default } from "./plugin.js";`
  - Avoid: `export { default } from "./plugin";` (breaks Node ESM)
- Prefer `import type { ... }` for purely type imports.

### Import ordering
- Group imports with a blank line:
  1) Node built-ins (rare here)
  2) external packages
  3) local modules
- Keep imports at the top of the file; avoid dynamic requires.

### Formatting (match existing code)
- Indentation: 2 spaces.
- Strings: double quotes.
- Semicolons: yes.
- Trailing commas: in multiline objects/arrays.
- Wrap long ternaries / chains for readability (see `src/plugin.ts`).

### Types
- `tsconfig.json` has `strict: true`; new code must typecheck under strict mode.
- Prefer:
  - `unknown` + narrowing over `any`
  - `as const` for string literal fields that must stay narrow
  - small helper types/functions instead of repeated inline `any`
- If you must use `any` (e.g. untyped JSON/SSE payloads), isolate it to parsing boundaries.

### Naming conventions
- Types/interfaces/classes: `PascalCase`
- Functions/variables: `camelCase`
- Module-level constants: `SCREAMING_SNAKE_CASE` (e.g. `ROVODEV_PROVIDER_ID`)
- Avoid abbreviations unless they are domain-standard (SSE, URL, HTTP, SDK).

### Error handling
- Treat all network responses and JSON as untrusted.
- Use `try/catch` around `req.json()`, upstream `fetch()`, and SSE JSON parsing.
- When catching, prefer `catch (err: unknown)` and narrow before reading `err.message`.
- Proxy error responses should be structured and consistent:
  - `{ error: { message: string, type: "invalid_request_error" | "proxy_error" } }`
  - Use correct status codes (400 invalid JSON, 404 unknown endpoint, 502 upstream issues).
- Do not leak secrets in error messages or logs.

### Streaming / SSE specifics
- Keep streaming resilient:
  - buffer partial lines between chunks
  - ignore blank lines and comment lines beginning with `:`
  - skip unparsable JSON events
  - ensure the client always receives a terminal stop + `[DONE]` if upstream ends early
- Rovo Dev serves a single agent session:
  - keep the request queue (`requestQueue` / `enqueue`) behavior intact
  - do not parallelize requests without carefully preserving session semantics

### Web/Fetch APIs
- Prefer Web standard types (`Request`, `Response`, `Headers`).
- When rewriting requests (plugin fetch hook), do not mutate caller headers:
  - `const headers = new Headers(init?.headers);`
- Use timeouts for upstream probes/health checks (e.g. `AbortSignal.timeout(3000)`).

### Generated artifacts
- `dist/` is output from `tsc`; never hand-edit.
- If you add new entry points, update `tsconfig.json` and `package.json` fields (`main`, `types`, `files`).

## Cursor / Copilot Instructions
- No Cursor rules found (`.cursor/rules/` or `.cursorrules` absent).
- No Copilot instructions found (`.github/copilot-instructions.md` absent).

## Before Finishing Work
- Run `npm run typecheck` (required).
- Run `npm run build` if your change affects published output.
- Keep diffs focused on source (`src/`), not `dist/` or `node_modules/`.
