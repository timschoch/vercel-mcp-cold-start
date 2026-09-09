// Entry point: the Function Vercel runs. `UPSTREAM_URL` is the service binding
// to the upstream container (`vercel.json`), injected at runtime only, so a
// deployment without it fails on the first request with the variable named.
// `MCP_PATH` moves the endpoint off `/mcp` where the server sits elsewhere,
// `/api/mcp` for one under an API prefix.
import { createFront, MCP_PATH } from "./index";

const upstream = process.env["UPSTREAM_URL"];
if (upstream === undefined || upstream === "") {
  throw new Error("front cannot start: UPSTREAM_URL is unset");
}

const path = process.env["MCP_PATH"] || MCP_PATH;

export default createFront({ upstream, path });
