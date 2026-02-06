#!/usr/bin/env bun
/**
 * Rovo Dev ↔ OpenAI API Proxy Server
 *
 * Translates OpenAI-compatible /v1/chat/completions requests into
 * Rovo Dev serve mode's /v3/ API and streams responses back in
 * OpenAI SSE format.
 *
 * Usage:
 *   1. Start Rovo Dev serve mode:
 *        acli rovodev serve 8123
 *   2. Start this proxy:
 *        bun rovodev-proxy.ts
 *      or:
 *        bun rovodev-proxy.ts --rovodev-port 8123 --proxy-port 4100
 *
 * OpenCode should be configured to use http://localhost:4100/v1 as the baseURL.
 */

const ROVODEV_PORT = parseInt(
  process.argv.find((_, i) => process.argv[i - 1] === "--rovodev-port") ?? "8123"
);
const PROXY_PORT = parseInt(
  process.argv.find((_, i) => process.argv[i - 1] === "--proxy-port") ?? "4100"
);
const ROVODEV_BASE = `http://localhost:${ROVODEV_PORT}`;

// ──────────────────────────────────────────────────────
// Request queue — Rovo Dev can only handle one request at
// a time since it's a single agent session. Serialise
// incoming OpenCode requests so they don't clobber each
// other's set_chat_message / stream_chat cycle.
// ──────────────────────────────────────────────────────

let requestQueue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestQueue = requestQueue
      .then(() => fn().then(resolve, reject))
      .catch(() => {});
  });
}

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function generateId(): string {
  return "chatcmpl-rovodev-" + Math.random().toString(36).slice(2, 12);
}

