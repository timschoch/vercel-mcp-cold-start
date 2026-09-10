# Lessons

- A slow `initialize` or `tools/list` on a cold upstream is not harmless. Some MCP clients mark the server down and stop when any request answers too slowly. Never assume a non-`tools/call` request tolerates the cold-start wait. Rule: every credentialed JSON-RPC request needs the fast stream when cold; only `tools/call` gets the news text block in the result.
