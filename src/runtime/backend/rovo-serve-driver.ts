import { logRequestSummary, logWarning } from "../diagnostics/logger.js";
import { ROVO_SERVE_CAPABILITIES } from "../policy/capability-policy.js";
import { formatMessages } from "../session/message-compiler.js";

import type {
  BackendCapabilities,
  BackendDriver,
  BackendTurnRequest,
} from "./types.js";

export class RovoServeDriver implements BackendDriver {
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly baseUrl: string,
    private readonly capabilities: BackendCapabilities = ROVO_SERVE_CAPABILITIES,
  ) {}

  getCapabilities(): BackendCapabilities {
    return this.capabilities;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/healthcheck`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  sendTurn(request: BackendTurnRequest): Promise<Response> {
    return this.enqueue(async () => {
      const prompt = formatMessages(request.messages);
      return this.sendAndStream(prompt);
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue = this.requestQueue
        .then(() => fn().then(resolve, reject))
        .catch(() => {});
    });
  }

  private async setMessage(text: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v3/set_chat_message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          enable_deep_plan: false,
        }),
      });

      return response.ok;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning("proxy", `Failed to set_chat_message: ${message}`);
      return false;
    }
  }

  private async waitForAgentIdle(maxWaitMs = 60_000): Promise<void> {
    const start = Date.now();
    const interval = 1500;

    while (Date.now() - start < maxWaitMs) {
      try {
        const response = await fetch(`${this.baseUrl}/v3/sessions/create`, {
          method: "POST",
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          return;
        }

        if (response.status === 409) {
          logRequestSummary("proxy", "Agent busy, waiting...");
        }
      } catch {
        // Network error — Rovo Dev might be restarting.
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    logWarning("proxy", "Timed out waiting for agent to become idle");
  }

  private async sendAndStream(prompt: string, maxRetries = 4): Promise<Response> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        logRequestSummary("proxy", `Retry attempt ${attempt + 1}/${maxRetries}...`);
        await this.waitForAgentIdle(30_000);
      }

      const messageSent = await this.setMessage(prompt);
      if (!messageSent) {
        if (attempt < maxRetries - 1) {
          logRequestSummary("proxy", "set_chat_message failed, waiting for idle...");
          await this.waitForAgentIdle(15_000);
          continue;
        }

        throw new Error("Failed to send message to Rovo Dev after retries");
      }

      const response = await fetch(`${this.baseUrl}/v3/stream_chat`, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      });

      if (response.ok) {
        return response;
      }

      if (response.status === 409) {
        logRequestSummary(
          "proxy",
          `stream_chat returned 409 (attempt ${attempt + 1}/${maxRetries})`
        );
        continue;
      }

      return response;
    }

    throw new Error("Rovo Dev agent remained busy after all retries");
  }
}
