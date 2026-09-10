# Lessons

- Before adding a setting, run the deletion test on what it configures. 0.4.0
  added `path` to `createFront` where the mount already decided the route; the
  setting could only agree with it or answer 404.
- A slow `initialize` or `tools/list` on a cold upstream is not harmless. Some
  MCP clients mark the server down and stop when any request answers too
  slowly. Never assume a request other than `tools/call` tolerates the
  cold-start wait. Rule: every JSON-RPC request gets the notice stream when
  slow; the answer is piped as it came.
