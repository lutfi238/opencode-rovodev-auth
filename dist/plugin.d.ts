import type { Plugin } from "@opencode-ai/plugin";
/**
 * Rovo Dev plugin for OpenCode.
 *
 * Works with the rovodev-proxy server that translates between
 * OpenAI-compatible API and Rovo Dev's /v3/ serve mode API.
 *
 * Auth: uses "api" method. The user can enter any placeholder key
 * (e.g., "rovodev") since authentication is handled by `acli rovodev serve`.
 *
 * IMPORTANT: The fetch hook rewrites ALL request URLs to point to the
 * local proxy. This is necessary because OpenCode may not apply the
 * config's baseURL when a plugin provides auth for the provider.
 * The fetch hook is the single source of truth for the endpoint URL.
 */
declare const RovoDevPlugin: Plugin;
export default RovoDevPlugin;
