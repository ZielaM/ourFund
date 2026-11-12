import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

/** Brings the test database schema up to date before integration tests run. */
export default function setup(project: TestProject) {
  const databaseUrl = project.config.env.DATABASE_URL;

  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  } catch (error) {
    const output = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    throw new Error(
      `Could not prepare the test database. Is PostgreSQL running? Try \`pnpm db:up\`.\n${output}`,
      { cause: error },
    );
  }
}
