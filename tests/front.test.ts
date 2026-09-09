// The front over a fake upstream: a Hono app behind an injected `fetch`, so no
// test opens a socket. It answers `/mcp` the way the stateless SDK handler
// does — one SSE frame carrying the result, or JSON when asked — refuses a
// request with no key as the upstream's `401`, and echoes `Mcp-Session-Id`.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createFront } from "../index";

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

/** The same answer as a cold call gets it: the news first. */
const NEWS =
  "the server was starting when this call arrived, about 9 seconds; it is up now and this is the result.";
const coldAnswerTo = (id: unknown, method: string) => {
  const answer = answerTo(id, method);
  return {
    ...answer,
    result: {
      ...answer.result,
      content: [{ type: "text", text: NEWS }, ...answer.result.content],
    },
  };
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
    const response = await app.fetch(request);
    if (request.method === "POST" && options.fail?.()) {
      throw new TypeError("fetch failed");
    }
    return response;
  };
  return { hits, answered, requests, fetch };
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
  headers: Record<string, string> = { authorization: `Bearer ${KEY}` }
): Promise<Response> {
  return Promise.resolve(
    front.request("http://front/mcp", {
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

/** Cold-start timings a test can wait through. */
const COLD = { seconds: 9, probeTimeoutMs: 50 };

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
    // No probe on anything but a tools/call: one hop, nothing else.
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

  it("forwards a warm tools/call at once, probes beside it, and adds nothing to the answer", async () => {
    const upstream = fakeUpstream();
    const front = createFront({ upstream: UPSTREAM, fetch: upstream.fetch });

    const res = await post(
      front,
      message("tools/call", { name: "list_brands" })
    );

    expect(upstream.hits).toEqual(["POST /mcp", "GET /mcp"]);
    expect(res.status).toBe(200);
    const received = [];
    for await (const frame of frames(res)) received.push(frame);
    expect(received).toEqual([answerTo(7, "tools/call")]);
  });

  it("answers a cold tools/call before the upstream is up, then confirms, then relays", async () => {
    let up = false;
    const upstream = fakeUpstream({ up: () => up });
    const front = createFront({
      upstream: UPSTREAM,
      fetch: upstream.fetch,
      coldStart: COLD,
    });

    const res = await post(
      front,
      message("tools/call", { name: "render_image" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const stream = frames(res);
    expect((await stream.next()).value).toEqual({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        level: "info",
        logger: "the server",
        data: "the server is starting, about 9 seconds",
      },
    });
    // The first notice went out while the upstream was still down: the call
    // is on its way, and nothing has answered it.
    expect(upstream.hits).toContain("POST /mcp");
    expect(upstream.answered).toEqual([]);

    up = true;
    const rest = [];
    for await (const frame of stream) rest.push(frame);
    expect(rest).toEqual([
      {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          level: "info",
          logger: "the server",
          data: "the server is up, your request is now being processed",
        },
      },
      coldAnswerTo(7, "tools/call"),
    ]);
    expect(upstream.answered).toContain("POST /mcp");
    const call = upstream.requests.find((r) => r.method === "POST")!;
    expect(call.headers.get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("says the same as progress when the call carries a progressToken", async () => {
    let up = false;
    const upstream = fakeUpstream({ up: () => up });
    const front = createFront({
      upstream: UPSTREAM,
      fetch: upstream.fetch,
      coldStart: COLD,
    });
    setTimeout(() => {
      up = true;
    }, COLD.probeTimeoutMs * 3);

    const res = await post(
      front,
      message("tools/call", {
        name: "crop_image",
        _meta: { progressToken: "p1" },
      })
    );
    const received = [];
    for await (const frame of frames(res)) received.push(frame);

    expect(received.map((f) => (f as { method?: string }).method)).toEqual([
      "notifications/message",
      "notifications/progress",
      "notifications/message",
      "notifications/progress",
      undefined,
    ]);
    expect(received[1]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: {
        progressToken: "p1",
        progress: 0,
        message: "the server is starting, about 9 seconds",
      },
    });
  });

  it("wraps a JSON answer as the stream's final frame on the cold path", async () => {
    let up = false;
    const upstream = fakeUpstream({ up: () => up, answer: "json" });
    const front = createFront({
      upstream: UPSTREAM,
      fetch: upstream.fetch,
      coldStart: COLD,
    });

    const res = await post(
      front,
      message("tools/call", { name: "list_brands" })
    );
    const stream = frames(res);
    await stream.next();
    up = true;
    const rest = [];
    for await (const frame of stream) rest.push(frame);

    expect(rest.at(-1)).toEqual(coldAnswerTo(7, "tools/call"));
  });

  it("answers a JSON-RPC error with the call's id when the forwarded call is lost", async () => {
    let up = false;
    const upstream = fakeUpstream({ up: () => up, fail: () => true });
    const front = createFront({
      upstream: UPSTREAM,
      fetch: upstream.fetch,
      coldStart: COLD,
    });

    const res = await post(
      front,
      message("tools/call", { name: "list_brands" })
    );
    const stream = frames(res);
    await stream.next();
    up = true;
    const rest = [];
    for await (const frame of stream) rest.push(frame);

    expect(rest).toEqual([
      {
        jsonrpc: "2.0",
        id: 7,
        error: {
          code: -32000,
          message:
            "the server did not answer, send the call again: TypeError: fetch failed",
        },
      },
    ]);
  });

  it("relays a call with no credential as it is, so the upstream's 401 is the answer even cold", async () => {
    let up = false;
    const upstream = fakeUpstream({ up: () => up });
    const front = createFront({
      upstream: UPSTREAM,
      fetch: upstream.fetch,
      coldStart: COLD,
    });
    setTimeout(() => {
      up = true;
    }, COLD.probeTimeoutMs * 3);

    const res = await post(
      front,
      message("tools/call", { name: "list_brands" }),
      {}
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthorized" } });
    expect(upstream.hits).toEqual(["POST /mcp"]);
  });

  it("turns a refusal on the cold path into a JSON-RPC error, the status line being sent", async () => {
    let up = false;
    const upstream = fakeUpstream({ up: () => up });
    const front = createFront({
      upstream: UPSTREAM,
      fetch: upstream.fetch,
      coldStart: COLD,
    });

    const res = await post(
      front,
      message("tools/call", { name: "list_brands" }),
      { "x-auth-token": "not-the-key" }
    );
    const stream = frames(res);
    await stream.next();
    up = true;
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
});
