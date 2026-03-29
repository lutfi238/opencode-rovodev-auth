import type { RuntimeMessage } from "../backend/types.js";

export function extractTextFromContentPart(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }

  if (!part || typeof part !== "object") {
    return "";
  }

  const contentPart = part as {
    type?: unknown;
    text?: unknown;
    input_text?: unknown;
    content?: unknown;
    value?: unknown;
  };

  if (
    contentPart.type === "text" ||
    contentPart.type === "input_text" ||
    contentPart.type === "output_text"
  ) {
    if (typeof contentPart.text === "string") {
      return contentPart.text;
    }

    if (typeof contentPart.input_text === "string") {
      return contentPart.input_text;
    }

    if (typeof contentPart.content === "string") {
      return contentPart.content;
    }

    if (typeof contentPart.value === "string") {
      return contentPart.value;
    }

    if (contentPart.text && typeof contentPart.text === "object") {
      const nestedText = contentPart.text as {
        value?: unknown;
        content?: unknown;
      };

      if (typeof nestedText.value === "string") {
        return nestedText.value;
      }

      if (typeof nestedText.content === "string") {
        return nestedText.content;
      }
    }
  }

  return "";
}

export function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map(extractTextFromContentPart).filter(Boolean).join("\n");
  }

  if (content && typeof content === "object") {
    return extractTextFromContentPart(content);
  }

  return String(content ?? "");
}

export function parseResponsesAPIInput(body: any): RuntimeMessage[] {
  const messages: RuntimeMessage[] = [];

  if (typeof body?.instructions === "string" && body.instructions) {
    messages.push({ role: "system", content: body.instructions });
  }

  const input = body?.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
        continue;
      }

      if (!item || typeof item !== "object") {
        continue;
      }

      if (item.type === "message" && "content" in item) {
        const text = extractTextFromMessageContent(item.content);
        if (text) {
          messages.push({
            role: (item.role || "user") as RuntimeMessage["role"],
            content: text,
          });
        }
        continue;
      }

      if (item.role && "content" in item) {
        const text = extractTextFromMessageContent(item.content);
        if (text) {
          messages.push({
            role: item.role as RuntimeMessage["role"],
            content: text,
          });
        }
        continue;
      }

      const text = extractTextFromMessageContent(item);
      if (text) {
        messages.push({
          role: "user",
          content: text,
        });
      }
    }
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "(empty)" });
  }

  return messages;
}

export function normalizeIncomingMessages(
  body: any,
  options?: { preserveEmptyMessages?: boolean },
): RuntimeMessage[] {
  if (Array.isArray(body?.messages)) {
    if (body.messages.length > 0) {
      return body.messages as RuntimeMessage[];
    }

    if (options?.preserveEmptyMessages) {
      return [];
    }
  }

  const parsedResponsesInput = parseResponsesAPIInput(body);
  if (
    parsedResponsesInput.length > 1 ||
    extractTextFromMessageContent(parsedResponsesInput[0]?.content) !== "(empty)"
  ) {
    return parsedResponsesInput;
  }

  if (typeof body?.prompt === "string" && body.prompt.trim()) {
    return [{ role: "user", content: body.prompt }];
  }

  return parsedResponsesInput;
}

export function formatMessages(messages: RuntimeMessage[]): string {
  return messages
    .map((message) => {
      const content = extractTextFromMessageContent(message.content);

      switch (message.role) {
        case "system":
          return `[System Instructions]\n${content}`;
        case "assistant":
          return `[Assistant]\n${content}`;
        case "user":
          return `[User]\n${content}`;
        default:
          return content;
      }
    })
    .join("\n\n");
}
