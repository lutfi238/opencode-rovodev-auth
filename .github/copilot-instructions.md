# Copilot Instructions

Read `AGENTS.md` for full project guidance. Key rules:

- This is a Node `>=20` TypeScript ESM OpenCode plugin plus a Bun local proxy for Atlassian Rovo Dev.
- Keep `src/plugin.ts` thin and preserve `src/runtime/*` boundaries.
- `rovodev-proxy.ts` is Bun-executed and not included in `tsconfig.json`; `src/**/*` builds to `dist/`.
- Use `.js` extensions for relative imports in TypeScript under `src/`.
- Do not edit `dist/`, `node_modules/`, `.worktrees/`, lock files, or secrets unless explicitly asked.
- The proxy is local-development-only, has CORS enabled, and relies on local `acli` auth.
- Preserve `Authorization` stripping in `src/plugin.ts` unless auth is intentionally redesigned.
- Rovo serve mode is single-session; do not parallelize `RovoServeDriver` requests casually.
- No test runner, linter, or formatter is configured.

For source changes, run:

```bash
npm run typecheck
npm run build
```

For conflict/merge work, run:

```bash
git --no-pager diff --check
```
