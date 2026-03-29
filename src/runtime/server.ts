import { handleChatCompletionsRequest } from "./openai/chat.js";
import { handleModelsRequest } from "./openai/models.js";
import { handleResponsesRequest } from "./openai/responses.js";

import type { BackendDriver } from "./backend/types.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type RuntimeServer = {
  idleTimeout: number;
  fetch(req: Request): Promise<Response>;
};

function invalidRequestResponse(message: string, status = 400): Response {
  return Response.json(
    {
      error: {
        message,
        type: "invalid_request_error",
      },
    },
    { status },
  );
}

async function parseJsonBody(req: Request): Promise<any | Response> {
  try {
    return await req.json();
  } catch {
    return invalidRequestResponse("Invalid JSON body");
  }
}

export function createRuntimeServer(driver: BackendDriver): RuntimeServer {
  return {
    idleTimeout: 255,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const method = req.method;

      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        });
      }

      if (url.pathname === "/health" || url.pathname === "/healthcheck") {
        const rovoOk = await driver.checkHealth();
        return Response.json({
          status: rovoOk ? "healthy" : "degraded",
          proxy: "running",
          rovodev: rovoOk ? "connected" : "not_connected",
          rovodev_url: driver.getBaseUrl(),
        });
      }

      if (url.pathname === "/v1/models" && method === "GET") {
        return handleModelsRequest();
      }

      if (url.pathname === "/v1/chat/completions" && method === "POST") {
        const body = await parseJsonBody(req);
        if (body instanceof Response) {
          return body;
        }

        return handleChatCompletionsRequest(body, driver);
      }

      if (url.pathname === "/v1/responses" && method === "POST") {
        const body = await parseJsonBody(req);
        if (body instanceof Response) {
          return body;
        }

        return handleResponsesRequest(body, driver);
      }

      return invalidRequestResponse(`Unknown endpoint: ${method} ${url.pathname}`, 404);
    },
  };
}
