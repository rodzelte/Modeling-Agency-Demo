import { defineConfig, devices } from "@playwright/test";

// Browser tests. Locally they use the installed Chrome (no browser download);
// CI installs Chromium. BASE_URL targets a deployed site instead of a local server.
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const useLocalServer = !process.env.BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...(process.env.CI ? {} : { channel: "chrome" }) } },
    { name: "mobile", use: { ...devices["Pixel 7"], ...(process.env.CI ? {} : { channel: "chrome" }) } },
  ],
  webServer: useLocalServer ? {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  } : undefined,
});
