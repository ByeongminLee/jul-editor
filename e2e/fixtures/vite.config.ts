import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// resolves the workspace packages to their src/ so e2e/dev never needs a
// prior `pnpm -r build` to see changes.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    alias: [
      { find: "@jul-editor/core/serde", replacement: fileURLToPath(new URL("../../packages/core/src/serde/index.ts", import.meta.url)) },
      { find: "@jul-editor/plugins/diff", replacement: fileURLToPath(new URL("../../packages/plugins/src/diff/index.ts", import.meta.url)) },
      { find: "@jul-editor/core", replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) },
      { find: "@jul-editor/react", replacement: fileURLToPath(new URL("../../packages/react/src/index.ts", import.meta.url)) },
      { find: "@jul-editor/plugins", replacement: fileURLToPath(new URL("../../packages/plugins/src/index.ts", import.meta.url)) },
    ],
  },
});
