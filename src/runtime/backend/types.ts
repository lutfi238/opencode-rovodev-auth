export type RuntimeMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

export type BackendCapabilities = {
  trueModelSelection: boolean;
  multimodalInput: boolean;
  nativeToolCalling: boolean;
  concurrentSessions: boolean;
  accurateUsage: boolean;
  resumableResponses: boolean;
};

export type BackendTurnRequest = {
  sessionId: string;
  model: string;
  messages: RuntimeMessage[];
  stream: boolean;
};

export type BackendTurnEvent =
  | { type: "text-delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "completed"; finishReason: string }
  | { type: "error"; message: string; status?: number };

export interface BackendDriver {
  getCapabilities(): BackendCapabilities;
  getBaseUrl(): string;
  checkHealth(): Promise<boolean>;
  sendTurn(request: BackendTurnRequest): Promise<Response>;
}
