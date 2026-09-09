/**
 * The one case the front does not merely forward: a `tools/call` that arrives
 * while the upstream container is scaled to zero. A cold start takes seconds,
 * and an agent that hears nothing for that long gives up or guesses. So the
 * call is forwarded at once and a probe races it: when the probe hears
 * nothing inside its timeout, the front opens the Streamable HTTP stream and
 * says what is happening as JSON-RPC notifications — which the spec lets a
 * server send on the request's own stream before the final response — then
 * confirms the moment the upstream answers the forwarded call and pipes the
 * real result through unchanged. The platform holds a request to a container
 * that is starting, so the forwarded call itself is the wait; nothing is
 * sent twice and nothing polls.
 */

export interface ColdStart {
  /**
   * What the notices call the upstream — it reaches a person reading their
   * agent's log, so it is the server's own name, not a hostname.
   */
  readonly name: string;
  /**
   * What the first notice promises: "about N seconds". Your own last measured
   * upstream cold start; a constant, so the promise is never a guess.
   */
  readonly seconds: number;
  /**
   * How long the probe waits for any answer before the upstream counts as
   * cold. A warm container answers a `GET` on the endpoint from its
   * middleware, with no database or store behind it, in a few milliseconds
   * over the binding.
   */
  readonly probeTimeoutMs: number;
}

export const COLD_START: ColdStart = {
  name: "the server",
  seconds: 7,
  probeTimeoutMs: 500,
};

/** What a `tools/call` carries that its notifications have to name. */
export interface ToolCall {
  readonly id: string | number | null;
  readonly progressToken?: string | number;
}

/**
 * The `tools/call` in a POST body, or `null` for any other message — a body
 * that is not JSON, or a batch, included: both are forwarded for the upstream
 * to answer as it sees fit. (The MCP spec dropped batching in 2025-06-18.)
 */
export function toolCall(body: string): ToolCall | null {
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const { method, id, params } = message as {
    method?: unknown;
    id?: unknown;
    params?: { _meta?: { progressToken?: unknown } };
  };
  if (method !== "tools/call") return null;
  const token = params?._meta?.progressToken;
  return {
    id: typeof id === "string" || typeof id === "number" ? id : null,
    ...(typeof token === "string" || typeof token === "number"
      ? { progressToken: token }
      : {}),
  };
}

const frameRaw = (json: string): string => `event: message\ndata: ${json}\n\n`;
const frame = (message: unknown): string => frameRaw(JSON.stringify(message));

/**
 * The same news for a client that shows no notification: prepended to the
 * result's `content` as its first text block. Anything
 * that is not a tool result with content — an error, a notification, a
 * frame that is not JSON — passes as it came; `structuredContent` is never
 * touched.
 */
export function withNews(message: unknown, news: string): unknown {
  if (typeof message !== "object" || message === null) return message;
  const { result } = message as { result?: { content?: unknown } };
  if (result === undefined || !Array.isArray(result.content)) return message;
  return {
    ...message,
    result: {
      ...result,
      content: [{ type: "text", text: news }, ...result.content],
    },
  };
}

/**
 * The upstream's SSE stream, frame by frame, each `data:` message passed
 * through `transform`. A frame whose data is not JSON is re-emitted as it
 * came; whatever is left after the last blank line is flushed as it came.
 */
async function* reframed(
  body: ReadableStream<Uint8Array>,
  transform: (message: unknown) => unknown
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const lines = buffer.slice(0, end).split("\n");
      buffer = buffer.slice(end + 2);
      const at = lines.findIndex((line) => line.startsWith("data:"));
      if (at !== -1) {
        try {
          const message: unknown = JSON.parse(lines[at]!.slice(5));
          lines[at] = `data: ${JSON.stringify(transform(message))}`;
        } catch {
          // not JSON: as it came
        }
      }
      yield `${lines.join("\n")}\n\n`;
      end = buffer.indexOf("\n\n");
    }
  }
  if (buffer !== "") yield buffer;
}

/**
 * The news as `notifications/message` (level info), which every client may
 * receive, and as `notifications/progress` too when the call asked for
 * progress — the SDK client drops a progress notification whose token it
 * never issued, so that one is sent only when it will be heard.
 */
function notices(
  call: ToolCall,
  logger: string,
  text: string,
  progress: number
): unknown[] {
  const out: unknown[] = [
    {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", logger, data: text },
    },
  ];
  if (call.progressToken !== undefined) {
    out.push({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: call.progressToken, progress, message: text },
    });
  }
  return out;
}

const rpcError = (call: ToolCall, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  id: call.id,
  error: { code: -32000, message, ...(data === undefined ? {} : { data }) },
});

export interface ColdStartStream {
  readonly call: ToolCall;
  readonly config: ColdStart;
  /** The call, already on its way to the upstream. */
  readonly forwarded: Promise<Response>;
}

/**
 * The response for a cold `tools/call`: the stream opens at once with the
 * first notice, the confirmation follows when the upstream answers the call
 * that is already in flight, then whatever it answered. An SSE answer is
 * piped frame by frame, a JSON one becomes the stream's final frame, and in
 * both the tool result's first content block carries the same news; a
 * refusal or a failure becomes a JSON-RPC error with the call's id, because
 * the status line has already been sent. The upstream's own response headers
 * arrive after that status line and are not relayed here; it is stateless
 * and issues no `Mcp-Session-Id`, so nothing is lost today.
 */
export function coldStartStream(deps: ColdStartStream): Response {
  const { call, config } = deps;
  const { name } = config;
  const encoder = new TextEncoder();
  const run = async (
    controller: ReadableStreamDefaultController<Uint8Array>
  ): Promise<void> => {
    const send = (message: unknown): void => {
      controller.enqueue(encoder.encode(frame(message)));
    };
    for (const notice of notices(
      call,
      name,
      `${name} is starting, about ${config.seconds} seconds`,
      0
    )) {
      send(notice);
    }
    let response: Response;
    try {
      response = await deps.forwarded;
    } catch (error) {
      send(
        rpcError(
          call,
          `${name} did not answer, send the call again: ${String(error)}`
        )
      );
      return;
    }
    for (const notice of notices(
      call,
      name,
      `${name} is up, your request is now being processed`,
      1
    )) {
      send(notice);
    }
    if (!response.ok) {
      send(
        rpcError(
          call,
          `${name} answered ${response.status}`,
          await response.text()
        )
      );
      return;
    }
    const news = `${name} was starting when this call arrived, about ${config.seconds} seconds; it is up now and this is the result.`;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      if (response.body !== null) {
        for await (const text of reframed(response.body, (message) =>
          withNews(message, news)
        )) {
          controller.enqueue(encoder.encode(text));
        }
      }
      return;
    }
    const text = await response.text();
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      controller.enqueue(encoder.encode(frameRaw(text)));
      return;
    }
    send(withNews(message, news));
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void run(controller)
        .catch((error: unknown) => {
          controller.enqueue(
            encoder.encode(frame(rpcError(call, String(error))))
          );
        })
        .finally(() => controller.close());
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}