function formatMessages(
  messages: Array<{ role: string; content: string | any[] }>
): string {
  return messages
    .map((m) => {
      let content: string;
      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        // Handle multimodal content blocks — keep text only
        content = m.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
      } else {
        content = String(m.content ?? "");
      }

      switch (m.role) {
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

/** Send a chat message to Rovo Dev */
async function setMessage(text: string): Promise<boolean> {
  try {
    const resp = await fetch(`${ROVODEV_BASE}/v3/set_chat_message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        enable_deep_plan: false,
      }),
    });
    return resp.ok;
  } catch (e) {
    console.error("[proxy] Failed to set_chat_message:", e);
    return false;
  }
}

/** 
 * Wait for the Rovo Dev agent to become idle.
 * When the agent is busy (processing a previous request), both
 * sessions/create and stream_chat return 409.
 * We poll the healthcheck and try a lightweight probe until ready.
 */
async function waitForAgentIdle(maxWaitMs = 60_000): Promise<void> {
  const start = Date.now();
  const interval = 1500;
  
  while (Date.now() - start < maxWaitMs) {
    try {
      // Try sessions/create — returns 200 if idle, 409 if busy
      const resp = await fetch(`${ROVODEV_BASE}/v3/sessions/create`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        // Agent is idle and a fresh session was created
        return;
      }
      if (resp.status === 409) {
        console.log("[proxy] Agent busy, waiting...");
      }
    } catch {
      // Network error — Rovo Dev might be restarting
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  console.warn("[proxy] Timed out waiting for agent to become idle");
}

/**
 * Stream from Rovo Dev with retry on 409 (agent busy).
 * If stream_chat returns 409, we wait for idle and retry.
 */
async function streamChatWithRetry(maxRetries = 5): Promise<globalThis.Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(`${ROVODEV_BASE}/v3/stream_chat`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
    
    if (resp.ok) return resp;
    
    if (resp.status === 409 && attempt < maxRetries - 1) {
      console.log(`[proxy] stream_chat 409 (attempt ${attempt + 1}/${maxRetries}), waiting for idle...`);
      await waitForAgentIdle(30_000);
      // Need to re-send the message after session reset — caller handles this
      return resp; // Return 409 so caller can re-drive
    }
    
    // Non-409 error — return as-is
    return resp;
  }
  
  // Should not reach here, but just in case
  return await fetch(`${ROVODEV_BASE}/v3/stream_chat`, {
    method: "GET",
    headers: { Accept: "text/event-stream" },
  });
}

/**
 * Full send-and-stream cycle with retry on 409.
 * If stream_chat returns 409, waits for idle, re-sends message, and retries.
 */
async function sendAndStream(prompt: string, maxRetries = 4): Promise<globalThis.Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[proxy] Retry attempt ${attempt + 1}/${maxRetries}...`);
      await waitForAgentIdle(30_000);
    }
    
    const msgOk = await setMessage(prompt);
    if (!msgOk) {
      // If set_chat_message itself fails, wait and retry
      if (attempt < maxRetries - 1) {
        console.log("[proxy] set_chat_message failed, waiting for idle...");
        await waitForAgentIdle(15_000);
        continue;
      }
      throw new Error("Failed to send message to Rovo Dev after retries");
    }
    
    const resp = await fetch(`${ROVODEV_BASE}/v3/stream_chat`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
    
    if (resp.ok) return resp;
    
    if (resp.status === 409) {
      console.log(`[proxy] stream_chat returned 409 (attempt ${attempt + 1}/${maxRetries})`);
      continue; // Will wait for idle at top of loop
    }
    
    // Other error — return immediately
    return resp;
  }
  
  throw new Error("Rovo Dev agent remained busy after all retries");
}

// ──────────────────────────────────────────────────────
// SSE Event Parser (Rovo Dev → text chunks)
// ──────────────────────────────────────────────────────

/**
 * Extracts text content from a Rovo Dev SSE event JSON.
 * The exact format varies so we try multiple patterns.
 */
function extractText(data: any): string | null {
  if (!data || typeof data !== "object") return null;

  // ── Skip user-prompt echo from Rovo Dev ──
  if (data.part_kind === "user-prompt") return null;

  // ── Rovo Dev part_start: {event_kind:"part_start", part:{content, part_kind:"text"}} ──
  if (data.event_kind === "part_start" && data.part?.part_kind === "text") {
    return data.part.content || null;
  }

  // ── Rovo Dev part_delta: {event_kind:"part_delta", delta:{content_delta, part_delta_kind:"text"}} ──
  if (data.event_kind === "part_delta" && data.delta?.part_delta_kind === "text") {
    return data.delta.content_delta || null;
  }

  // ── Fallback patterns for non-Rovo-Dev providers (kept for safety) ──

  // top-level text_delta
  if (typeof data.text_delta === "string" && data.text_delta) {
    return data.text_delta;
  }

  // Anthropic content_block_delta with text_delta
  if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
    return data.delta.text ?? null;
  }

  // delta.text (generic)
  if (typeof data.delta?.text === "string") {
    return data.delta.text;
  }

  return null;
}

/** Check if this SSE event signals the end of the stream. */
function isStreamEnd(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  // Rovo Dev: usage/token event signals end
  if (typeof data.input_tokens === "number" || typeof data.output_tokens === "number") return true;
  if (data.type === "message_stop") return true;
  if (data.type === "message_delta" && data.delta?.stop_reason) return true;
  if (data.done === true) return true;
  if (data.type === "end" || data.type === "stop") return true;
  if (data.event === "done" || data.event === "end") return true;
  return false;
}

// ──────────────────────────────────────────────────────
// SSE line processor (shared by transform & flush)
// Returns true if [DONE] was emitted.
// ──────────────────────────────────────────────────────

function processSSELines(
  lines: string[],
  chatId: string,
  timestamp: number,
  model: string,
  encoder: TextEncoder,
  controller: TransformStreamDefaultController,
  alreadyDone: boolean
): boolean {
  let sentDone = alreadyDone;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;

    if (!trimmed.startsWith("data: ")) continue;

    const jsonStr = trimmed.slice(6).trim();

    if (jsonStr === "[DONE]") {
      if (!sentDone) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        sentDone = true;
      }
      continue;
    }

    let data: any;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      continue; // skip un-parseable
    }

    // Emit text content
    const textContent = extractText(data);
    if (textContent) {
      const openaiChunk = {
        id: chatId,
        object: "chat.completion.chunk",
        created: timestamp,
        model,
        choices: [
          { index: 0, delta: { content: textContent }, finish_reason: null },
        ],
      };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`)
      );
    }

    // Emit stop if stream ended
    if (!sentDone && isStreamEnd(data)) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: chatId,
            object: "chat.completion.chunk",
            created: timestamp,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`
        )
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      sentDone = true;
    }
  }

  return sentDone;
}

