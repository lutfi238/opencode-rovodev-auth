export type ParsedSSEChunk = {
  raw: string;
  data: any | null;
  text: string | null;
  isDone: boolean;
  isStreamEnd: boolean;
};

export function extractBackendText(data: any): string | null {
  if (!data || typeof data !== "object") return null;

  if (data.part_kind === "user-prompt") return null;

  if (data.event_kind === "part_start" && data.part?.part_kind === "text") {
    return data.part.content || null;
  }

  if (data.event_kind === "part_delta" && data.delta?.part_delta_kind === "text") {
    return data.delta.content_delta || null;
  }

  if (typeof data.text_delta === "string" && data.text_delta) {
    return data.text_delta;
  }

  if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
    return data.delta.text ?? null;
  }

  if (typeof data.delta?.text === "string") {
    return data.delta.text;
  }

  return null;
}

export function isBackendStreamEnd(data: any): boolean {
  if (!data || typeof data !== "object") return false;

  if (typeof data.input_tokens === "number" || typeof data.output_tokens === "number") {
    return true;
  }

  if (data.type === "message_stop") return true;
  if (data.type === "message_delta" && data.delta?.stop_reason) return true;
  if (data.done === true) return true;
  if (data.type === "end" || data.type === "stop") return true;
  if (data.event === "done" || data.event === "end") return true;

  return false;
}

export function parseSSELines(lines: string[]): ParsedSSEChunk[] {
  const chunks: ParsedSSEChunk[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;
    if (!trimmed.startsWith("data: ")) continue;

    const raw = trimmed.slice(6).trim();

    if (raw === "[DONE]") {
      chunks.push({
        raw,
        data: null,
        text: null,
        isDone: true,
        isStreamEnd: false,
      });
      continue;
    }

    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }

    chunks.push({
      raw,
      data,
      text: extractBackendText(data),
      isDone: false,
      isStreamEnd: isBackendStreamEnd(data),
    });
  }

  return chunks;
}
