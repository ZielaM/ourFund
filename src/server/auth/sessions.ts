import type { UserRole } from "@/generated/prisma/client";
import type { Db } from "@/server/db/types";
import { generateSessionToken, hashSessionToken } from "./session-token";

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** The signed-in user as the rest of the app sees it. Never includes the password hash. */
export type SessionUser = {
  id: string;
  username: string;
  role: UserRole;
};

export async function createSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);

  await db.session.create({
    data: { id: hashSessionToken(token), userId, expiresAt },
  });

  return { token, expiresAt };
}

export async function findSessionUser(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { id: hashSessionToken(token) },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= now.getTime()) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (session.user.disabledAt) {
    return null;
  }

  return { id: session.user.id, username: session.user.username, role: session.user.role };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.session.deleteMany({ where: { id: hashSessionToken(token) } });
}

/** Signs the user out everywhere, optionally keeping the session they are using right now. */
export async function deleteUserSessions(
  db: Db,
  userId: string,
  options: { exceptToken?: string } = {},
): Promise<void> {
  await db.session.deleteMany({
    where: {
      userId,
      ...(options.exceptToken ? { id: { not: hashSessionToken(options.exceptToken) } } : {}),
    },
  });
}

export async function deleteExpiredSessions(db: Db, now: Date = new Date()): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}
