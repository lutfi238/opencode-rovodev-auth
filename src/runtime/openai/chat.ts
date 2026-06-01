import {
  logRequestSummary,
  logWarning,
  summarizeMessages,
  summarizeTextPreview,
} from "../diagnostics/logger.js";
import { applyCapabilityFallbacks } from "../policy/capability-policy.js";
import { DEFAULT_MODEL } from "../policy/model-policy.js";
import { cleanOutputText, createOutputGuard } from "../session/output-guard.js";
import { normalizeIncomingMessages } from "../session/message-compiler.js";
import { buildFinishReason, buildUsage } from "../session/response-builder.js";
import { buildChatCompletionChunk } from "../stream/sse-mapper.js";
import { parseSSELines } from "../stream/sse-parser.js";

import type { BackendDriver, RuntimeMessage } from "../backend/types.js";

function generateId(): string {
  return "chatcmpl-rovodev-" + Math.random().toString(36).slice(2, 12);
}

function proxyErrorResponse(message: string): Response {
  return Response.json(
    {
      error: {
        message,
        type: "proxy_error",
      },
    },
    { status: 502 },
  );
}

function invalidRequestResponse(message: string): Response {
  return Response.json(
    {
      error: {
        message,
        type: "invalid_request_error",
      },
    },
    { status: 400 },
  );
}

function logSuppressedNarration(scope: string, suppressedText: string): void {
  if (!suppressedText) {
    return;
  }

  logWarning(scope, `suppressed leading narration: ${summarizeTextPreview(suppressedText)}`);
}

