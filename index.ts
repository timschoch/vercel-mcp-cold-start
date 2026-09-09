/**
 * The front: the light Function the public MCP rewrite points at. It knows
 * no tool. Every JSON-RPC message goes to the upstream's MCP path as it came
 * and every answer comes back as it was, so a tool added, renamed or reshaped
 * in the upstream reaches a client with no change here. One case is
 * intercepted, `lib/cold-start.ts`: a `tools/call` that arrives while the
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

/** Where the MCP endpoint sits, on the front and on the upstream alike. */
export const MCP_PATH = "/mcp";

export interface FrontDeps {
  /** The upstream's base URL: `UPSTREAM_URL`, from the service binding. */
  readonly upstream: string;
  /**
   * The MCP path, on both hops: the route the front answers and the path the
   * hop addresses on the upstream. `/mcp` by default; `/api/mcp` where the
   * server is mounted under an API prefix. Leading slash, no trailing one.
   */
  readonly path?: string;
  /** Reaches the upstream. The global `fetch` by default. */
  readonly fetch?: typeof fetch;
  /** The cold-start timings; `COLD_START` for whatever is not given. */
  readonly coldStart?: Partial<ColdStart>;
}

export function createFront(deps: FrontDeps): Hono {
  const { upstream, path = MCP_PATH, fetch = globalThis.fetch } = deps;
  const config: ColdStart = { ...COLD_START, ...deps.coldStart };

  /**
   * Whether the upstream answers at all inside the probe timeout. A `GET` on
   * the MCP path with no key is the cheapest answer the container gives, a
   * `401` from its middleware with no database or store behind it; `/health`
   * with a stale cache costs seconds. A platform `5xx` while the container
   * starts is not an answer. The timer races the fetch rather than trusting
   * the fetch to honour its signal.
   */
  const up = (): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), config.probeTimeoutMs);
      fetch(new URL(path, upstream), {
        signal: AbortSignal.timeout(config.probeTimeoutMs),
      })
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
  app.all(path, async (c) => {
    const request = c.req.raw;
    const body = request.method === "POST" ? await request.text() : null;
    // On its way before anything else: the platform holds a request to a
    // container that is starting, so the forwarded call is also the wait.
    const forwarded = fetch(toUpstream(request, upstream, path, body));
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
