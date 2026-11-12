import type { PrismaClient } from "@/generated/prisma/client";

type ComponentStatus = "ok" | "error";

export type HealthReport = {
  status: ComponentStatus;
  database: ComponentStatus;
};

type HealthDb = Pick<PrismaClient, "$queryRaw">;

export async function checkHealth(db: HealthDb): Promise<HealthReport> {
  const database = await checkDatabase(db);

  return { status: database, database };
}

async function checkDatabase(db: HealthDb): Promise<ComponentStatus> {
  try {
    await db.$queryRaw`SELECT 1`;
    return "ok";
  } catch (error) {
    console.error("Health check: database is unreachable", error);
    return "error";
  }
}
