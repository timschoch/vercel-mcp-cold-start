# @timschoch/vercel-mcp-cold-start

A light Vercel Function that sits in front of an MCP server on a scale-to-zero
container.

It forwards every JSON-RPC message verbatim. It intercepts one case: a
`tools/call` that arrives while the container is cold. That call gets a
`notifications/message` on the stream telling the client to wait, then a
confirmation, then the real answer.

It knows no tool and imports nothing but [hono](https://hono.dev).

## Only useful when the upstream scales to zero

If your MCP server is always warm, this package adds a hop and gives you
nothing. It earns its keep only when a cold container makes the first
`tools/call` slow enough for a client to give up on it.

## Use it

```ts
import { createFront } from "@timschoch/vercel-mcp-cold-start";

export default createFront({
  upstream: process.env.UPSTREAM_URL!,
  coldStart: { name: "acme", seconds: 7 },
});
```

Or take the ready-made Function, which reads `UPSTREAM_URL` itself and throws
on the first request when it is unset:

```ts
export { default } from "@timschoch/vercel-mcp-cold-start/server";
```

### Options

`createFront(deps)`:

| Option      | Default        | What it is                                               |
| ----------- | -------------- | -------------------------------------------------------- |
| `upstream`  | —              | Base URL of the MCP server. Its `/mcp` receives the hop. |
| `fetch`     | global `fetch` | How the front reaches the upstream.                      |
| `coldStart` | see below      | Cold-start timings and the name in the notices.          |

`coldStart`:

| Option           | Default        | What it is                                                  |
| ---------------- | -------------- | ----------------------------------------------------------- |
| `name`           | `"the server"` | What the notices call the upstream. A person reads this.    |
| `seconds`        | `7`            | What the first notice promises. Measure yours; don't guess. |
| `probeTimeoutMs` | `500`          | How long the probe waits for any answer before "cold".      |

### What a cold call sees

1. `notifications/message` (level `info`): "acme is starting, about 7 seconds".
   A `notifications/progress` follows when the call sent a progress token.
2. `notifications/message`: "acme is up, your request is now being processed".
3. The upstream's real answer, with the same news prepended as the tool
   result's first text block, for clients that show no notifications.

A call with no credential is relayed as it is, so the upstream's `401` stays the
answer. Anything that is not a `tools/call` is forwarded and relayed untouched.

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
