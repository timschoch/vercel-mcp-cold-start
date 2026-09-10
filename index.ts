/**
 * The front: the light Function the mount hands requests to. It knows no
 * tool and checks no path: whatever reaches it goes to the upstream endpoint
 * as it came, and every answer comes back as it was, so a tool added, renamed
 * or reshaped in the upstream reaches a client with no change here. One
 * thing is added, `lib/notices.ts`: a request the upstream has not answered
 * within `firstNoticeMs` is told on its own stream that it is being
 * processed, again every `repeatNoticeMs`, until the answer arrives and is
 * piped through.
 */
import { NOTICES, type Notices, noticeStream, rpcRequest } from "./lib/notices";
import { relay, toUpstream } from "./lib/forward";

export type { Notices } from "./lib/notices";
// The defaults themselves, so a caller can read what it does not override.
export { NOTICES } from "./lib/notices";

export interface FrontDeps {
  /**
   * The upstream MCP endpoint, a full URL: `https://host/api/mcp`. Used as
   * given; the front joins nothing onto it.
   */
  readonly upstream: string;
  /** Reaches the upstream. The global `fetch` by default. */
  readonly fetch?: typeof fetch;
  /** The notice timings and name; `NOTICES` for whatever is not given. */
  readonly notices?: Partial<Notices>;
}

/**
 * The front as a web handler: what a Vercel Function or a Next.js route
 * file exports under `GET`, `POST` and `DELETE`, or as its default.
 */
export type Front = (request: Request) => Promise<Response>;

export function createFront(deps: FrontDeps): Front {
  const { fetch = globalThis.fetch } = deps;
  const target = new URL(deps.upstream);
  const config: Notices = { ...NOTICES, ...deps.notices };

  // Every path: the mount (a rewrite, a route file) already chose what
  // arrives here, and a second vote could only agree or answer 404.
  return async (request) => {
    const body = request.method === "POST" ? await request.text() : null;
    // On its way before anything else: the platform holds a request to a
    // container that is starting, so the forwarded call is also the wait.
    // The caller's signal travels with it, so a client that hangs up takes
    // the hop down with it.
    const forwarded = fetch(toUpstream(request, target, body), {
      signal: request.signal,
    });
    const rpc = body === null ? null : rpcRequest(body);
    if (rpc === null) return relay(await forwarded);
    const first = await Promise.race([
      forwarded.then(
        () => "answered" as const,
        () => "answered" as const
      ),
      new Promise<"slow">((resolve) =>
        setTimeout(() => resolve("slow"), config.firstNoticeMs)
      ),
    ]);
    if (first === "answered") return relay(await forwarded);
    return noticeStream({ rpc, config, forwarded });
  };
}
