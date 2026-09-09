# @timschoch/vercel-mcp-cold-start

A light Vercel Function that sits in front of an MCP server on a scale-to-zero
container.

It forwards every JSON-RPC message verbatim. It intercepts one case: a
`tools/call` that arrives while the container is cold. That call gets a
`notifications/message` on the stream telling the client to wait, then a
confirmation, then the real answer.

It knows no tool and imports nothing but [hono](https://hono.dev).

## Status

Extraction in progress. The code moves here from `timschoch/meco`
(`packages/front`).

## Only useful when the upstream scales to zero

If your MCP server is always warm, this package adds a hop and gives you
nothing. It earns its keep only when a cold container makes the first
`tools/call` slow enough for a client to give up on it.

## Licence

MIT
