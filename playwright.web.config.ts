import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5190" },
  webServer: {
    command: "pnpm --filter web dev",
    url: "http://127.0.0.1:5190",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
