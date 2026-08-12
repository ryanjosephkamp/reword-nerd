import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = 4173;
const origin = `http://${host}:${port}`;
const usePreview = process.env.PLAYWRIGHT_USE_PREVIEW === "1";
const basePath = process.env.PLAYWRIGHT_BASE_PATH ?? "/";
if (!/^\/[a-z0-9/_-]*$/iu.test(basePath)) throw new Error("PLAYWRIGHT_BASE_PATH must be an absolute URL path.");
const baseURL = new URL(basePath, `${origin}/`).href;
const previewBaseEnvironment = basePath === "/" ? "" : `VITE_BASE_PATH=${basePath} `;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "output/playwright/test-results",
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  reporter: "list",
  use: {
    baseURL,
    viewport: { width: 1586, height: 992 },
    colorScheme: "dark",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: usePreview
      ? `${previewBaseEnvironment}npm run preview -- --host ${host} --port ${port} --strictPort`
      : `npm run dev -- --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
