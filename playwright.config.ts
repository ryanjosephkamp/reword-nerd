import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = 4173;
const origin = `http://${host}:${port}`;
const usePreview = process.env.PLAYWRIGHT_USE_PREVIEW === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "output/playwright/test-results",
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  reporter: "list",
  use: {
    baseURL: origin,
    viewport: { width: 1586, height: 992 },
    colorScheme: "dark",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: usePreview
      ? `npm run preview -- --host ${host} --port ${port} --strictPort`
      : `npm run dev -- --host ${host} --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
