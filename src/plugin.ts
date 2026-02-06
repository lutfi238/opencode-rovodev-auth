import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";

const ROVODEV_PROVIDER_ID = "atlassian-rovodev";
const PROXY_BASE = "http://localhost:4100";

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
const RovoDevPlugin: Plugin = async (
  _input: PluginInput
): Promise<Hooks> => {
  return {
    auth: {
      provider: ROVODEV_PROVIDER_ID,
      async loader(getAuth, _provider) {
        const auth = (await getAuth()) as any;
        if (!auth || auth.type !== "api") {
          return {};
        }

        return {
          apiKey: auth.key || "rovodev-local",
          async fetch(
            input: RequestInfo | URL,
            init?: RequestInit
          ): Promise<Response> {
            const rawUrl =
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input.url;

            // Extract the path portion after /v1 (e.g. /chat/completions)
            // The SDK may produce URLs like:
            //   "http://localhost:4100/v1/chat/completions"  (correct baseURL)
            //   "undefined/chat/completions"                 (broken baseURL)
            //   "/v1/chat/completions"                       (relative)
            let targetUrl: string;
            const v1Idx = rawUrl.indexOf("/v1");
            if (v1Idx !== -1) {
              // Has /v1 path — rewrite to proxy
              targetUrl = PROXY_BASE + rawUrl.substring(v1Idx);
            } else {
              // Fallback: extract just the last path segment(s)
              // e.g. "undefined/chat/completions" → "/v1/chat/completions"
              const pathMatch = rawUrl.match(
                /\/(chat\/completions|models|completions|responses)(.*)/
              );
              if (pathMatch) {
                targetUrl = `${PROXY_BASE}/v1/${pathMatch[1]}${pathMatch[2]}`;
              } else {
                // Last resort — just send to proxy base
                targetUrl = `${PROXY_BASE}/v1/chat/completions`;
              }
            }

            // Strip Authorization header — proxy doesn't need it
            // (auth is handled by acli rovodev serve)
            const headers = new Headers(init?.headers);
            headers.delete("Authorization");
            headers.set("Content-Type", "application/json");

            return fetch(targetUrl, {
              ...init,
              headers,
            });
          },
        };
      },
      methods: [
        {
          type: "api" as const,
          label: "Rovo Dev (Local Proxy)",
        },
      ],
    },
  };
};

export default RovoDevPlugin;