// ──────────────────────────────────────────────────────
// Streaming handler (Responses API — /v1/responses)
// ──────────────────────────────────────────────────────

async function handleStreamingResponsesAPI(
  messages: any[],
  model: string
): Promise<Response> {
  const respId = "resp_rovodev-" + Math.random().toString(36).slice(2, 12);
  const itemId = "item_rovodev-" + Math.random().toString(36).slice(2, 12);
  const contentPartId = "cp_rovodev-" + Math.random().toString(36).slice(2, 12);
  const timestamp = Math.floor(Date.now() / 1000);

  const prompt = formatMessages(messages);
  let rovoResp: globalThis.Response;
  try {
    rovoResp = await sendAndStream(prompt);
  } catch (e: any) {
    return Response.json(
      {
        error: {
          message: e?.message || "Failed to communicate with Rovo Dev.",
          type: "proxy_error",
        },
      },
      { status: 502 }
    );
  }

  if (!rovoResp.ok || !rovoResp.body) {
    return Response.json(
      {
        error: {
          message: `Rovo Dev stream_chat returned ${rovoResp.status}`,
          type: "proxy_error",
        },
      },
      { status: 502 }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = "";
  let doneSent = false;
  let preambleSent = false;
  let fullText = "";
  let seqNum = 0;

  /** Emit a properly typed Responses API SSE event. */
  function emitEvent(
    controller: TransformStreamDefaultController,
    eventType: string,
    data: any
  ) {
    data.type = eventType;
    data.sequence_number = seqNum++;
    controller.enqueue(
      encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
    );
  }

  /** Build the response object used in response.created / response.completed */
  function buildResponseObject(status: string, outputItems?: any[]) {
    return {
      id: respId,
      object: "response",
      created_at: timestamp,
      status,
      model,
      output: outputItems ?? [],
      usage: null,
    };
  }

  function emitPreamble(controller: TransformStreamDefaultController) {
    if (preambleSent) return;
    preambleSent = true;

    // response.created — response object nested under "response" key
    emitEvent(controller, "response.created", {
      response: buildResponseObject("in_progress"),
    });

    // response.in_progress
    emitEvent(controller, "response.in_progress", {
      response: buildResponseObject("in_progress"),
    });

    // response.output_item.added
    emitEvent(controller, "response.output_item.added", {
      output_index: 0,
      item: {
        id: itemId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [],
      },
    });

    // response.content_part.added
    emitEvent(controller, "response.content_part.added", {
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
  }

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      const parts = buffer.split("\n");
      buffer = parts.pop() || "";

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data: ")) continue;

        const jsonStr = trimmed.slice(6).trim();
        if (jsonStr === "[DONE]") {
          doneSent = true;
          continue;
        }

        let data: any;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const textContent = extractText(data);
        if (textContent) {
          emitPreamble(controller);
          fullText += textContent;
          emitEvent(controller, "response.output_text.delta", {
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            delta: textContent,
          });
        }

        if (isStreamEnd(data)) {
          doneSent = true;
        }
      }
    },

    flush(controller) {
      // Drain remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr !== "[DONE]") {
            try {
              const data = JSON.parse(jsonStr);
              const textContent = extractText(data);
              if (textContent) {
                emitPreamble(controller);
                fullText += textContent;
                emitEvent(controller, "response.output_text.delta", {
                  item_id: itemId,
                  output_index: 0,
                  content_index: 0,
                  delta: textContent,
                });
              }
              if (isStreamEnd(data)) {
                doneSent = true;
              }
            } catch {}
          }
        }
      }

      // Emit closing events
      if (preambleSent) {
        const completedItem = {
          id: itemId,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: fullText,
              annotations: [],
            },
          ],
        };

        // response.output_text.done
        emitEvent(controller, "response.output_text.done", {
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          text: fullText,
        });

        // response.content_part.done
        emitEvent(controller, "response.content_part.done", {
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: fullText, annotations: [] },
        });

        // response.output_item.done
        emitEvent(controller, "response.output_item.done", {
          output_index: 0,
          item: completedItem,
        });

        // response.completed — full response wrapped in "response" key
        emitEvent(controller, "response.completed", {
          response: {
            ...buildResponseObject("completed", [completedItem]),
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              total_tokens: 0,
            },
          },
        });
      }
    },
  });

  const transformed = rovoResp.body.pipeThrough(transformStream);

  return new Response(transformed, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ──────────────────────────────────────────────────────
// Non-streaming handler (Responses API — /v1/responses)
// ──────────────────────────────────────────────────────

async function handleNonStreamingResponsesAPI(
  messages: any[],
  model: string
): Promise<Response> {
  const respId = "resp_rovodev-" + Math.random().toString(36).slice(2, 12);
  const itemId = "item_rovodev-" + Math.random().toString(36).slice(2, 12);

  const prompt = formatMessages(messages);
  let rovoResp: globalThis.Response;
  try {
    rovoResp = await sendAndStream(prompt);
  } catch (e: any) {
    return Response.json(
      {
        error: {
          message: e?.message || "Failed to communicate with Rovo Dev.",
          type: "proxy_error",
        },
      },
      { status: 502 }
    );
  }

  if (!rovoResp.ok) {
    return Response.json(
      {
        error: {
          message: `Rovo Dev stream_chat returned ${rovoResp.status}`,
          type: "proxy_error",
        },
      },
      { status: 502 }
    );
  }

  const fullSSE = await rovoResp.text();
  let content = "";

  for (const line of fullSSE.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const jsonStr = trimmed.slice(6).trim();
    if (jsonStr === "[DONE]") continue;
    try {
      const data = JSON.parse(jsonStr);
      const text = extractText(data);
      if (text) content += text;
    } catch {}
  }

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
        content: [{ type: "output_text", text: content }],
      },
    ],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  });
}

