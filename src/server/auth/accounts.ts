import { z } from "zod";
import { evaluateLockout, LOCKOUT_WINDOW_MS } from "@/domain/auth/lockout";
import { Prisma, type PrismaClient, type User, type UserRole } from "@/generated/prisma/client";
import type { Db } from "@/server/db/types";
import { hashPassword, verifyPassword } from "./password";
import { deleteUserSessions, type SessionUser } from "./sessions";

export class ForbiddenError extends Error {
  constructor() {
    super("Administrator rights are required");
    this.name = "ForbiddenError";
  }
}

export type UserSummary = {
  id: string;
  username: string;
  role: UserRole;
  disabled: boolean;
  createdAt: Date;
};

export type CreateAccountResult =
  { ok: true; user: SessionUser } | { ok: false; reason: "usernameTaken" | "setupAlreadyDone" };

export type AuthenticationResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalidCredentials" }
  | { ok: false; reason: "locked"; retryAt: Date };

export type ChangePasswordResult = { ok: true } | { ok: false; reason: "wrongPassword" };

export type ManageUserResult = { ok: true } | { ok: false; reason: "notFound" | "ownAccount" };

const LOGIN_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;

// Arbitrary constant identifying the "first administrator" advisory lock.
const SETUP_LOCK_KEY = 7_316_001;

function assertAdmin(actor: SessionUser): void {
  if (actor.role !== "ADMIN") {
    throw new ForbiddenError();
  }
}

function toSessionUser(user: User): SessionUser {
  return { id: user.id, username: user.username, role: user.role };
}

function toSummary(user: User): UserSummary {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: user.disabledAt !== null,
    createdAt: user.createdAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

/** True until the first account exists; the app then shows the first-run setup. */
export async function isSetupRequired(db: Db): Promise<boolean> {
  return (await db.user.count()) === 0;
}

/**
 * Creates the administrator during first-run setup. Works only while there are no accounts,
 * and takes a lock so that two simultaneous requests cannot both succeed.
 */
export async function createFirstAdmin(
  db: PrismaClient,
  input: { username: string; password: string },
): Promise<CreateAccountResult> {
  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY}::bigint)`;

    if ((await tx.user.count()) > 0) {
      return { ok: false, reason: "setupAlreadyDone" };
    }

    const user = await tx.user.create({
      data: { username: input.username, passwordHash, role: "ADMIN" },
    });

    return { ok: true, user: toSessionUser(user) };
  });
}

async function createUser(
  db: Db,
  input: { username: string; password: string; role: UserRole },
): Promise<CreateAccountResult> {
  try {
    const user = await db.user.create({
      data: {
        username: input.username,
        passwordHash: await hashPassword(input.password),
        role: input.role,
      },
    });

    return { ok: true, user: toSessionUser(user) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "usernameTaken" };
    }
    throw error;
  }
}

/** Open registration (only reachable when ALLOW_REGISTRATION is on). Always a regular user. */
export function registerUser(
  db: Db,
  input: { username: string; password: string },
): Promise<CreateAccountResult> {
  return createUser(db, { ...input, role: "USER" });
}

export async function createUserAsAdmin(
  db: Db,
  actor: SessionUser,
  input: { username: string; password: string; role: UserRole },
): Promise<CreateAccountResult> {
  assertAdmin(actor);
  return createUser(db, input);
}

let placeholderHash: Promise<string> | undefined;

/**
 * Checks a user name and password. Unknown and blocked accounts get the same answer and
 * take the same time as a wrong password, so the response does not reveal which names exist.
 */
export async function authenticate(
  db: Db,
  input: { username: string; password: string },
  now: Date = new Date(),
): Promise<AuthenticationResult> {
  const attempts = await db.loginAttempt.findMany({
    where: {
      username: input.username,
      createdAt: { gt: new Date(now.getTime() - LOCKOUT_WINDOW_MS) },
    },
    select: { succeeded: true, createdAt: true },
  });

  const lockout = evaluateLockout(attempts, now);
  if (lockout.locked) {
    return { ok: false, reason: "locked", retryAt: lockout.retryAt };
  }

  const user = await db.user.findUnique({ where: { username: input.username } });

  placeholderHash ??= hashPassword("placeholder for accounts that do not exist");
  const passwordMatches = await verifyPassword(
    user?.passwordHash ?? (await placeholderHash),
    input.password,
  );
  const succeeded = user !== null && passwordMatches && user.disabledAt === null;

  await db.loginAttempt.create({
    data: { username: input.username, succeeded, createdAt: now },
  });

  if (!succeeded) {
    return { ok: false, reason: "invalidCredentials" };
  }

  await db.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - LOGIN_HISTORY_RETENTION_MS) } },
  });

  return { ok: true, user: toSessionUser(user) };
}

/** Changes the signed-in user's password and signs them out on every other device. */
export async function changeOwnPassword(
  db: Db,
  userId: string,
  input: { currentPassword: string; password: string },
  options: { keepSessionToken?: string } = {},
): Promise<ChangePasswordResult> {
  const user = await db.user.findUnique({ where: { id: userId } });

  if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
    return { ok: false, reason: "wrongPassword" };
  }

  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.password) },
  });
  await deleteUserSessions(db, userId, { exceptToken: options.keepSessionToken });

  return { ok: true };
}

export async function listUsers(db: Db, actor: SessionUser): Promise<UserSummary[]> {
  assertAdmin(actor);

  const users = await db.user.findMany({ orderBy: [{ createdAt: "asc" }, { username: "asc" }] });
  return users.map(toSummary);
}

export async function findUser(
  db: Db,
  actor: SessionUser,
  userId: string,
): Promise<UserSummary | null> {
  assertAdmin(actor);

  if (!isUuid(userId)) {
    return null;
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  return user ? toSummary(user) : null;
}

async function findManageableUser(
  db: Db,
  actor: SessionUser,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: "notFound" | "ownAccount" }> {
  assertAdmin(actor);

  // Administrators manage their own account in the settings, with their current password.
  // This also guarantees that at least one active administrator always remains.
  if (userId === actor.id) {
    return { ok: false, reason: "ownAccount" };
  }

  if (!isUuid(userId) || !(await db.user.findUnique({ where: { id: userId } }))) {
    return { ok: false, reason: "notFound" };
  }

  return { ok: true };
}

/** Blocks or unblocks an account. Blocking also ends all of that user's sessions. */
export async function setUserDisabled(
  db: Db,
  actor: SessionUser,
  userId: string,
  disabled: boolean,
  now: Date = new Date(),
): Promise<ManageUserResult> {
  const target = await findManageableUser(db, actor, userId);
  if (!target.ok) {
    return target;
  }

  await db.user.update({
    where: { id: userId },
    data: { disabledAt: disabled ? now : null },
  });

  if (disabled) {
    await deleteUserSessions(db, userId);
  }

  return { ok: true };
}

/** Sets a new password for another user and signs them out everywhere. */
export async function resetUserPassword(
  db: Db,
  actor: SessionUser,
  userId: string,
  password: string,
): Promise<ManageUserResult> {
  const target = await findManageableUser(db, actor, userId);
  if (!target.ok) {
    return target;
  }

  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  });
  await deleteUserSessions(db, userId);

  return { ok: true };
}
