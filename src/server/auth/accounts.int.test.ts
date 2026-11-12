import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LOCKOUT_MAX_FAILURES, LOCKOUT_WINDOW_MS } from "@/domain/auth/lockout";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import {
  authenticate,
  changeOwnPassword,
  createFirstAdmin,
  createUserAsAdmin,
  findUser,
  ForbiddenError,
  isSetupRequired,
  listUsers,
  registerUser,
  resetUserPassword,
  setUserDisabled,
} from "./accounts";
import { verifyPassword } from "./password";
import { createSession, findSessionUser, type SessionUser } from "./sessions";

const db = getDb();
const now = new Date("2026-11-12T12:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);
const password = "poprawne-haslo-123";
const unknownId = "00000000-0000-4000-8000-000000000000";

async function admin(username = "admin"): Promise<SessionUser> {
  const result = await createUserAsAdmin(
    db,
    { id: unknownId, username: "bootstrap", role: "ADMIN" },
    { username, password, role: "ADMIN" },
  );
  if (!result.ok) throw new Error("could not create the test administrator");
  return result.user;
}

async function regularUser(username = "ania"): Promise<SessionUser> {
  const result = await registerUser(db, { username, password });
  if (!result.ok) throw new Error("could not create the test user");
  return result.user;
}

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await disconnectDb();
});

describe("first-run setup", () => {
  it("is required while there are no accounts", async () => {
    await expect(isSetupRequired(db)).resolves.toBe(true);
  });

  it("creates an administrator and is then no longer required", async () => {
    const result = await createFirstAdmin(db, { username: "szef", password });

    expect(result).toEqual({
      ok: true,
      user: { id: expect.any(String), username: "szef", role: "ADMIN" },
    });
    await expect(isSetupRequired(db)).resolves.toBe(false);
  });

  it("stores a password hash, never the password", async () => {
    await createFirstAdmin(db, { username: "szef", password });

    const stored = await db.user.findUniqueOrThrow({ where: { username: "szef" } });
    expect(stored.passwordHash).not.toContain(password);
    await expect(verifyPassword(stored.passwordHash, password)).resolves.toBe(true);
  });

  it("refuses to run once an account exists", async () => {
    await regularUser();

    await expect(createFirstAdmin(db, { username: "intruz", password })).resolves.toEqual({
      ok: false,
      reason: "setupAlreadyDone",
    });
    await expect(db.user.count()).resolves.toBe(1);
  });

  it("lets only one of two simultaneous requests create the administrator", async () => {
    const results = await Promise.all([
      createFirstAdmin(db, { username: "pierwszy", password }),
      createFirstAdmin(db, { username: "drugi", password }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    await expect(db.user.count()).resolves.toBe(1);
  });
});

describe("registration", () => {
  it("creates a regular user", async () => {
    await expect(registerUser(db, { username: "ania", password })).resolves.toEqual({
      ok: true,
      user: { id: expect.any(String), username: "ania", role: "USER" },
    });
  });

  it("reports a user name that is already taken", async () => {
    await regularUser("ania");

    await expect(registerUser(db, { username: "ania", password })).resolves.toEqual({
      ok: false,
      reason: "usernameTaken",
    });
  });
});

describe("authenticate", () => {
  it("accepts the right password", async () => {
    const user = await regularUser();

    await expect(authenticate(db, { username: "ania", password }, now)).resolves.toEqual({
      ok: true,
      user,
    });
  });

  it("rejects a wrong password", async () => {
    await regularUser();

    await expect(
      authenticate(db, { username: "ania", password: "zle-haslo-123" }, now),
    ).resolves.toEqual({ ok: false, reason: "invalidCredentials" });
  });

  it("gives an unknown user the same answer as a wrong password", async () => {
    await expect(authenticate(db, { username: "nikt", password }, now)).resolves.toEqual({
      ok: false,
      reason: "invalidCredentials",
    });
  });

  it("rejects a blocked account even with the right password", async () => {
    const actor = await admin();
    const user = await regularUser();
    await setUserDisabled(db, actor, user.id, true, now);

    await expect(authenticate(db, { username: "ania", password }, now)).resolves.toEqual({
      ok: false,
      reason: "invalidCredentials",
    });
  });

  it("records every attempt", async () => {
    await regularUser();

    await authenticate(db, { username: "ania", password: "zle-haslo-123" }, now);
    await authenticate(db, { username: "ania", password }, later(1000));

    const attempts = await db.loginAttempt.findMany({ orderBy: { createdAt: "asc" } });
    expect(attempts.map((attempt) => attempt.succeeded)).toEqual([false, true]);
  });

  it("locks the account after too many failures, even for the right password", async () => {
    await regularUser();
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) {
      await authenticate(db, { username: "ania", password: "zle-haslo-123" }, later(i * 1000));
    }

    await expect(authenticate(db, { username: "ania", password }, later(60_000))).resolves.toEqual({
      ok: false,
      reason: "locked",
      retryAt: later(LOCKOUT_WINDOW_MS),
    });
  });

  it("does not record attempts made while locked, so the lock always ends", async () => {
    await regularUser();
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) {
      await authenticate(db, { username: "ania", password: "zle-haslo-123" }, later(i * 1000));
    }

    await authenticate(db, { username: "ania", password }, later(60_000));

    await expect(db.loginAttempt.count()).resolves.toBe(LOCKOUT_MAX_FAILURES);
  });

  it("allows signing in again once the lock has passed", async () => {
    const user = await regularUser();
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) {
      await authenticate(db, { username: "ania", password: "zle-haslo-123" }, later(i * 1000));
    }

    await expect(
      authenticate(db, { username: "ania", password }, later(LOCKOUT_WINDOW_MS + 5000)),
    ).resolves.toEqual({ ok: true, user });
  });

  it("locks each user name separately", async () => {
    const jan = await regularUser("jan");
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) {
      await authenticate(db, { username: "ania", password: "zle-haslo-123" }, later(i * 1000));
    }

    await expect(authenticate(db, { username: "jan", password }, later(60_000))).resolves.toEqual({
      ok: true,
      user: jan,
    });
  });

  it("clears old sign-in history after a successful sign-in", async () => {
    await regularUser();
    const twoDaysAgo = later(-2 * 24 * 60 * 60 * 1000);
    await authenticate(db, { username: "ania", password: "zle-haslo-123" }, twoDaysAgo);

    await authenticate(db, { username: "ania", password }, now);

    const attempts = await db.loginAttempt.findMany();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].succeeded).toBe(true);
  });
});

