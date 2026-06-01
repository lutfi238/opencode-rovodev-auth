type BuildChatCompletionChunkOptions = {
  id: string;
  created: number;
  model: string;
  content?: string;
  finishReason?: string | null;
};

type BuildResponsesOutputTextDeltaOptions = {
  itemId: string;
  outputIndex: number;
  contentIndex: number;
  delta: string;
};

export function buildChatCompletionChunk({
  id,
  created,
  model,
  content,
  finishReason = null,
}: BuildChatCompletionChunkOptions) {
  return {
    id,
    object: "chat.completion.chunk" as const,
    created,
    model,
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        finish_reason: finishReason,
      },
    ],
  };
}

export function buildResponsesOutputTextDelta({
  itemId,
  outputIndex,
  contentIndex,
  delta,
}: BuildResponsesOutputTextDeltaOptions) {
  return {
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
    delta,
  };
}
