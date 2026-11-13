import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/server/db/client";
import { isSecureRequest, SESSION_COOKIE, sessionCookieOptions } from "./session-cookie";
import { createSession, deleteSession, findSessionUser, type SessionUser } from "./sessions";

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/**
 * The signed-in user, or null. Looked up once per request, and only for a real request:
 * whether a session is still valid depends on the current time and on the database, so it
 * must never be computed ahead of time by prerendering or prefetching.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  await connection();
  const token = await getSessionToken();
  return token ? findSessionUser(getDb(), token) : null;
});

/** For pages and actions that need a signed-in user; sends everyone else to the sign-in page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/** Administrator-only pages do not reveal that they exist to regular users. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    notFound();
  }
  return user;
}

/** Signs the user in on this browser. Call only from a Server Action or Route Handler. */
export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(getDb(), userId);
  const secure = isSecureRequest(await headers());

  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt, secure));
}

/** Signs the user out on this browser. Call only from a Server Action or Route Handler. */
export async function endSession(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    await deleteSession(getDb(), token);
  }
  (await cookies()).delete(SESSION_COOKIE);
}