describe("changeOwnPassword", () => {
  it("changes the password when the current one is right", async () => {
    const user = await regularUser();

    await expect(
      changeOwnPassword(db, user.id, { currentPassword: password, password: "nowe-haslo-456" }),
    ).resolves.toEqual({ ok: true });

    await expect(
      authenticate(db, { username: "ania", password: "nowe-haslo-456" }, now),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      authenticate(db, { username: "ania", password }, later(1000)),
    ).resolves.toMatchObject({ ok: false });
  });

  it("refuses when the current password is wrong", async () => {
    const user = await regularUser();

    await expect(
      changeOwnPassword(db, user.id, { currentPassword: "zle", password: "nowe-haslo-456" }),
    ).resolves.toEqual({ ok: false, reason: "wrongPassword" });
    await expect(authenticate(db, { username: "ania", password }, now)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses for an account that no longer exists", async () => {
    await expect(
      changeOwnPassword(db, unknownId, { currentPassword: password, password: "nowe-haslo-456" }),
    ).resolves.toEqual({ ok: false, reason: "wrongPassword" });
  });

  it("signs the user out on other devices but keeps the current session", async () => {
    const user = await regularUser();
    const current = await createSession(db, user.id, now);
    const other = await createSession(db, user.id, now);

    await changeOwnPassword(
      db,
      user.id,
      { currentPassword: password, password: "nowe-haslo-456" },
      { keepSessionToken: current.token },
    );

    await expect(findSessionUser(db, current.token, now)).resolves.not.toBeNull();
    await expect(findSessionUser(db, other.token, now)).resolves.toBeNull();
  });
});

describe("user management by an administrator", () => {
  it("lists all users, oldest first", async () => {
    const actor = await admin();
    await regularUser("ania");
    await regularUser("jan");

    const users = await listUsers(db, actor);

    expect(users.map((user) => user.username)).toEqual(["admin", "ania", "jan"]);
    expect(users[0]).toEqual({
      id: actor.id,
      username: "admin",
      role: "ADMIN",
      disabled: false,
      createdAt: expect.any(Date),
    });
  });

  it("creates accounts with a chosen role", async () => {
    const actor = await admin();

    await expect(
      createUserAsAdmin(db, actor, { username: "drugi-admin", password, role: "ADMIN" }),
    ).resolves.toMatchObject({ ok: true, user: { role: "ADMIN" } });
    await expect(
      createUserAsAdmin(db, actor, { username: "drugi-admin", password, role: "USER" }),
    ).resolves.toEqual({ ok: false, reason: "usernameTaken" });
  });

  it("finds a user by id", async () => {
    const actor = await admin();
    const user = await regularUser();

    await expect(findUser(db, actor, user.id)).resolves.toMatchObject({
      id: user.id,
      username: "ania",
      disabled: false,
    });
    await expect(findUser(db, actor, unknownId)).resolves.toBeNull();
    await expect(findUser(db, actor, "not-an-id")).resolves.toBeNull();
  });

  it("blocks a user and ends their sessions", async () => {
    const actor = await admin();
    const user = await regularUser();
    const session = await createSession(db, user.id, now);

    await expect(setUserDisabled(db, actor, user.id, true, now)).resolves.toEqual({ ok: true });

    await expect(findUser(db, actor, user.id)).resolves.toMatchObject({ disabled: true });
    await expect(db.session.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(findSessionUser(db, session.token, now)).resolves.toBeNull();
  });

  it("unblocks a user", async () => {
    const actor = await admin();
    const user = await regularUser();
    await setUserDisabled(db, actor, user.id, true, now);

    await expect(setUserDisabled(db, actor, user.id, false, now)).resolves.toEqual({ ok: true });

    await expect(authenticate(db, { username: "ania", password }, now)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("does not let administrators block themselves", async () => {
    const actor = await admin();

    await expect(setUserDisabled(db, actor, actor.id, true, now)).resolves.toEqual({
      ok: false,
      reason: "ownAccount",
    });
    await expect(findUser(db, actor, actor.id)).resolves.toMatchObject({ disabled: false });
  });

  it("sets a new password for a user and signs them out everywhere", async () => {
    const actor = await admin();
    const user = await regularUser();
    await createSession(db, user.id, now);

    await expect(resetUserPassword(db, actor, user.id, "nadane-haslo-789")).resolves.toEqual({
      ok: true,
    });

    await expect(db.session.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(
      authenticate(db, { username: "ania", password: "nadane-haslo-789" }, now),
    ).resolves.toMatchObject({ ok: true });
  });

  it("does not reset the administrator's own password this way", async () => {
    const actor = await admin();

    await expect(resetUserPassword(db, actor, actor.id, "nadane-haslo-789")).resolves.toEqual({
      ok: false,
      reason: "ownAccount",
    });
  });

  it.each([unknownId, "not-an-id"])("reports a user that does not exist (%s)", async (id) => {
    const actor = await admin();

    await expect(setUserDisabled(db, actor, id, true, now)).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
    await expect(resetUserPassword(db, actor, id, "nadane-haslo-789")).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
  });

  it("refuses every management operation for a regular user", async () => {
    const actor = await regularUser("zwykly");
    const target = await regularUser("cel");

    await expect(listUsers(db, actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(findUser(db, actor, target.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createUserAsAdmin(db, actor, { username: "nowy", password, role: "ADMIN" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserDisabled(db, actor, target.id, true, now)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      resetUserPassword(db, actor, target.id, "nadane-haslo-789"),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(findUser(db, await admin(), target.id)).resolves.toMatchObject({
      disabled: false,
    });
  });
});