/**
 * Parse a Responses API request body into a flat messages array.
 * Handles both the `input` array of messages and `instructions` system prompt.
 */
function parseResponsesAPIInput(body: any): any[] {
  const messages: any[] = [];

  // instructions → system message
  if (typeof body.instructions === "string" && body.instructions) {
    messages.push({ role: "system", content: body.instructions });
  }

  const input = body.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
      } else if (item && typeof item === "object") {
        // Could be {role, content} or {type: "message", role, content: [...]}
        if (item.type === "message" && Array.isArray(item.content)) {
          // Extract text from content blocks
          const text = item.content
            .filter((c: any) => c.type === "input_text" || c.type === "output_text" || c.type === "text")
            .map((c: any) => c.text)
            .join("\n");
          if (text) {
            messages.push({ role: item.role || "user", content: text });
          }
        } else if (item.role && item.content) {
          // Simple {role, content} message
          messages.push({ role: item.role, content: item.content });
        }
      }
    }
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "(empty)" });
  }

  return messages;
}

// ──────────────────────────────────────────────────────
// Streaming handler (Chat Completions)
// ──────────────────────────────────────────────────────

async function handleStreamingCompletion(
  messages: any[],
  model: string
): Promise<Response> {
  const chatId = generateId();
  const timestamp = Math.floor(Date.now() / 1000);

  const prompt = formatMessages(messages);
  let rovoResp: globalThis.Response;
  try {
    rovoResp = await sendAndStream(prompt);
  } catch (e: any) {
    return Response.json(
      {
        error: {
          message: e?.message || "Failed to communicate with Rovo Dev.",
          type: "proxy_error",
        },
      },
      { status: 502 }
    );
  }

  if (!rovoResp.ok || !rovoResp.body) {
    return Response.json(
      {
        error: {
          message: `Rovo Dev stream_chat returned ${rovoResp.status}`,
          type: "proxy_error",
        },
      },
      { status: 502 }
    );
  }

  // ---- Transform Rovo Dev SSE → OpenAI SSE ----
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Closure state (avoids unreliable `this.buffer` on TransformStream)
  let buffer = "";
  let doneSent = false;

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      // Split into complete lines; keep last (possibly incomplete) part
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";

      doneSent = processSSELines(
        parts,
        chatId,
        timestamp,
        model,
        encoder,
        controller,
        doneSent
      );
    },

    flush(controller) {
      // Drain any remaining data in the buffer
      if (buffer.trim()) {
        doneSent = processSSELines(
          [buffer],
          chatId,
          timestamp,
          model,
          encoder,
          controller,
          doneSent
        );
      }

      // Safety net: if Rovo Dev's stream closed without a proper
      // end event, send stop + [DONE] so the AI SDK doesn't hang.
      if (!doneSent) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: chatId,
              object: "chat.completion.chunk",
              created: timestamp,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
    },
  });

  const transformed = rovoResp.body.pipeThrough(transformStream);

  return new Response(transformed, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ──────────────────────────────────────────────────────
// Non-streaming handler
// ──────────────────────────────────────────────────────

async function handleNonStreamingCompletion(
  messages: any[],
  model: string
): Promise<Response> {
  const chatId = generateId();
  const timestamp = Math.floor(Date.now() / 1000);

  const prompt = formatMessages(messages);
  let rovoResp: globalThis.Response;
  try {
    rovoResp = await sendAndStream(prompt);
  } catch (e: any) {
    return Response.json(
      {
        error: {
          message: e?.message || "Failed to communicate with Rovo Dev.",
          type: "proxy_error",
        },
      },
      { status: 502 }
    );
  }

  if (!rovoResp.ok) {
    return Response.json(
      {
        error: {
          message: `Rovo Dev stream_chat returned ${rovoResp.status}`,
          type: "proxy_error",
        },
      },
      { status: 502 }
    );
  }

  const fullText = await rovoResp.text();
  let content = "";

  for (const line of fullText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const jsonStr = trimmed.slice(6).trim();
    if (jsonStr === "[DONE]") continue;
    try {
      const data = JSON.parse(jsonStr);
      const text = extractText(data);
      if (text) content += text;
    } catch {
      // skip
    }
  }

  return Response.json({
    id: chatId,
    object: "chat.completion",
    created: timestamp,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

// ──────────────────────────────────────────────────────
// Responses API wrappers — reuse chat completions, wrap output
// ──────────────────────────────────────────────────────

/**
 * Streaming Responses API: internally calls Rovo Dev the same way as
 * chat completions, but wraps the SSE output in Responses API events.
 */
async function handleStreamingResponsesViaCompletions(
  messages: any[],
  model: string
): Promise<Response> {
  const respId = "resp_rovodev-" + Math.random().toString(36).slice(2, 12);
  const itemId = "item_rovodev-" + Math.random().toString(36).slice(2, 12);

  const prompt = formatMessages(messages);
  let rovoResp: globalThis.Response;
  try {
    rovoResp = await sendAndStream(prompt);
  } catch (e: any) {
    return Response.json(
      { error: { message: e?.message || "Failed to communicate with Rovo Dev.", type: "proxy_error" } },
      { status: 502 }
    );
  }

  if (!rovoResp.ok || !rovoResp.body) {
    return Response.json(
      { error: { message: `Rovo Dev stream_chat returned ${rovoResp.status}`, type: "proxy_error" } },
      { status: 502 }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = "";
  let fullText = "";
  let preambleSent = false;
  let seqNum = 0;
  let usageData = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  function emit(controller: TransformStreamDefaultController, eventType: string, payload: any) {
    payload.type = eventType;
    payload.sequence_number = seqNum++;
    controller.enqueue(encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`));
  }

  function buildResp(status: string, items?: any[]) {
    return { id: respId, object: "response" as const, created_at: Math.floor(Date.now()/1000), status, model, output: items ?? [], usage: null as any };
  }

  function sendPreamble(controller: TransformStreamDefaultController) {
    if (preambleSent) return;
    preambleSent = true;
    emit(controller, "response.created", { response: buildResp("in_progress") });
    emit(controller, "response.in_progress", { response: buildResp("in_progress") });
    emit(controller, "response.output_item.added", {
      output_index: 0,
      item: { id: itemId, type: "message", role: "assistant", status: "in_progress", content: [] },
    });
    emit(controller, "response.content_part.added", {
      item_id: itemId, output_index: 0, content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
  }

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6).trim();
        if (jsonStr === "[DONE]") continue;

        let data: any;
        try { data = JSON.parse(jsonStr); } catch { continue; }

        // Capture token usage from Rovo Dev
        if (typeof data.input_tokens === "number") {
          usageData = { input_tokens: data.input_tokens || 0, output_tokens: data.output_tokens || 0, total_tokens: (data.input_tokens || 0) + (data.output_tokens || 0) };
        }

        const text = extractText(data);
        if (text) {
          sendPreamble(controller);
          fullText += text;
          emit(controller, "response.output_text.delta", {
            item_id: itemId, output_index: 0, content_index: 0, delta: text,
          });
        }
      }
    },

    flush(controller) {
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr !== "[DONE]") {
            try {
              const data = JSON.parse(jsonStr);
              const text = extractText(data);
              if (text) {
                sendPreamble(controller);
                fullText += text;
                emit(controller, "response.output_text.delta", {
                  item_id: itemId, output_index: 0, content_index: 0, delta: text,
                });
              }
            } catch {}
          }
        }
      }

      if (preambleSent) {
        const completedItem = {
          id: itemId, type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: fullText, annotations: [] }],
        };
        emit(controller, "response.output_text.done", {
          item_id: itemId, output_index: 0, content_index: 0, text: fullText,
        });
        emit(controller, "response.content_part.done", {
          item_id: itemId, output_index: 0, content_index: 0,
          part: { type: "output_text", text: fullText, annotations: [] },
        });
        emit(controller, "response.output_item.done", { output_index: 0, item: completedItem });
        emit(controller, "response.completed", {
          response: { ...buildResp("completed", [completedItem]), usage: usageData },
        });
      }
    },
  });

  const transformed = rovoResp.body.pipeThrough(transformStream);

  return new Response(transformed, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Non-streaming Responses API: calls Rovo Dev, collects full text,
 * wraps in Responses API JSON format.
 */
async function handleNonStreamingResponsesViaCompletions(
  messages: any[],
  model: string
): Promise<Response> {
  const respId = "resp_rovodev-" + Math.random().toString(36).slice(2, 12);
  const itemId = "item_rovodev-" + Math.random().toString(36).slice(2, 12);

  const prompt = formatMessages(messages);
  let rovoResp: globalThis.Response;
  try {
    rovoResp = await sendAndStream(prompt);
  } catch (e: any) {
    return Response.json(
      { error: { message: e?.message || "Failed to communicate with Rovo Dev.", type: "proxy_error" } },
      { status: 502 }
    );
  }

  if (!rovoResp.ok) {
    return Response.json(
      { error: { message: `Rovo Dev stream_chat returned ${rovoResp.status}`, type: "proxy_error" } },
      { status: 502 }
    );
  }

  const fullSSE = await rovoResp.text();
  let content = "";
  for (const line of fullSSE.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const jsonStr = trimmed.slice(6).trim();
    if (jsonStr === "[DONE]") continue;
    try {
      const data = JSON.parse(jsonStr);
      const text = extractText(data);
      if (text) content += text;
    } catch {}
  }

  return Response.json({
    id: respId,
    object: "response",
    status: "completed",
    model,
    output: [{
      id: itemId,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: content, annotations: [] }],
    }],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  });
}

// ──────────────────────────────────────────────────────
// Model list
// ──────────────────────────────────────────────────────

const MODEL_LIST = {
  object: "list",
  data: [
    { id: "rovodev-auto", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-claude-sonnet-4-5", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-claude-sonnet-4", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-claude-haiku-4-5", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gpt-5-2-codex", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gpt-5-2", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gpt-5-1", object: "model", owned_by: "atlassian-rovodev" },
    { id: "rovodev-gpt-5", object: "model", owned_by: "atlassian-rovodev" },
  ],
};

// ──────────────────────────────────────────────────────
// HTTP Server
// ──────────────────────────────────────────────────────

async function checkRovoDevHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${ROVODEV_BASE}/healthcheck`, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

Bun.serve({
  port: PROXY_PORT,
  idleTimeout: 255,   // max allowed – SSE streams can be long
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Health / readiness
    if (url.pathname === "/health" || url.pathname === "/healthcheck") {
      const rovoOk = await checkRovoDevHealth();
      return Response.json({
        status: rovoOk ? "healthy" : "degraded",
        proxy: "running",
        rovodev: rovoOk ? "connected" : "not_connected",
        rovodev_url: ROVODEV_BASE,
      });
    }

    // Models
    if (url.pathname === "/v1/models" && method === "GET") {
      return Response.json(MODEL_LIST);
    }

    // Chat completions — serialized through request queue
    if (url.pathname === "/v1/chat/completions" && method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
          { status: 400 }
        );
      }

      const messages = body.messages ?? [];
      const model = body.model ?? "rovodev-auto";
      const stream = body.stream ?? false;

      console.log(
        `[proxy] completions ${stream ? "stream" : "sync"} | model=${model} | msgs=${messages.length}`
      );

      return enqueue(async () => {
        if (stream) {
          return handleStreamingCompletion(messages, model);
        } else {
          return handleNonStreamingCompletion(messages, model);
        }
      });
    }

    // Responses API — reuse chat completions internally, wrap output
    if (url.pathname === "/v1/responses" && method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
          { status: 400 }
        );
      }

      const messages = parseResponsesAPIInput(body);
      const model = body.model ?? "rovodev-auto";
      const stream = body.stream ?? false;

      console.log(
        `[proxy] responses ${stream ? "stream" : "sync"} | model=${model} | msgs=${messages.length}`
      );

      return enqueue(async () => {
        if (stream) {
          return handleStreamingResponsesViaCompletions(messages, model);
        } else {
          return handleNonStreamingResponsesViaCompletions(messages, model);
        }
      });
    }

    // Fallback
    return Response.json(
      { error: { message: `Unknown endpoint: ${method} ${url.pathname}`, type: "invalid_request_error" } },
      { status: 404 }
    );
  },
});

console.log(`
 ┌──────────────────────────────────────────────────────────┐
 │        Rovo Dev  <->  OpenAI API  Proxy Server           │
 ├──────────────────────────────────────────────────────────┤
 │  Proxy listening on:   http://localhost:${PROXY_PORT}             │
 │  Rovo Dev expected at: ${ROVODEV_BASE}            │
 │  OpenCode baseURL:     http://localhost:${PROXY_PORT}/v1          │
 └──────────────────────────────────────────────────────────┘

  Make sure 'acli rovodev serve ${ROVODEV_PORT}' is running first!
`);

checkRovoDevHealth().then((ok) => {
  if (ok) {
    console.log("[proxy] ✓ Rovo Dev serve is reachable");
  } else {
    console.warn(
      `[proxy] ✗ Cannot reach Rovo Dev at ${ROVODEV_BASE}. Start it with: acli rovodev serve ${ROVODEV_PORT}`
    );
  }
});
