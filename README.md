# opencode-rovodev-auth

Atlassian Rovo Dev authentication plugin for OpenCode, plus an optional local
runtime proxy that exposes an OpenAI-compatible `/v1/*` API on top of Rovo Dev
serve mode.

This project is for people who want to use Rovo Dev credits/models through an
OpenCode-compatible workflow without building a separate provider integration
from scratch.

## What This Repository Provides

- An OpenCode plugin exported from `dist/index.js`
- A local Bun entrypoint (`rovodev-proxy.ts`)
- A runtime layer under `src/runtime/` that:
  - accepts OpenAI-compatible requests
  - normalizes request bodies from OpenCode
  - forwards them to `acli rovodev serve`
  - translates streamed output back into OpenAI-compatible response shapes

Supported local endpoints:

- `GET /health`
- `GET /healthcheck`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`

## Who This Is For

Use this project if you want to:

- run Rovo Dev locally and route OpenCode traffic into it
- expose a local OpenAI-compatible endpoint for OpenCode
- experiment with a runtime compatibility layer instead of a direct provider API

This project is not a hosted service. It is a local development utility.

## High-Level Flow

```text
OpenCode
  -> plugin (src/plugin.ts)
  -> local runtime server (rovodev-proxy.ts + src/runtime/server.ts)
  -> backend driver (src/runtime/backend/rovo-serve-driver.ts)
  -> Atlassian Rovo Dev serve mode (acli rovodev serve /v3/*)
```

## Important Limitations

Read this before using the plugin.

- The backend is still `acli rovodev serve`, not a native OpenCode runtime.
- The runtime is text-first. Non-text multimodal parts are not forwarded.
- Unsupported tool-calling fields are stripped conservatively.
- Usage/token accounting is synthetic where Rovo serve mode does not expose
  reliable values.
- The backend behaves like a single active session, so requests are serialized.
- The plugin strips `Authorization` before proxying because authentication comes
  from your local Atlassian CLI session, not from an OpenAI API key.
- When OpenCode asks for an API key, any placeholder string is acceptable
  (for example `rovodev`).

## Runtime Architecture

- `src/runtime/server.ts`
  - HTTP routing
  - JSON parsing
  - CORS handling
  - health endpoints
- `src/runtime/backend/rovo-serve-driver.ts`
  - request queue
  - `/v3/*` transport
  - busy-session retry flow
  - health probe
- `src/runtime/openai/chat.ts`
  - `/v1/chat/completions`
  - streaming and non-streaming response shaping
- `src/runtime/openai/responses.ts`
  - `/v1/responses`
  - streaming and non-streaming Responses API shaping
- `src/runtime/openai/models.ts`
  - `/v1/models`
- `src/runtime/session/message-compiler.ts`
  - message normalization
  - prompt compilation
- `src/runtime/session/response-builder.ts`
  - shared usage and finish-reason policy
- `src/runtime/session/output-guard.ts`
  - suppresses clearly internal narration preambles before returning text
- `src/runtime/stream/*.ts`
  - SSE parsing and mapping
- `src/runtime/policy/*.ts`
  - model list and backend capability policy

## Prerequisites

You need all of the following:

- Node.js `>= 20`
- npm
- Bun
- Atlassian CLI (`acli`)
- a working Rovo Dev login/session in the Atlassian CLI

## Installation And Build

Clone the repository and install dependencies:

```bash
npm ci
```

Build the plugin/runtime output:

```bash
npm run build
```

The helper script does two important Windows-specific things:
- starts `acli rovodev serve` from this repo directory so Rovo Dev does not default to `C:\Users\...` as the workspace
- forwards a detected `git.exe` into the child process PATH to reduce `git-ai` warnings when Git is installed outside standard locations

Optional verification:

```bash
npm run typecheck
```

The build output goes to `dist/`.

## Step 1: Start Rovo Dev Serve Mode

Default Rovo Dev port used by this repo: `8123`

```bash
acli rovodev serve 8123 --disable-session-token
```

If this command is not healthy, the proxy will not work.

## Step 2: Start The Local Proxy

Default proxy port used by this repo: `4100`

```bash
bun rovodev-proxy.ts
```

Or choose explicit ports:

```bash
bun rovodev-proxy.ts --rovodev-port 8123 --proxy-port 4100
```

### Windows Helper

On Windows, you can use:

```bat
start-rovodev.bat
```

The helper script starts Rovo Dev serve mode from the repository directory,
forwards Git into the launched shell, and then starts the local proxy. This is
useful because running `acli rovodev serve` from the wrong working directory can
produce Git/workspace warnings in Rovo Dev.

## Step 3: Verify The Local Runtime

Check that the proxy is up:

```bash
curl http://localhost:4100/health
curl http://localhost:4100/v1/models
```

Expected outcomes:

- `/health` responds successfully
- `/v1/models` returns the available `rovodev-*` model ids

## Step 4: Connect It To OpenCode

This package exports the OpenCode plugin from `dist/index.js`.

Exact plugin-loading details can vary by OpenCode version, but these values are
the important constants exposed by this project:

- Provider id: `atlassian-rovodev`
- Auth label: `Rovo Dev (Local Proxy)`
- Proxy base: `http://localhost:4100`
- OpenAI-compatible API base: `http://localhost:4100/v1`

### OpenCode Configuration Facts

- The provider should target `http://localhost:4100/v1`
- Compatibility mode should be OpenAI-compatible / compatible
- Model ids must match the values returned by `GET /v1/models`
- If OpenCode asks for an API key, enter any placeholder value

### Example Provider Configuration

Use a provider entry equivalent to the following shape in your OpenCode config:

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
      "rovodev-claude-sonnet-4-6": {
        "name": "Claude Sonnet 4.6 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-gemini-3-flash-preview": {
        "name": "Gemini 3 Flash (preview) (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-gpt-5": {
        "name": "GPT-5 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-gpt-5-1": {
        "name": "GPT-5.1 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-gpt-5-2": {
        "name": "GPT-5.2 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-gpt-5-2-codex": {
        "name": "GPT-5.2-Codex (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      },
      "rovodev-gpt-5-4": {
        "name": "GPT-5.4 (Rovo Dev)",
        "limit": { "context": 200000, "output": 64000 },
        "modalities": { "input": ["text"], "output": ["text"] }
      }
    }
  }
}
```

### Available Model IDs

Current `/v1/models` output includes:

- `rovodev-auto`
- `rovodev-claude-haiku-4-5`
- `rovodev-claude-sonnet-4`
- `rovodev-claude-sonnet-4-5`
- `rovodev-claude-sonnet-4-6`
- `rovodev-gemini-3-flash-preview`
- `rovodev-gpt-5`
- `rovodev-gpt-5-1`
- `rovodev-gpt-5-2`
- `rovodev-gpt-5-2-codex`
- `rovodev-gpt-5-4`

These names correspond to the current Rovo Dev model list shown in the UI:

- Claude Haiku 4.5
- Claude Sonnet 4
- Claude Sonnet 4.5
- Claude Sonnet 4.6
- Gemini 3 Flash (preview)
- GPT-5
- GPT-5.1
- GPT-5.2
- GPT-5.2-Codex
- GPT-5.4

`rovodev-auto` is kept as a local convenience alias for OpenCode-side selection.

## Example End-To-End Startup Checklist

Use this order every time:

1. `npm run build`
2. `acli rovodev serve 8123 --disable-session-token`
3. `bun rovodev-proxy.ts`
4. `curl http://localhost:4100/health`
5. open OpenCode and use the `atlassian-rovodev` provider
6. select one of the `rovodev-*` models
7. enter a placeholder API key if prompted

## Output Guard

The runtime applies a small output guard to assistant text before returning it
to OpenAI-compatible clients.

- Leading internal narration such as `let me review` / `let me inspect` style
  preambles is suppressed when it appears before the real answer.
- Ordinary answers pass through unchanged.
- If a reply consists only of suppressed narration, the returned text is an
  empty string.

This is meant to reduce obvious backend work-log narration leaking into the
final user-visible response.

## Development Commands

Install dependencies:

```bash
npm ci
```

Typecheck:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Important notes:

- `dist/` is generated output, never hand-edit it
- the project uses ESM (`"type": "module"`)
- relative TypeScript imports use `.js` extensions intentionally
- `rovodev-proxy.ts` is run by Bun and is not included in `tsconfig.json`

## Troubleshooting

### Proxy Cannot Reach Rovo Dev

- confirm `acli rovodev serve 8123 --disable-session-token` is running
- check `curl http://localhost:8123/healthcheck`
- restart the proxy after restarting serve mode

### `InvalidGitRepositoryError` Or Git Warnings In Rovo Dev

- start Rovo Dev from the repository directory, not from your home directory
- on Windows, prefer `start-rovodev.bat`
- if an old process is still running on port `8123`, stop it and restart with
  the helper so the correct working directory and Git path are used

### Port Already In Use

- change proxy ports with `--proxy-port`
- change backend serve port with `--rovodev-port`
- if you change the proxy port, also update `PROXY_BASE` in `src/plugin.ts`
  and rebuild

### Rovo Dev Returns `409 busy`

This is expected sometimes. The runtime serializes requests because Rovo Dev
serve mode behaves like a single active agent session.

### Multimodal Content Does Not Behave Natively

This runtime currently forwards text-oriented content only. Images and PDFs may
be represented only by whatever text survives request normalization.

### Output Feels More Like Rovo Dev Than Native OpenCode

That is an architectural limitation of the current backend path. This repo makes
OpenCode talk to Rovo Dev through a compatibility runtime, but the upstream
runtime is still Rovo Dev serve mode.

## Security Notes

- The proxy is intended for local development
- It allows cross-origin requests
- It does not implement its own authentication layer
- Do not expose it to untrusted networks

## License

MIT (see `package.json#license`)
