import { defineConfig } from "tsup";

// Two entries, the two the package exports: the factory and the ready
// Function. `hono` stays external, so a consumer resolves its own copy.
export default defineConfig({
  entry: ["index.ts", "server.ts"],
  format: ["esm"],
  target: "node22",
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["hono"],
});
