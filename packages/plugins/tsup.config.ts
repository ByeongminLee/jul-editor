import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/chart/index.ts", "src/diagram/index.ts", "src/table/index.ts", "src/code/index.ts", "src/code-workspace/index.ts", "src/data/index.ts", "src/diff/index.ts", "src/comments/index.ts", "src/collaboration/index.ts", "src/links/index.ts", "src/callout/index.ts", "src/toggle/index.ts", "src/toc/index.ts", "src/columns/index.ts", "src/pages/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["react", "react-dom", "recharts", "mermaid"],
});
