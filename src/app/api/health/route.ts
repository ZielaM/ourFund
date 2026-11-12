import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { checkHealth } from "@/server/services/health";

export async function GET() {
  // Always evaluate at request time; a health check must never be prerendered.
  await connection();

  const report = await checkHealth(getDb());

  return Response.json(report, { status: report.status === "ok" ? 200 : 503 });
}
