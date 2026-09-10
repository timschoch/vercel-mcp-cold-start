# @timschoch/vercel-mcp-cold-start

A light Vercel Function that sits in front of an MCP server on a scale-to-zero
container.

It forwards every JSON-RPC message verbatim. It adds one thing: a request the
upstream has not answered within half a second gets a `notifications/message`
on its own stream, saying the request is being processed. The notice repeats
every two seconds until the answer arrives, and the answer is relayed as it
came.

It knows no tool and imports nothing but [hono](https://hono.dev).

## Only useful when the upstream scales to zero

If your MCP server is always warm, this package adds a hop and gives you
nothing. It earns its keep only when a cold container makes a request slow
enough for a client to give up on it. Some clients mark the server down after
a slow `initialize` or `tools/list`, not only a slow `tools/call`.

A notice keeps the client listening. It does not buy time: a client with a hard
request timeout still fails when the upstream takes longer than that. Make the
upstream fast first.

## Use it

```ts
import { createFront } from "@timschoch/vercel-mcp-cold-start";

export default createFront({
  upstream: process.env.UPSTREAM_URL!,
  notices: { name: "acme" },
});
```

Or take the ready-made Function, which reads `UPSTREAM_URL` itself and throws
on the first request when it is unset:

```ts
export { default } from "@timschoch/vercel-mcp-cold-start/server";
```

### Options

`createFront(deps)`:

| Option     | Default        | What it is                                               |
| ---------- | -------------- | -------------------------------------------------------- |
| `upstream` | —              | Base URL of the MCP server. Its `/mcp` receives the hop. |
| `fetch`    | global `fetch` | How the front reaches the upstream.                      |
| `notices`  | see below      | Notice timings and the name in the notices.              |

`notices`:

| Option           | Default        | What it is                                               |
| ---------------- | -------------- | -------------------------------------------------------- |
| `name`           | `"the server"` | What the notices call the upstream. A person reads this. |
| `firstNoticeMs`  | `500`          | How long a request may go unanswered before the notice.  |
| `repeatNoticeMs` | `2000`         | How long between one notice and the next.                |

`NOTICES` holds these defaults. Import it to read a value you do not override:

```ts
import { NOTICES } from "@timschoch/vercel-mcp-cold-start";

console.log(NOTICES.firstNoticeMs); // 500
```

### What a slow request sees

1. `notifications/message` (level `info`): "acme is processing your request".
   A `notifications/progress` follows when the request sent a progress token,
   with `progress` counting up from 0.
2. The same notice again every `repeatNoticeMs`, until the upstream answers.
3. The upstream's answer, as it came. An SSE answer is piped frame by frame.
   A JSON answer becomes the stream's one final frame.

A request that answers within `firstNoticeMs` is relayed untouched, status and
headers included. A JSON-RPC notification, a batch, a GET or a DELETE is always
relayed untouched: nothing waits on those. A refusal or a lost connection on
the stream becomes a JSON-RPC error with the request's id, because the status
line is already sent.

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
