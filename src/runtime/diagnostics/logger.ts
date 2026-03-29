import type { RuntimeMessage } from "../backend/types.js";

import { extractTextFromMessageContent } from "../session/message-compiler.js";

export function logRequestSummary(scope: string, summary: string): void {
  console.log(`[${scope}] ${summary}`);
}

export function logWarning(scope: string, message: string): void {
  console.warn(`[${scope}] ${message}`);
}

export function summarizeTextPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

export function summarizeMessages(messages: RuntimeMessage[]): string {
  return messages
    .map((message, index) => {
      const preview = summarizeTextPreview(extractTextFromMessageContent(message.content));
      return `${index}:${message.role}=${preview || "<empty>"}`;
    })
    .join(" | ");
}
