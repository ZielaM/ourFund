import { defineConfig, devices } from "@playwright/test";
import { adminStorageState, e2eDatabaseUrl } from "./e2e/helpers/env";

const port = 3100;
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    locale: "pl-PL",
    timezoneId: "Europe/Warsaw",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Resets the database and walks through first-run setup; leaves the administrator signed in.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: adminStorageState },
      dependencies: ["setup"],
    },
  ],
  // Tests run against the production build and a dedicated PostgreSQL database.
  webServer: {
    command: "pnpm build && pnpm e2e:server",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 300_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      // Made-up prices and exchange rates: tests never reach the internet.
      MARKET_DATA: "fixture",
      PORT: String(port),
      HOSTNAME: "localhost",
    },
  },
});
