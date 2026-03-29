import type { BackendCapabilities } from "../backend/types.js";

export const ROVO_SERVE_CAPABILITIES: BackendCapabilities = {
  trueModelSelection: false,
  multimodalInput: false,
  nativeToolCalling: false,
  concurrentSessions: false,
  accurateUsage: false,
  resumableResponses: false,
};

function isTextLikeContentPart(part: unknown): boolean {
  if (typeof part === "string") {
    return true;
  }

  if (!part || typeof part !== "object") {
    return false;
  }

  const contentPart = part as { type?: unknown };

  return (
    contentPart.type === "text" ||
    contentPart.type === "input_text" ||
    contentPart.type === "output_text"
  );
}

function filterTextOnlyContent(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }

  return content.filter(isTextLikeContentPart);
}

export function applyCapabilityFallbacks<T>(
  body: T,
  capabilities: Pick<BackendCapabilities, "multimodalInput" | "nativeToolCalling">,
): T {
  if (!body || typeof body !== "object") {
    return body;
  }

  const normalizedBody = { ...(body as Record<string, unknown>) };

  if (!capabilities.nativeToolCalling) {
    delete normalizedBody.tools;
    delete normalizedBody.tool_choice;
    delete normalizedBody.parallel_tool_calls;
  }

  if (!capabilities.multimodalInput) {
    if (Array.isArray(normalizedBody.messages)) {
      normalizedBody.messages = normalizedBody.messages.map((message) => {
        if (!message || typeof message !== "object") {
          return message;
        }

        const normalizedMessage = { ...(message as Record<string, unknown>) };
        normalizedMessage.content = filterTextOnlyContent(normalizedMessage.content);
        return normalizedMessage;
      });
    }

    if (Array.isArray(normalizedBody.input)) {
      normalizedBody.input = normalizedBody.input.map((item) => {
        if (!item || typeof item !== "object") {
          return item;
        }

        const normalizedItem = { ...(item as Record<string, unknown>) };
        if ("content" in normalizedItem) {
          normalizedItem.content = filterTextOnlyContent(normalizedItem.content);
        }
        return normalizedItem;
      });
    }
  }

  return normalizedBody as T;
}
