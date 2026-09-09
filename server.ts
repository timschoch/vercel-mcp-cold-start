// Entry point: the Function Vercel runs. `UPSTREAM_URL` is the service binding
// to the upstream container (`vercel.json`), injected at runtime only, so a
// deployment without it fails on the first request with the variable named.
import { createFront } from "./index";

const upstream = process.env["UPSTREAM_URL"];
if (upstream === undefined || upstream === "") {
  throw new Error("front cannot start: UPSTREAM_URL is unset");
}

export default createFront({ upstream });
