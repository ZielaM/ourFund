import type { PrismaClient } from "@/generated/prisma/client";

/** Empties every table so that each integration test starts from a known state. */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  await db.$executeRaw`TRUNCATE TABLE "inflation_readings", "reference_rates", "bond_rates", "bond_series", "prices", "fx_rates", "transactions", "instruments", "accounts", "portfolios", "users", "sessions", "login_attempts", "app_settings" RESTART IDENTITY CASCADE`;
}
