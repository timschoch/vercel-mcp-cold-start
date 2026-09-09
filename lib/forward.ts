/**
 * One hop, nothing changed: the caller's request becomes the upstream's, and
 * the upstream's answer becomes the caller's. Only what a hop must own is
 * touched — the target, the headers that describe one connection rather than
 * one message, and the two that would lie once `fetch` has decompressed a
 * body. `Authorization`, `x-auth-token` and `Mcp-Session-Id` travel as they
 * are, in both directions.
 */

/** RFC 9110 §7.6.1 plus the three that name a specific connection or body. */
const NOT_FORWARDED = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  // `fetch` inflates a compressed body before this hop sees it, so the
  // upstream is asked for an uncompressed one and no `content-encoding` is
  // relayed that the bytes no longer match.
  "accept-encoding",
  "content-encoding",
];

function without(headers: Headers): Headers {
  const copy = new Headers(headers);
  for (const name of NOT_FORWARDED) copy.delete(name);
  return copy;
}

/** The caller's request, re-addressed to the upstream's MCP path. */
export function toUpstream(
  request: Request,
  upstream: string,
  path: string,
  body: string | null
): Request {
  const target = new URL(path, upstream);
  target.search = new URL(request.url).search;
  return new Request(target, {
    method: request.method,
    headers: without(request.headers),
    body,
  });
}

/** The upstream's answer, as the caller's: status, headers and body untouched. */
export function relay(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    headers: without(response.headers),
  });
}
