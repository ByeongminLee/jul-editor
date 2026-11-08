import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import remarkGfm from "remark-gfm";
import { defineConfig } from "vite";

// Source aliases keep this site in sync with the workspace during development.
export default defineConfig({
  plugins: [{ ...mdx({ remarkPlugins: [remarkGfm] }), enforce: "pre" }, react({ include: /\.(jsx|js|mdx|tsx|ts)$/ })],
  server: { port: 5190 },
  resolve: {
    alias: [
      { find: "@jul-editor/core/serde", replacement: fileURLToPath(new URL("../../packages/core/src/serde/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/diff$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/diff/index.ts", import.meta.url)) },
      { find: "@jul-editor/core", replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) },
      { find: "@jul-editor/react", replacement: fileURLToPath(new URL("../../packages/react/src/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/chart$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/chart/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/diagram$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/diagram/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/table$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/table/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/code$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/code/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/code-workspace$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/code-workspace/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/data$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/data/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/pages$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/pages/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/callout$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/callout/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/toggle$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/toggle/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/toc$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/toc/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/columns$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/columns/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/links$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/links/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/comments$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/comments/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins\/collaboration$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/collaboration/index.ts", import.meta.url)) },
      { find: /^@jul-editor\/plugins$/, replacement: fileURLToPath(new URL("../../packages/plugins/src/index.ts", import.meta.url)) },
    ],
  },
});
