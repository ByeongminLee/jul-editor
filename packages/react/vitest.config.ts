import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const core = (p: string) => fileURLToPath(new URL(`../core/src/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve @jul-editor/core to its source, not dist -- otherwise these tests
    // run against whatever @jul-editor/core happened to be built last, silently
    // passing against a stale build after a core-only source change.
    alias: [
      { find: "@jul-editor/core/serde", replacement: core("serde/index.ts") },
      { find: "@jul-editor/core", replacement: core("index.ts") },
    ],
  },
  test: {
    name: "react",
    environment: "jsdom",
  },
});
