import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://ourfund:ourfund@localhost:5432/ourfund_test?schema=public";

const minimum = { statements: 90, branches: 90, functions: 90, lines: 90 };

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/generated/**",
        "src/test/**",
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        // Route files hold no logic and are covered by Playwright.
        "src/app/**",
        // Vendored shadcn/ui components.
        "src/components/ui/**",
        "src/i18n/request.ts",
      ],
      // Financial and server logic must stay well tested; the rest has no hard gate.
      thresholds: {
        "src/domain/**": minimum,
        "src/server/**": minimum,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/component-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          // Runs against a real PostgreSQL database (see docker-compose.dev.yml).
          name: "integration",
          environment: "node",
          include: ["src/**/*.int.test.ts"],
          globalSetup: ["./src/test/integration-global-setup.ts"],
          env: { DATABASE_URL: testDatabaseUrl },
          fileParallelism: false,
        },
      },
    ],
  },
});
