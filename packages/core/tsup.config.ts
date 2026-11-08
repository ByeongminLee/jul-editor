import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/serde/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