function processSSELines(
  lines: string[],
  chatId: string,
  timestamp: number,
  model: string,
  encoder: TextEncoder,
  controller: TransformStreamDefaultController,
  scope: string,
  guard: ReturnType<typeof createOutputGuard>,
  alreadyDone: boolean,
): boolean {
  let sentDone = alreadyDone;

  for (const chunk of parseSSELines(lines)) {
    if (chunk.isDone) {
      const finalGuarded = guard.finish();
      logSuppressedNarration(scope, finalGuarded.suppressedText);
      if (finalGuarded.emitText) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(
              buildChatCompletionChunk({
                id: chatId,
                created: timestamp,
                model,
                content: finalGuarded.emitText,
              }),
            )}\n\n`,
          ),
        );
      }

      if (!sentDone) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(
              buildChatCompletionChunk({
                id: chatId,
                created: timestamp,
                model,
                finishReason: buildFinishReason(),
              }),
            )}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        sentDone = true;
      }
      continue;
    }

    if (chunk.text) {
      const guarded = guard.push(chunk.text);
      logSuppressedNarration(scope, guarded.suppressedText);
      if (guarded.emitText) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(
              buildChatCompletionChunk({
                id: chatId,
                created: timestamp,
                model,
                content: guarded.emitText,
              }),
            )}\n\n`,
          ),
        );
      }
    }

    if (!sentDone && chunk.isStreamEnd) {
      const finalGuarded = guard.finish();
      logSuppressedNarration(scope, finalGuarded.suppressedText);
      if (finalGuarded.emitText) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(
              buildChatCompletionChunk({
                id: chatId,
                created: timestamp,
                model,
                content: finalGuarded.emitText,
              }),
            )}\n\n`,
          ),
        );
      }

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify(
              buildChatCompletionChunk({
                id: chatId,
                created: timestamp,
                model,
                finishReason: buildFinishReason(),
              }),
            )}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      sentDone = true;
    }
  }

  return sentDone;
}

async function handleStreamingCompletion(
  driver: BackendDriver,
  messages: RuntimeMessage[],
  model: string,
): Promise<Response> {
  const chatId = generateId();
  const timestamp = Math.floor(Date.now() / 1000);

  let rovoResp: Response;
  try {
    rovoResp = await driver.sendTurn({
      sessionId: "rovodev-proxy",
      model,
      messages,
      stream: true,
    });
  } catch (error: unknown) {
    return proxyErrorResponse(
      error instanceof Error ? error.message : "Failed to communicate with Rovo Dev.",
    );
  }

  if (!rovoResp.ok || !rovoResp.body) {
    return proxyErrorResponse(`Rovo Dev stream_chat returned ${rovoResp.status}`);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const guard = createOutputGuard();

  let buffer = "";
  let doneSent = false;

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      const parts = buffer.split("\n");
      buffer = parts.pop() || "";

      doneSent = processSSELines(
        parts,
        chatId,
        timestamp,
        model,
        encoder,
        controller,
        "proxy",
        guard,
        doneSent,
      );
    },

    flush(controller) {
      if (buffer.trim()) {
        doneSent = processSSELines(
          [buffer],
          chatId,
          timestamp,
          model,
          encoder,
          controller,
          "proxy",
          guard,
          doneSent,
        );
      }

      const finalGuarded = guard.finish();
      logSuppressedNarration("proxy", finalGuarded.suppressedText);
      if (finalGuarded.emitText) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(
              buildChatCompletionChunk({
                id: chatId,
                created: timestamp,
                model,
                content: finalGuarded.emitText,
              }),
            )}\n\n`,
          ),
        );
      }

      if (!doneSent) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(
              buildChatCompletionChunk({
                id: chatId,
                created: timestamp,
                model,
                finishReason: buildFinishReason(),
              }),
            )}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
    },
  });

  return new Response(rovoResp.body.pipeThrough(transformStream), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleNonStreamingCompletion(
  driver: BackendDriver,
  messages: RuntimeMessage[],
  model: string,
): Promise<Response> {
  const chatId = generateId();
  const timestamp = Math.floor(Date.now() / 1000);

  let rovoResp: Response;
  try {
    rovoResp = await driver.sendTurn({
      sessionId: "rovodev-proxy",
      model,
      messages,
      stream: false,
    });
  } catch (error: unknown) {
    return proxyErrorResponse(
      error instanceof Error ? error.message : "Failed to communicate with Rovo Dev.",
    );
  }

  if (!rovoResp.ok) {
    return proxyErrorResponse(`Rovo Dev stream_chat returned ${rovoResp.status}`);
  }

  const fullText = await rovoResp.text();
  let content = "";

  for (const parsed of parseSSELines(fullText.split("\n"))) {
    if (parsed.text) {
      content += parsed.text;
    }
  }

  const decision = cleanOutputText(content);
  logSuppressedNarration("proxy", decision.suppressedPrefix);
  content = decision.cleanedText;

  const capabilities = driver.getCapabilities();

  return Response.json({
    id: chatId,
    object: "chat.completion",
    created: timestamp,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: buildFinishReason(),
      },
    ],
    usage: buildUsage(capabilities, "chat"),
  });
}

export async function handleChatCompletionsRequest(
  body: any,
  driver: BackendDriver,
): Promise<Response> {
  const capabilities = driver.getCapabilities();
  const normalizedBody = applyCapabilityFallbacks(body, capabilities);
  if (normalizedBody === null) {
    return invalidRequestResponse("Request body must be a JSON object.");
  }

  const messages = normalizeIncomingMessages(normalizedBody, {
    preserveEmptyMessages: true,
  });
  const model =
    typeof normalizedBody?.model === "string" && normalizedBody.model
      ? normalizedBody.model
      : DEFAULT_MODEL;
  const stream = normalizedBody?.stream ?? false;

  logRequestSummary(
    "proxy",
    `completions ${stream ? "stream" : "sync"} | model=${model} | bodyKeys=${Object.keys(
      normalizedBody,
    ).join(",")} | msgs=${messages.length} | ${summarizeMessages(messages)}`,
  );

  return stream
    ? handleStreamingCompletion(driver, messages, model)
    : handleNonStreamingCompletion(driver, messages, model);
}
