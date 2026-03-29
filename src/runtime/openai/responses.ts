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
import { buildUsage } from "../session/response-builder.js";
import { buildResponsesOutputTextDelta } from "../stream/sse-mapper.js";
import { parseSSELines } from "../stream/sse-parser.js";

import type { BackendDriver, RuntimeMessage } from "../backend/types.js";

function generateId(prefix: string): string {
  return `${prefix}_rovodev-` + Math.random().toString(36).slice(2, 12);
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

async function handleStreamingResponses(
  driver: BackendDriver,
  messages: RuntimeMessage[],
  model: string,
): Promise<Response> {
  const respId = generateId("resp");
  const itemId = generateId("item");
  const createdAt = Math.floor(Date.now() / 1000);

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
  const capabilities = driver.getCapabilities();
  const guard = createOutputGuard();

  let buffer = "";
  let fullText = "";
  let preambleSent = false;
  let seqNum = 0;

  function emit(
    controller: TransformStreamDefaultController,
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    payload.type = eventType;
    payload.sequence_number = seqNum++;
    controller.enqueue(
      encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`),
    );
  }

  function buildResponse(status: string, items?: Array<Record<string, unknown>>) {
    return {
      id: respId,
      object: "response" as const,
      created_at: createdAt,
      status,
      model,
      output: items ?? [],
      usage: null as { input_tokens: number; output_tokens: number; total_tokens: number } | null,
    };
  }

  function emitPreamble(controller: TransformStreamDefaultController) {
    if (preambleSent) {
      return;
    }

    preambleSent = true;
    emit(controller, "response.created", { response: buildResponse("in_progress") });
    emit(controller, "response.in_progress", { response: buildResponse("in_progress") });
    emit(controller, "response.output_item.added", {
      output_index: 0,
      item: {
        id: itemId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [],
      },
    });
    emit(controller, "response.content_part.added", {
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
  }

  const transformStream = new TransformStream({
    start(controller) {
      emitPreamble(controller);
    },

    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";

      for (const parsed of parseSSELines(parts)) {
        if (parsed.text) {
          const guarded = guard.push(parsed.text);
          logSuppressedNarration("proxy", guarded.suppressedText);
          if (guarded.emitText) {
            fullText += guarded.emitText;
            emit(controller, "response.output_text.delta", {
              ...buildResponsesOutputTextDelta({
                itemId,
                outputIndex: 0,
                contentIndex: 0,
                delta: guarded.emitText,
              }),
            });
          }
        }

        if (parsed.isDone || parsed.isStreamEnd) {
          const finalGuarded = guard.finish();
          logSuppressedNarration("proxy", finalGuarded.suppressedText);
          if (finalGuarded.emitText) {
            fullText += finalGuarded.emitText;
            emit(controller, "response.output_text.delta", {
              ...buildResponsesOutputTextDelta({
                itemId,
                outputIndex: 0,
                contentIndex: 0,
                delta: finalGuarded.emitText,
              }),
            });
          }
        }
      }
    },

    flush(controller) {
      if (buffer.trim()) {
        for (const parsed of parseSSELines([buffer])) {
          if (parsed.text) {
            const guarded = guard.push(parsed.text);
            logSuppressedNarration("proxy", guarded.suppressedText);
            if (guarded.emitText) {
              fullText += guarded.emitText;
              emit(controller, "response.output_text.delta", {
                ...buildResponsesOutputTextDelta({
                  itemId,
                  outputIndex: 0,
                  contentIndex: 0,
                  delta: guarded.emitText,
                }),
              });
            }
          }

          if (parsed.isDone || parsed.isStreamEnd) {
            const finalGuarded = guard.finish();
            logSuppressedNarration("proxy", finalGuarded.suppressedText);
            if (finalGuarded.emitText) {
              fullText += finalGuarded.emitText;
              emit(controller, "response.output_text.delta", {
                ...buildResponsesOutputTextDelta({
                  itemId,
                  outputIndex: 0,
                  contentIndex: 0,
                  delta: finalGuarded.emitText,
                }),
              });
            }
          }
        }
      }

      const finalGuarded = guard.finish();
      logSuppressedNarration("proxy", finalGuarded.suppressedText);
      if (finalGuarded.emitText) {
        fullText += finalGuarded.emitText;
        emit(controller, "response.output_text.delta", {
          ...buildResponsesOutputTextDelta({
            itemId,
            outputIndex: 0,
            contentIndex: 0,
            delta: finalGuarded.emitText,
          }),
        });
      }

      if (preambleSent) {
        const completedItem = {
          id: itemId,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: fullText, annotations: [] }],
        };

        emit(controller, "response.output_text.done", {
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          text: fullText,
        });
        emit(controller, "response.content_part.done", {
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: fullText, annotations: [] },
        });
        emit(controller, "response.output_item.done", {
          output_index: 0,
          item: completedItem,
        });
        emit(controller, "response.completed", {
          response: {
            ...buildResponse("completed", [completedItem]),
            usage: buildUsage(capabilities, "responses"),
          },
        });
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

async function handleNonStreamingResponses(
  driver: BackendDriver,
  messages: RuntimeMessage[],
  model: string,
): Promise<Response> {
  const respId = generateId("resp");
  const itemId = generateId("item");

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

  const fullSSE = await rovoResp.text();
  let content = "";

  for (const parsed of parseSSELines(fullSSE.split("\n"))) {
    if (parsed.text) {
      content += parsed.text;
    }
  }

  const decision = cleanOutputText(content);
  logSuppressedNarration("proxy", decision.suppressedPrefix);
  content = decision.cleanedText;

  return Response.json({
    id: respId,
    object: "response",
    status: "completed",
    model,
    output: [
      {
        id: itemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: content, annotations: [] }],
      },
    ],
    usage: buildUsage(driver.getCapabilities(), "responses"),
  });
}

export async function handleResponsesRequest(
  body: any,
  driver: BackendDriver,
): Promise<Response> {
  const capabilities = driver.getCapabilities();
  const normalizedBody = applyCapabilityFallbacks(body, capabilities);
  if (normalizedBody === null) {
    return invalidRequestResponse("Request body must be a JSON object.");
  }

  const messages = normalizeIncomingMessages(normalizedBody);
  const model =
    typeof normalizedBody?.model === "string" && normalizedBody.model
      ? normalizedBody.model
      : DEFAULT_MODEL;
  const stream = normalizedBody?.stream ?? false;

  logRequestSummary(
    "proxy",
    `responses ${stream ? "stream" : "sync"} | model=${model} | bodyKeys=${Object.keys(
      normalizedBody,
    ).join(",")} | msgs=${messages.length} | ${summarizeMessages(messages)}`,
  );

  return stream
    ? handleStreamingResponses(driver, messages, model)
    : handleNonStreamingResponses(driver, messages, model);
}
