import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { hashSessionToken } from "./session-token";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  deleteUserSessions,
  findSessionUser,
  SESSION_LIFETIME_MS,
} from "./sessions";

const db = getDb();
const now = new Date("2026-11-12T12:00:00Z");

async function createUser(username = "ania", data: { disabledAt?: Date } = {}) {
  return db.user.create({ data: { username, passwordHash: "not-used-here", ...data } });
}

describe("sessions", () => {
  beforeEach(async () => {
    await resetDatabase(db);
  });

  afterAll(async () => {
    await disconnectDb();
  });

  it("creates a session valid for 30 days and stores only the token hash", async () => {
    const user = await createUser();

    const { token, expiresAt } = await createSession(db, user.id, now);

    expect(expiresAt).toEqual(new Date(now.getTime() + SESSION_LIFETIME_MS));
    const stored = await db.session.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(hashSessionToken(token));
    expect(stored[0].id).not.toBe(token);
  });

  it("finds the user for a valid token without exposing the password hash", async () => {
    const user = await createUser();
    const { token } = await createSession(db, user.id, now);

    await expect(findSessionUser(db, token, now)).resolves.toEqual({
      id: user.id,
      username: "ania",
      role: "USER",
    });
  });

  it("returns null for an unknown token", async () => {
    await expect(findSessionUser(db, "unknown-token", now)).resolves.toBeNull();
  });

  it("rejects and removes an expired session", async () => {
    const user = await createUser();
    const { token, expiresAt } = await createSession(db, user.id, now);

    await expect(findSessionUser(db, token, expiresAt)).resolves.toBeNull();
    await expect(db.session.count()).resolves.toBe(0);
  });

  it("accepts a session until the last millisecond before it expires", async () => {
    const user = await createUser();
    const { token, expiresAt } = await createSession(db, user.id, now);

    await expect(
      findSessionUser(db, token, new Date(expiresAt.getTime() - 1)),
    ).resolves.not.toBeNull();
  });

  it("rejects the session of a blocked user", async () => {
    const user = await createUser("zablokowany", { disabledAt: now });
    const { token } = await createSession(db, user.id, now);

    await expect(findSessionUser(db, token, now)).resolves.toBeNull();
  });

  it("deletes a single session on sign-out", async () => {
    const user = await createUser();
    const first = await createSession(db, user.id, now);
    const second = await createSession(db, user.id, now);

    await deleteSession(db, first.token);

    await expect(findSessionUser(db, first.token, now)).resolves.toBeNull();
    await expect(findSessionUser(db, second.token, now)).resolves.not.toBeNull();
  });

  it("does nothing when signing out with an unknown token", async () => {
    await expect(deleteSession(db, "unknown-token")).resolves.toBeUndefined();
  });

  it("deletes all sessions of one user only", async () => {
    const ania = await createUser("ania");
    const jan = await createUser("jan");
    await createSession(db, ania.id, now);
    await createSession(db, ania.id, now);
    const janSession = await createSession(db, jan.id, now);

    await deleteUserSessions(db, ania.id);

    await expect(db.session.count({ where: { userId: ania.id } })).resolves.toBe(0);
    await expect(findSessionUser(db, janSession.token, now)).resolves.not.toBeNull();
  });

  it("can keep the session that is being used", async () => {
    const user = await createUser();
    const current = await createSession(db, user.id, now);
    const other = await createSession(db, user.id, now);

    await deleteUserSessions(db, user.id, { exceptToken: current.token });

    await expect(findSessionUser(db, current.token, now)).resolves.not.toBeNull();
    await expect(findSessionUser(db, other.token, now)).resolves.toBeNull();
  });

  it("removes sessions together with the user", async () => {
    const user = await createUser();
    await createSession(db, user.id, now);

    await db.user.delete({ where: { id: user.id } });

    await expect(db.session.count()).resolves.toBe(0);
  });

  it("cleans up expired sessions and reports how many", async () => {
    const user = await createUser();
    await createSession(db, user.id, new Date(now.getTime() - SESSION_LIFETIME_MS - 1000));
    await createSession(db, user.id, new Date(now.getTime() - SESSION_LIFETIME_MS));
    const valid = await createSession(db, user.id, now);

    await expect(deleteExpiredSessions(db, now)).resolves.toBe(2);
    await expect(findSessionUser(db, valid.token, now)).resolves.not.toBeNull();
  });
});
