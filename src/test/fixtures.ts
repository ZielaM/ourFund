import type { PrismaClient } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/sessions";

/** Inserts a user directly, skipping the (deliberately slow) password hashing. */
export async function createTestUser(
  db: PrismaClient,
  username: string,
  role: "ADMIN" | "USER" = "USER",
): Promise<SessionUser> {
  const user = await db.user.create({
    data: { username, role, passwordHash: "not-a-real-hash" },
  });

  return { id: user.id, username: user.username, role: user.role };
}

export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
