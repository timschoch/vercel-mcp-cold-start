// Entry point: the Function Vercel runs. `UPSTREAM_URL` is the service binding
// to the upstream container (`vercel.json`), injected at runtime only, so a
// deployment without it fails on the first request with the variable named.
// `UPSTREAM_MCP_PATH` names the endpoint on that host, `/mcp` unless set;
// `/api/mcp` for a server under an API prefix.
import { createFront } from "./index";

const upstream = process.env["UPSTREAM_URL"];
if (upstream === undefined || upstream === "") {
  throw new Error("front cannot start: UPSTREAM_URL is unset");
}

const endpoint = new URL(process.env["UPSTREAM_MCP_PATH"] || "/mcp", upstream);

export default createFront({ upstream: endpoint.href });
