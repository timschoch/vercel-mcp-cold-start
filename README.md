# @timschoch/vercel-mcp-cold-start

A light Vercel Function that sits in front of an MCP server on a scale-to-zero
container.

It forwards every JSON-RPC message verbatim. It intercepts one case: a
`tools/call` that arrives while the container is cold. That call gets a
`notifications/message` on the stream telling the client to wait, then a
confirmation, then the real answer.

It knows no tool and has no runtime dependency.

## Only useful when the upstream scales to zero

If your MCP server is always warm, this package adds a hop and gives you
nothing. It earns its keep only when a cold container makes the first
`tools/call` slow enough for a client to give up on it.

## Use it

```ts
// app/mcp/route.ts
import { createFront } from "@timschoch/vercel-mcp-cold-start";

const front = createFront({
  upstream: "https://acme.internal/api/mcp",
  coldStart: { name: "acme", seconds: 7 },
});

export { front as GET, front as POST, front as DELETE };
```

`createFront` returns a web handler, `(request: Request) => Promise<Response>`.
A Next.js route file and a Vercel Function both take it under the method
names; a bare `api/mcp.ts` may export it as the default.

The front answers whatever request reaches it and checks no path. The public
path is the mount's: the rewrite in `vercel.json`, or the folder of the route
file. Mount it at `/mcp` and point `upstream` at `/api/mcp`, and the two never
collide.

Or take the ready-made Function, which reads `UPSTREAM_URL` itself and throws
on the first request when it is unset:

```ts
// app/mcp/route.ts
export { GET, POST, DELETE } from "@timschoch/vercel-mcp-cold-start/server";
```

It joins `UPSTREAM_URL` with `UPSTREAM_MCP_PATH`, `/mcp` unless set. A service
binding injects the host; `UPSTREAM_MCP_PATH=/api/mcp` names the endpoint on
it.

### Options

`createFront(deps)`:

| Option      | Default        | What it is                                            |
| ----------- | -------------- | ----------------------------------------------------- |
| `upstream`  | —              | Full URL of the upstream MCP endpoint. Used as given. |
| `fetch`     | global `fetch` | How the front reaches the upstream.                   |
| `coldStart` | see below      | Cold-start timings and the name in the notices.       |

`coldStart`:

| Option           | Default        | What it is                                                  |
| ---------------- | -------------- | ----------------------------------------------------------- |
| `name`           | `"the server"` | What the notices call the upstream. A person reads this.    |
| `seconds`        | `30`           | What the first notice promises. A ceiling; set yours lower. |
| `probeTimeoutMs` | `500`          | How long the probe waits for any answer before "cold".      |

`COLD_START` holds these defaults. Import it to read a value you do not
override:

```ts
import { COLD_START } from "@timschoch/vercel-mcp-cold-start";

console.log(COLD_START.probeTimeoutMs); // 500
```

### What a cold call sees

1. `notifications/message` (level `info`): "acme is starting, about 7 seconds".
   A `notifications/progress` follows when the call sent a progress token.
2. `notifications/message`: "acme is up, your request is now being processed".
3. The upstream's real answer, with the same news prepended as the tool
   result's first text block, for clients that show no notifications.

A cold `tools/call` the upstream refuses ends the stream with a JSON-RPC error
that carries the status and the body. Anything that is not a `tools/call` is
forwarded and relayed untouched, `initialize` and its auth discovery included.

## Develop

```sh
npm install
npm run build       # tsup, to dist/
npm run typecheck
npm test
```

## Release

Merge to `main`. [release-please](https://github.com/googleapis/release-please)
reads the conventional commits and opens a Release PR. Merging that PR tags the
release, and [.github/workflows/release.yml](.github/workflows/release.yml)
publishes the package to npm.

## Licence

MIT
