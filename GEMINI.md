# GEMINI.md

Use `AGENTS.md` as the canonical project context. This file keeps Gemini CLI guidance short and aligned with the shared rules.

## Project Context

- Node.js `>=20`, npm, TypeScript, ESM.
- Published package output is generated into `dist/` from `src/`.
- `rovodev-proxy.ts` is a Bun-only local bootstrap and is outside `tsconfig.json`.
- The local runtime exposes `/health`, `/healthcheck`, `/v1/models`, `/v1/chat/completions`, and `/v1/responses`.
- Authentication comes from the local Atlassian CLI session; the OpenCode API key is a placeholder and `Authorization` is stripped before proxying.

## Gemini Workflow

- Read relevant source before changing it.
- Keep patches minimal and preserve runtime/backend/session/stream separation.
- Use `.js` extensions for relative imports inside `src/**/*.ts`.
- Never edit `dist/`, `node_modules/`, `.worktrees/`, or secret-bearing files.
- Do not claim tests, lint, or validation ran unless you ran the exact command.

## Checks

```bash
npm run typecheck
npm run build
git --no-pager diff --check
```

Use `git --no-pager diff --check` after merge/conflict work to catch conflict markers and whitespace errors.
