import { defineConfig } from "@playwright/test";

// Explicit opt-in against the user's local Docker review deployment, never part of mock tests.
export default defineConfig({
  testDir: "./tests/docker", workers: 1, timeout: 90_000,
  use: { baseURL: "http://127.0.0.1:5180", viewport: { width: 1920, height: 1080 },
    trace: "retain-on-failure", screenshot: "only-on-failure" },
});
