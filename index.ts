/**
 * The front: the light Function the mount hands requests to. It knows no
 * tool and checks no path: whatever reaches it goes to the upstream endpoint
 * as it came, and every answer comes back as it was, so a tool added, renamed
 * or reshaped in the upstream reaches a client with no change here. One case
 * is intercepted, `lib/cold-start.ts`: a `tools/call` that arrives while the
 * container is scaled to zero is told so within a second.
 */
import { Hono } from "hono";
import {
  COLD_START,
  type ColdStart,
  coldStartStream,
  toolCall,
} from "./lib/cold-start";
import { relay, toUpstream } from "./lib/forward";

export type { ColdStart } from "./lib/cold-start";
// The defaults themselves, so a caller can read what it does not override.
export { COLD_START } from "./lib/cold-start";

export interface FrontDeps {
  /**
   * The upstream MCP endpoint, a full URL: `https://host/api/mcp`. Used as
   * given; the front joins nothing onto it.
   */
  readonly upstream: string;
  /** Reaches the upstream. The global `fetch` by default. */
  readonly fetch?: typeof fetch;
  /** The cold-start timings; `COLD_START` for whatever is not given. */
  readonly coldStart?: Partial<ColdStart>;
}

export function createFront(deps: FrontDeps): Hono {
  const { fetch = globalThis.fetch } = deps;
  const target = new URL(deps.upstream);
  const config: ColdStart = { ...COLD_START, ...deps.coldStart };

  /**
   * Whether the upstream answers at all inside the probe timeout. A `GET` on
   * the endpoint with no key is the cheapest answer the container gives, a
   * `401` from its middleware with no database or store behind it; `/health`
   * with a stale cache costs seconds. A platform `5xx` while the container
   * starts is not an answer. The timer races the fetch rather than trusting
   * the fetch to honour its signal.
   */
  const up = (): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), config.probeTimeoutMs);
      fetch(target, { signal: AbortSignal.timeout(config.probeTimeoutMs) })
        .then(
          (response) => {
            void response.body?.cancel();
            resolve(response.status < 500);
          },
          () => resolve(false)
        )
        .finally(() => clearTimeout(timer));
    });

  const app = new Hono();
  // Every path: the mount (a rewrite, a route file) already chose what
  // arrives here, and a second vote could only agree or answer 404.
  app.all("*", async (c) => {
    const request = c.req.raw;
    const body = request.method === "POST" ? await request.text() : null;
    // On its way before anything else: the platform holds a request to a
    // container that is starting, so the forwarded call is also the wait.
    const forwarded = fetch(toUpstream(request, target, body));
    const call = body === null ? null : toolCall(body);
    // A call with no credential at all is the upstream's `401` whenever it
    // answers; intercepting it would turn that into a `200` with an error
    // frame while the container is cold. Relayed as it is instead.
    const credentialed =
      request.headers.has("authorization") ||
      request.headers.has("x-auth-token");
    if (call === null || !credentialed) return relay(await forwarded);
    const first = await Promise.race([
      forwarded.then(
        () => "answered" as const,
        () => "answered" as const
      ),
      up().then((ok) => (ok ? ("up" as const) : ("cold" as const))),
    ]);
    if (first !== "cold") return relay(await forwarded);
    return coldStartStream({ call, config, forwarded });
  });
  return app;
}
