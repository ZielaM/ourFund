import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// The Prisma CLI does not load .env files on its own.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Not required for `prisma generate`, so a missing value must not throw here.
    url: process.env.DATABASE_URL ?? "",
  },
});
