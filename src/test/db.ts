import type { PrismaClient } from "@/generated/prisma/client";

/** Empties every table so that each integration test starts from a known state. */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  await db.$executeRaw`TRUNCATE TABLE "users", "sessions", "login_attempts", "app_settings" RESTART IDENTITY CASCADE`;
}
