/**
 * The one thing the front adds to a hop: a word to the client while the
 * upstream is slow. A container scaled to zero takes seconds to answer its
 * first request, and a client that hears nothing for that long marks the
 * server down. So every JSON-RPC request is forwarded at once and raced
 * against a timer. When the timer wins, the front opens the Streamable HTTP
 * stream and says on it, as a JSON-RPC notification, that the request is
 * being processed; the spec lets a server send notifications on the
 * request's own stream before the final response. The notice repeats until
 * the upstream answers the forwarded request, and that answer is piped
 * through as it came. Nothing is sent twice and nothing polls.
 */

export interface Notices {
  /**
   * What the notices call the upstream. It reaches a person reading their
   * agent's log, so it is the server's own name, not a hostname.
   */
  readonly name: string;
  /** How long a request may go unanswered before the first notice. */
  readonly firstNoticeMs: number;
  /** How long between one notice and the next while the request is open. */
  readonly repeatNoticeMs: number;
}

export const NOTICES: Notices = {
  name: "the server",
  firstNoticeMs: 500,
  repeatNoticeMs: 2000,
};

/** What a JSON-RPC request carries that its notifications have to name. */
export interface RpcRequest {
  readonly id: string | number;
  readonly progressToken?: string | number;
}

/**
 * The JSON-RPC request in a POST body, or `null` for anything that gets no
 * notice: a body that is not JSON, a batch, or a notification, which has no
 * `id` and so nothing a client waits on. All of those are forwarded for the
 * upstream to answer as it sees fit.
 */
export function rpcRequest(body: string): RpcRequest | null {
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
  if (typeof method !== "string") return null;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const token = params?._meta?.progressToken;
  return {
    id,
    ...(typeof token === "string" || typeof token === "number"
      ? { progressToken: token }
      : {}),
  };
}

const frameRaw = (json: string): string => `event: message\ndata: ${json}\n\n`;
const frame = (message: unknown): string => frameRaw(JSON.stringify(message));

/**
 * The notice as `notifications/message` (level info), which every client may
 * receive, and as `notifications/progress` too when the request asked for
 * progress: the SDK client drops a progress notification whose token it
 * never issued, so that one is sent only when it will be heard.
 */
function notices(
  rpc: RpcRequest,
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
  if (rpc.progressToken !== undefined) {
    out.push({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: rpc.progressToken, progress, message: text },
    });
  }
  return out;
}

const rpcError = (rpc: RpcRequest, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  id: rpc.id,
  error: { code: -32000, message, ...(data === undefined ? {} : { data }) },
});

export interface NoticeStream {
  readonly rpc: RpcRequest;
  readonly config: Notices;
  /** The request, already on its way to the upstream. */
  readonly forwarded: Promise<Response>;
}

/**
 * The response for a request the upstream has not answered in time: the
 * stream opens at once with the first notice, repeats it every
 * `repeatNoticeMs`, then carries whatever the upstream answered. An SSE
 * answer is piped as it came, a JSON one becomes the stream's one final
 * frame; a refusal or a failure becomes a JSON-RPC error with the request's
 * id, because the status line has already been sent. The upstream's own
 * response headers arrive after that status line and are not relayed here.
 */
export function noticeStream(deps: NoticeStream): Response {
  const { rpc, config } = deps;
  const { name } = config;
  const text = `${name} is processing your request`;
  const encoder = new TextEncoder();
  const run = async (
    controller: ReadableStreamDefaultController<Uint8Array>
  ): Promise<void> => {
    const send = (message: unknown): void => {
      controller.enqueue(encoder.encode(frame(message)));
    };
    let progress = 0;
    const notify = (): void => {
      for (const notice of notices(rpc, name, text, progress)) send(notice);
      progress += 1;
    };
    notify();
    const repeat = setInterval(notify, config.repeatNoticeMs);
    let response: Response;
    try {
      response = await deps.forwarded;
    } catch (error) {
      send(
        rpcError(
          rpc,
          `${name} did not answer, send the request again: ${String(error)}`
        )
      );
      return;
    } finally {
      clearInterval(repeat);
    }
    if (!response.ok) {
      send(
        rpcError(
          rpc,
          `${name} answered ${response.status}`,
          await response.text()
        )
      );
      return;
    }
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      if (response.body !== null) {
        for await (const chunk of response.body) controller.enqueue(chunk);
      }
      return;
    }
    controller.enqueue(encoder.encode(frameRaw(await response.text())));
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void run(controller)
        .catch((error: unknown) => {
          controller.enqueue(
            encoder.encode(frame(rpcError(rpc, String(error))))
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
      // Tells a buffering proxy on the way to the client to pass each frame
      // on as it is written. The notice is useless if it arrives with the
      // answer.
      "x-accel-buffering": "no",
    },
  });
}
