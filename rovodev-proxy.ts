#!/usr/bin/env bun

import { RovoServeDriver } from "./src/runtime/backend/rovo-serve-driver.ts";
import { logRequestSummary, logWarning } from "./src/runtime/diagnostics/logger.ts";
import { createRuntimeServer } from "./src/runtime/server.ts";

declare const Bun: {
  serve(options: {
    port: number;
    idleTimeout: number;
    fetch(req: Request): Promise<Response>;
  }): unknown;
};

/**
 * Rovo Dev ↔ OpenAI API Proxy Server
 *
 * Translates OpenAI-compatible /v1/chat/completions requests into
 * Rovo Dev serve mode's /v3/ API and streams responses back in
 * OpenAI SSE format.
 *
 * Usage:
 *   1. Start Rovo Dev serve mode:
 *        acli rovodev serve 8123
 *   2. Start this proxy:
 *        bun rovodev-proxy.ts
 *      or:
 *        bun rovodev-proxy.ts --rovodev-port 8123 --proxy-port 4100
 *
 * OpenCode should be configured to use http://localhost:4100/v1 as the baseURL.
 */

const ROVODEV_PORT = parseInt(
  process.argv.find((_, i) => process.argv[i - 1] === "--rovodev-port") ?? "8123",
);
const PROXY_PORT = parseInt(
  process.argv.find((_, i) => process.argv[i - 1] === "--proxy-port") ?? "4100",
);
const ROVODEV_BASE = `http://localhost:${ROVODEV_PORT}`;

const driver = new RovoServeDriver(ROVODEV_BASE);

Bun.serve({
  port: PROXY_PORT,
  ...createRuntimeServer(driver),
});

console.log(`
 ┌──────────────────────────────────────────────────────────┐
 │        Rovo Dev  <->  OpenAI API  Proxy Server           │
 ├──────────────────────────────────────────────────────────┤
 │  Proxy listening on:   http://localhost:${PROXY_PORT}             │
 │  Rovo Dev expected at: ${ROVODEV_BASE}            │
 │  OpenCode baseURL:     http://localhost:${PROXY_PORT}/v1          │
 └──────────────────────────────────────────────────────────┘

  Make sure 'acli rovodev serve ${ROVODEV_PORT}' is running first!
`);

driver.checkHealth().then((ok) => {
  if (ok) {
    logRequestSummary("proxy", "✓ Rovo Dev serve is reachable");
  } else {
    logWarning(
      "proxy",
      `✗ Cannot reach Rovo Dev at ${ROVODEV_BASE}. Start it with: acli rovodev serve ${ROVODEV_PORT}`,
    );
  }
});
