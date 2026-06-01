# CLAUDE.md

Use `AGENTS.md` as the source of truth for this repository. Keep this file as Claude-specific workflow guidance only.

## Claude Workflow

- Inspect existing files before editing; do not infer architecture from file names alone.
- Prefer small, safe patches that preserve the `src/runtime/*` module boundaries.
- Explain risky changes before making them, especially changes to auth, request routing, SSE streaming, or `RovoServeDriver` queue semantics.
- Never fabricate command results. Report validation only when you actually ran it.
- Update `README.md` and `AGENTS.md` when changing setup commands, endpoints, ports, architecture, or runtime behavior.
- Do not hand-edit `dist/`, `node_modules/`, `.worktrees/`, or secrets.

## Required Checks

For source changes under `src/`:

```bash
npm run typecheck
npm run build
```

For merge/conflict work, also verify no conflict markers remain:

```bash
git --no-pager diff --check
```

`rovodev-proxy.ts` is run by Bun and is not included by `tsconfig.json`; validate it separately with Bun when possible.
