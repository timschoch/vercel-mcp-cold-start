// The front over a fake upstream: a Hono app behind an injected `fetch`, so no
// test opens a socket. It answers `/mcp` the way the stateless SDK handler
// does, one SSE frame carrying the result, or JSON when asked, refuses a
// request with no key as the upstream's `401`, and echoes `Mcp-Session-Id`.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { NOTICES, createFront } from "../index";

const UPSTREAM = "http://upstream.internal";
const KEY = "sk_test_the_key";

/** What the fake upstream answers a message with: a tool result echoing the method. */
const answerTo = (id: unknown, method: string) => ({
  jsonrpc: "2.0",
  id,
  result: {
    content: [{ type: "text", text: JSON.stringify({ echo: method }) }],
  },
});

const NOTICE = {
  jsonrpc: "2.0",
  method: "notifications/message",
  params: {
    level: "info",
    logger: "the server",
    data: "the server is processing your request",
  },
};

/**
 * The fake upstream. `up` says whether the container is listening right now;
 * while it is not, every request is held the way the platform holds one to
 * a container that is starting, and answered once it is. `hits` records
 * arrivals, `answered` completions. `fail` makes a POST reject after the hold,
 * as a connection the platform dropped would.
 */
function fakeUpstream(
  options: {
    up?: () => boolean;
    answer?: "sse" | "json";
    fail?: () => boolean;
  } = {}
) {
  const hits: string[] = [];
  const answered: string[] = [];
  const requests: Request[] = [];
  const signals: AbortSignal[] = [];
  const app = new Hono();
  app.use(async (c, next) => {
    hits.push(`${c.req.method} ${c.req.path}`);
    while (!(options.up?.() ?? true)) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await next();
    answered.push(`${c.req.method} ${c.req.path}`);
  });
  app.all("/mcp", async (c) => {
    requests.push(c.req.raw.clone());
    if (c.req.method !== "POST") return c.body(null, 405);
    const key =
      c.req.header("x-auth-token") ??
      c.req.header("authorization")?.replace(/^Bearer /, "");
    if (key !== KEY) {
      return c.json({ error: { code: "unauthorized" } }, 401);
    }
    const message = JSON.parse(await c.req.text()) as {
      id: unknown;
      method: string;
    };
    const result = answerTo(message.id, message.method);
    const session = c.req.header("mcp-session-id");
    const headers: Record<string, string> =
      session === undefined ? {} : { "mcp-session-id": session };
    if (options.answer === "json") return c.json(result, 200, headers);
    return c.body(`event: message\ndata: ${JSON.stringify(result)}\n\n`, 200, {
      ...headers,
      "content-type": "text/event-stream",
    });
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (init?.signal !== undefined && init.signal !== null) {
      signals.push(init.signal);
    }
    const response = await app.fetch(request);
    if (request.method === "POST" && options.fail?.()) {
      throw new TypeError("fetch failed");
    }
    return response;
  };
  return { hits, answered, requests, signals, fetch };
}

const message = (
  method: string,
  params: unknown = {}
): { jsonrpc: string; id: number; method: string; params: unknown } => ({
  jsonrpc: "2.0",
  id: 7,
  method,
  params,
});

function post(
  front: Hono,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${KEY}` },
  init: RequestInit = {}
): Promise<Response> {
  return Promise.resolve(
    front.request("http://front/mcp", {
      ...init,
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    })
  );
}

/** The SSE frames of a response, one parsed `data:` message per frame. */
async function* frames(response: Response): AsyncGenerator<unknown> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const data = buffer
        .slice(0, end)
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      buffer = buffer.slice(end + 2);
      if (data !== undefined) yield JSON.parse(data);
      end = buffer.indexOf("\n\n");
    }
  }
}

/** Notice timings a test can wait through. */
const FAST = { firstNoticeMs: 20, repeatNoticeMs: 30 };

/** A front over an upstream that is down until `up()` is called. */
function slowFront(options: { answer?: "sse" | "json"; fail?: boolean } = {}) {
  let ready = false;
  const upstream = fakeUpstream({
    up: () => ready,
    ...(options.answer === undefined ? {} : { answer: options.answer }),
    ...(options.fail === undefined ? {} : { fail: () => options.fail! }),
  });
  const front = createFront({
    upstream: UPSTREAM,
    fetch: upstream.fetch,
    notices: FAST,
  });
  return {
    upstream,
    front,
    up: () => {
      ready = true;
    },
  };
}

describe("@timschoch/vercel-mcp-cold-start", () => {
  it("forwards a message verbatim and relays the answer as it came", async () => {
    const upstream = fakeUpstream();
    const front = createFront({ upstream: UPSTREAM, fetch: upstream.fetch });
    const body = message("tools/list");

    const res = await post(front, body);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe(
      `event: message\ndata: ${JSON.stringify(answerTo(7, "tools/list"))}\n\n`
    );
    // One hop, nothing else: no probe beside it.
    expect(upstream.hits).toEqual(["POST /mcp"]);
    const seen = upstream.requests[0]!;
    expect(new URL(seen.url).href).toBe(`${UPSTREAM}/mcp`);
    expect(seen.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(seen.headers.get("accept")).toBe(
      "application/json, text/event-stream"
    );
    expect(await seen.text()).toBe(JSON.stringify(body));
  });

  it("carries x-auth-token too, and a request with no key is the upstream's 401", async () => {
    const upstream = fakeUpstream();
    const front = createFront({ upstream: UPSTREAM, fetch: upstream.fetch });

    const token = await post(front, message("initialize"), {
      "x-auth-token": KEY,
    });
    expect(token.status).toBe(200);
    expect(upstream.requests[0]!.headers.get("x-auth-token")).toBe(KEY);

    const none = await post(front, message("initialize"), {});
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: { code: "unauthorized" } });
  });

  it("carries Mcp-Session-Id both ways", async () => {
    const upstream = fakeUpstream();
    const front = createFront({ upstream: UPSTREAM, fetch: upstream.fetch });

    const res = await post(front, message("tools/list"), {
      authorization: `Bearer ${KEY}`,
      "mcp-session-id": "session-42",
    });

    expect(upstream.requests[0]!.headers.get("mcp-session-id")).toBe(
      "session-42"
    );
    expect(res.headers.get("mcp-session-id")).toBe("session-42");
  });

  it("forwards GET and DELETE untouched, so the upstream's 405 is the answer", async () => {
    const upstream = fakeUpstream();
    const front = createFront({ upstream: UPSTREAM, fetch: upstream.fetch });

    for (const method of ["GET", "DELETE"]) {
      const res = await front.request("http://front/mcp", {
        method,
        headers: { authorization: `Bearer ${KEY}` },
      });
      expect(res.status).toBe(405);
    }
    expect(upstream.hits).toEqual(["GET /mcp", "DELETE /mcp"]);
  });

  it("hands the caller's signal to the hop, so a client that hangs up takes it down", async () => {
    const upstream = fakeUpstream();
    const front = createFront({ upstream: UPSTREAM, fetch: upstream.fetch });
    const controller = new AbortController();

    await post(front, message("tools/list"), undefined, {
      signal: controller.signal,
    });

    expect(upstream.signals).toHaveLength(1);
    expect(upstream.signals[0]!.aborted).toBe(false);
    controller.abort();
    expect(upstream.signals[0]!.aborted).toBe(true);
  });

  for (const method of ["tools/list", "initialize", "tools/call"]) {
    it(`says a slow ${method} is being processed, then relays the answer as it came`, async () => {
      const { upstream, front, up } = slowFront();

      const res = await post(front, message(method, { name: "render" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      expect(res.headers.get("x-accel-buffering")).toBe("no");

      const stream = frames(res);
      expect((await stream.next()).value).toEqual(NOTICE);
      // The notice went out while the upstream was still down: the request
      // is on its way, and nothing has answered it.
      expect(upstream.hits).toEqual(["POST /mcp"]);
      expect(upstream.answered).toEqual([]);

      up();
      const rest = [];
      for await (const frame of stream) rest.push(frame);
      expect(rest.at(-1)).toEqual(answerTo(7, method));
      for (const frame of rest.slice(0, -1)) expect(frame).toEqual(NOTICE);
      expect(upstream.answered).toEqual(["POST /mcp"]);
    });
  }

  it("repeats the notice until the upstream answers", async () => {
    const { front, up } = slowFront();
    setTimeout(up, FAST.firstNoticeMs + FAST.repeatNoticeMs * 2.5);

    const res = await post(front, message("tools/list"));
    const received = [];
    for await (const frame of frames(res)) received.push(frame);

    expect(received.length).toBeGreaterThanOrEqual(4);
    for (const frame of received.slice(0, -1)) expect(frame).toEqual(NOTICE);
    expect(received.at(-1)).toEqual(answerTo(7, "tools/list"));
  });

  it("says the same as progress, counting up, when the request carries a progressToken", async () => {
    const { front, up } = slowFront();
    setTimeout(up, FAST.firstNoticeMs + FAST.repeatNoticeMs * 1.5);

    const res = await post(
      front,
      message("tools/call", { name: "crop", _meta: { progressToken: "p1" } })
    );
    const received = [];
    for await (const frame of frames(res)) received.push(frame);

    const methods = received.map((f) => (f as { method?: string }).method);
    expect(methods.slice(0, 4)).toEqual([
      "notifications/message",
      "notifications/progress",
      "notifications/message",
      "notifications/progress",
    ]);
    expect(methods.at(-1)).toBeUndefined();
    expect(received[1]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: {
        progressToken: "p1",
        progress: 0,
        message: "the server is processing your request",
      },
    });
    expect(
      (received[3] as { params: { progress: number } }).params.progress
    ).toBe(1);
  });

  it("wraps a slow JSON answer as the stream's one final frame", async () => {
    const { front, up } = slowFront({ answer: "json" });

    const res = await post(front, message("tools/list"));
    const stream = frames(res);
    await stream.next();
    up();
    const rest = [];
    for await (const frame of stream) rest.push(frame);

    expect(rest.at(-1)).toEqual(answerTo(7, "tools/list"));
  });

  it("relays a slow notification as it is, because nothing waits on it", async () => {
    const { upstream, front, up } = slowFront();
    setTimeout(up, FAST.firstNoticeMs * 3);

    const res = await post(front, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    expect(res.status).toBe(200);
    expect(upstream.answered).toEqual(["POST /mcp"]);
    const received = [];
    for await (const frame of frames(res)) received.push(frame);
    expect(received).toHaveLength(1);
    expect(received[0]).not.toEqual(NOTICE);
  });

  it("answers a JSON-RPC error with the request's id when the forwarded request is lost", async () => {
    const { front, up } = slowFront({ fail: true });

    const res = await post(front, message("tools/list"));
    const stream = frames(res);
    await stream.next();
    up();
    const rest = [];
    for await (const frame of stream) rest.push(frame);

    expect(rest.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32000,
        message:
          "the server did not answer, send the request again: TypeError: fetch failed",
      },
    });
  });

  it("turns a slow refusal into a JSON-RPC error, the status line being sent", async () => {
    const { front, up } = slowFront();

    const res = await post(front, message("tools/list"), {
      "x-auth-token": "not-the-key",
    });
    const stream = frames(res);
    await stream.next();
    up();
    const rest = [];
    for await (const frame of stream) rest.push(frame);

    expect(rest.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32000,
        message: "the server answered 401",
        data: JSON.stringify({ error: { code: "unauthorized" } }),
      },
    });
  });

  // The package root is the only surface a consumer sees. This holds the
  // export in place as much as the values.
  it("exports the defaults a caller does not override", () => {
    expect(NOTICES).toEqual({
      name: "the server",
      firstNoticeMs: 500,
      repeatNoticeMs: 2000,
    });
  });
});
