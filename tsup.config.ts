import { defineConfig } from "tsup";

// Two entries, the two the package exports: the factory and the ready
// Function. Nothing is bundled in; the package has no runtime dependency.
export default defineConfig({
  entry: ["index.ts", "server.ts"],
  format: ["esm"],
  target: "node22",
  dts: true,
  clean: true,
  sourcemap: true,
});
