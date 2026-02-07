# opencode-rovodev-auth

Atlassian Rovo Dev authentication plugin for OpenCode.

This repo also includes an optional local proxy that translates OpenAI-compatible
`/v1/*` requests into Rovo Dev "serve mode" `/v3/*` calls and streams responses
back in OpenAI SSE format.

## What You Get

- OpenCode auth plugin (`src/plugin.ts`) with provider id `atlassian-rovodev`.
- Bun proxy server (`rovodev-proxy.ts`) that exposes:
  - `GET /health` and `GET /healthcheck`
  - `GET /v1/models`
  - `POST /v1/chat/completions` (streaming + non-streaming)
  - `POST /v1/responses` (streaming + non-streaming)

## How It Works

High level flow:

```
OpenCode
  -> (plugin fetch hook rewrites all URLs)
  -> http://localhost:4100/v1/...
  -> rovodev-proxy.ts (bun)
  -> http://localhost:8123/v3/... (acli rovodev serve)
```

Notes:

- The plugin intentionally strips the `Authorization` header because
  authentication is handled by the Atlassian CLI session that runs
  `acli rovodev serve`.
- When OpenCode prompts for an API key, you can enter any placeholder
  (for example `rovodev`).

## Prerequisites

- Node.js >= 20 (build/typecheck)
- npm
- Bun (to run the proxy)
- Atlassian CLI (`acli`) and a logged-in Rovo Dev session

## Quick Start

### Windows (recommended)

Use the helper script that starts both Rovo Dev serve mode and the proxy:

```bat
start-rovodev.bat
```

### macOS / Linux

1) Start Rovo Dev serve mode (default port `8123`):

```bash
acli rovodev serve 8123 --disable-session-token
```

2) Start the proxy (default port `4100`):

```bash
bun rovodev-proxy.ts
# or customize ports
bun rovodev-proxy.ts --rovodev-port 8123 --proxy-port 4100
```

3) Smoke check:

```bash
curl http://localhost:4100/health
curl http://localhost:4100/v1/models
```

## OpenCode Setup

This package exports a default OpenCode plugin from `dist/index.js`.

Because OpenCode plugin loading/config can vary by version, keep these facts in
mind when wiring it up:

- Provider id: `atlassian-rovodev`
- Auth method label: `Rovo Dev (Local Proxy)`
- Proxy base URL is hardcoded by the plugin to `http://localhost:4100`

If you need a different proxy host/port, update `PROXY_BASE` in
`src/plugin.ts` and rebuild (`npm run build`).

### Model IDs

The proxy exposes these model ids via `GET /v1/models`:

- `rovodev-auto`
- `rovodev-claude-sonnet-4-5`
- `rovodev-claude-haiku-4-5`
- `rovodev-claude-sonnet-4`
- `rovodev-gpt-5-2-codex`
- `rovodev-gpt-5-2`
- `rovodev-gpt-5-1`
- `rovodev-gpt-5`

### Example Provider Configuration

Add a provider entry similar to the following in your OpenCode configuration
(where you define providers/models). The important bits are:

- `baseURL`: `http://localhost:4100/v1`
- `compatibility`: `"compatible"`
- model keys match the ids returned by `GET /v1/models`

```json
{
  "atlassian-rovodev": {
    "npm": "@ai-sdk/openai",
    "options": {
      "baseURL": "http://localhost:4100/v1",
      "compatibility": "compatible"
    },
    "models": {
      "rovodev-auto": {
        "name": "Rovo Dev (Auto)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-claude-sonnet-4-5": {
        "name": "Claude Sonnet 4.5 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
      },
      "rovodev-claude-haiku-4-5": {
        "name": "Claude Haiku 4.5 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text", "image"], "output": ["text"] }
      },
      "rovodev-claude-sonnet-4": {
        "name": "Claude Sonnet 4 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
      },
      "rovodev-gpt-5-2-codex": {
        "name": "GPT-5.2-Codex (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-gpt-5-2": {
        "name": "GPT-5.2 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-gpt-5-1": {
        "name": "GPT-5.1 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-gpt-5": {
        "name": "GPT-5 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      }
    }
  }
}
```

Note: the proxy currently extracts and forwards text only. If your client sends
multimodal content blocks (images/PDFs), they will be ignored by the proxy.

## Development

Install deps:

```bash
npm ci
```

Typecheck:

```bash
npm run typecheck
```

Build (emits `dist/`):

```bash
npm run build
```

Important:

- `dist/` is generated output. Do not hand-edit it.
- This package is ESM (`"type": "module"`). Relative imports in TS use `.js`
  extensions so the emitted JS runs correctly under Node ESM.

## Troubleshooting

- Proxy says it cannot reach Rovo Dev:
  - Ensure `acli rovodev serve 8123` is running.
  - Verify `curl http://localhost:8123/healthcheck`.
- Port already in use:
  - Change ports using `--rovodev-port` / `--proxy-port` for the proxy.
  - If you change the proxy port, also update `PROXY_BASE` in `src/plugin.ts`.
- Rovo Dev returns 409 "busy":
  - The proxy serializes requests because Rovo Dev serve mode is effectively a
    single agent session; parallel requests can clobber each other.

## Security

This is a local development utility.

- The proxy allows cross-origin requests and does not implement authentication.
- Do not expose it to untrusted networks.

## License

MIT (see `package.json#license`).
