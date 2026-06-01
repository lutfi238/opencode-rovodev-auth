import type { BackendCapabilities } from "../backend/types.js";

type RuntimeUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
};

type ChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type ResponsesUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

function sanitizeTokenCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function getUsageTokens(
  capabilities: Pick<BackendCapabilities, "accurateUsage">,
  usage?: RuntimeUsage,
): { inputTokens: number; outputTokens: number } {
  if (!capabilities.accurateUsage) {
    return { inputTokens: 0, outputTokens: 0 };
  }

  return {
    inputTokens: sanitizeTokenCount(usage?.inputTokens),
    outputTokens: sanitizeTokenCount(usage?.outputTokens),
  };
}

export function buildUsage(
  capabilities: Pick<BackendCapabilities, "accurateUsage">,
  format: "chat",
  usage?: RuntimeUsage,
): ChatUsage;
export function buildUsage(
  capabilities: Pick<BackendCapabilities, "accurateUsage">,
  format: "responses",
  usage?: RuntimeUsage,
): ResponsesUsage;
export function buildUsage(
  capabilities: Pick<BackendCapabilities, "accurateUsage">,
  format: "chat" | "responses",
  usage?: RuntimeUsage,
): ChatUsage | ResponsesUsage {
  const { inputTokens, outputTokens } = getUsageTokens(capabilities, usage);
  const totalTokens = inputTokens + outputTokens;

  if (format === "chat") {
    return {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: totalTokens,
    };
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

export function buildFinishReason(reason?: unknown): "stop" | "length" | "tool_calls" {
  if (reason === "length" || reason === "max_tokens") {
    return "length";
  }

  if (reason === "tool_calls") {
    return "tool_calls";
  }

  return "stop";
}
