import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://localhost:${port}`;
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgresql://ourfund:ourfund@localhost:5432/ourfund_e2e?schema=public";
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests run against the production build and a dedicated PostgreSQL database.
  webServer: {
    command: "pnpm build && pnpm e2e:server",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 300_000,
    env: {
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      HOSTNAME: "localhost",
    },
  },
});
