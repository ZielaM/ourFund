import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/env";

const globalForDb = globalThis as typeof globalThis & { __ourfundDb?: PrismaClient };

/**
 * Returns the shared Prisma client. Created on first use (not at import time) so that
 * building the app does not require a database, and kept on `globalThis` so that
 * hot reloads in development do not open a new connection pool each time.
 */
export function getDb(): PrismaClient {
  globalForDb.__ourfundDb ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }),
  });

  return globalForDb.__ourfundDb;
}

export async function disconnectDb(): Promise<void> {
  await globalForDb.__ourfundDb?.$disconnect();
  globalForDb.__ourfundDb = undefined;
}
