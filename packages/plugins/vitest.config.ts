import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const core = (p: string) => fileURLToPath(new URL(`../core/src/${p}`, import.meta.url));
const react = (p: string) => fileURLToPath(new URL(`../react/src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Resolve @jul-editor/core to its source, not dist -- see packages/react's
    // vitest.config.ts for why.
    alias: [
      { find: "@jul-editor/core/serde", replacement: core("serde/index.ts") },
      { find: "@jul-editor/core", replacement: core("index.ts") },
      { find: "@jul-editor/react", replacement: react("index.ts") },
    ],
  },
  test: {
    name: "plugins",
    environment: "node",
  },
});
