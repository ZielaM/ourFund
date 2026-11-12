import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
const requestHeaders = new Headers();
const sessions = {
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  findSessionUser: vi.fn(),
};
const db = { name: "fake database" };

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
  headers: async () => requestHeaders,
}));
const connection = vi.fn();
vi.mock("next/server", () => ({ connection }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/server/db/client", () => ({ getDb: () => db }));
vi.mock("./sessions", () => sessions);

const { endSession, getCurrentUser, getSessionToken, requireAdmin, requireUser, startSession } =
  await import("./current-user");

const ania = { id: "user-1", username: "ania", role: "USER" };
const szef = { id: "user-2", username: "szef", role: "ADMIN" };

function signedInAs(user: typeof ania | null) {
  cookieStore.get.mockReturnValue({ name: "ourfund_session", value: "token-1" });
  sessions.findSessionUser.mockResolvedValue(user);
}

beforeEach(() => {
  vi.resetAllMocks();
  requestHeaders.delete("x-forwarded-proto");
});

describe("getSessionToken", () => {
  it("reads the session cookie", async () => {
    cookieStore.get.mockReturnValue({ name: "ourfund_session", value: "token-1" });

    await expect(getSessionToken()).resolves.toBe("token-1");
    expect(cookieStore.get).toHaveBeenCalledWith("ourfund_session");
  });

  it("returns undefined without a cookie", async () => {
    await expect(getSessionToken()).resolves.toBeUndefined();
  });
});

describe("getCurrentUser", () => {
  it("returns null without a cookie and does not touch the database", async () => {
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(sessions.findSessionUser).not.toHaveBeenCalled();
  });

  it("waits for a real request before reading the session", async () => {
    signedInAs(ania);
    connection.mockImplementation(async () => {
      expect(cookieStore.get).not.toHaveBeenCalled();
    });

    await getCurrentUser();

    expect(connection).toHaveBeenCalledOnce();
    expect(cookieStore.get).toHaveBeenCalled();
  });

  it("looks the user up by the cookie token", async () => {
    signedInAs(ania);

    await expect(getCurrentUser()).resolves.toEqual(ania);
    expect(sessions.findSessionUser).toHaveBeenCalledWith(db, "token-1");
  });

  it("returns null for a token that is no longer valid", async () => {
    signedInAs(null);

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the signed-in user", async () => {
    signedInAs(ania);

    await expect(requireUser()).resolves.toEqual(ania);
  });

  it("redirects to the sign-in page otherwise", async () => {
    await expect(requireUser()).rejects.toThrowError("REDIRECT:/login");
  });
});

describe("requireAdmin", () => {
  it("returns an administrator", async () => {
    signedInAs(szef);

    await expect(requireAdmin()).resolves.toEqual(szef);
  });

  it("answers 'not found' to a regular user", async () => {
    signedInAs(ania);

    await expect(requireAdmin()).rejects.toThrowError("NOT_FOUND");
  });

  it("redirects a visitor who is not signed in", async () => {
    await expect(requireAdmin()).rejects.toThrowError("REDIRECT:/login");
  });
});

describe("startSession", () => {
  const expiresAt = new Date("2026-12-12T12:00:00Z");

  beforeEach(() => {
    sessions.createSession.mockResolvedValue({ token: "new-token", expiresAt });
  });

  it("creates a session and stores its token in an http-only cookie", async () => {
    await startSession("user-1");

    expect(sessions.createSession).toHaveBeenCalledWith(db, "user-1");
    expect(cookieStore.set).toHaveBeenCalledWith("ourfund_session", "new-token", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: expiresAt,
    });
  });

  it("marks the cookie as secure behind an HTTPS proxy", async () => {
    requestHeaders.set("x-forwarded-proto", "https");

    await startSession("user-1");

    expect(cookieStore.set).toHaveBeenCalledWith(
      "ourfund_session",
      "new-token",
      expect.objectContaining({ secure: true }),
    );
  });
});

describe("endSession", () => {
  it("deletes the session and the cookie", async () => {
    cookieStore.get.mockReturnValue({ name: "ourfund_session", value: "token-1" });

    await endSession();

    expect(sessions.deleteSession).toHaveBeenCalledWith(db, "token-1");
    expect(cookieStore.delete).toHaveBeenCalledWith("ourfund_session");
  });

  it("still clears the cookie when there is no session", async () => {
    await endSession();

    expect(sessions.deleteSession).not.toHaveBeenCalled();
    expect(cookieStore.delete).toHaveBeenCalledWith("ourfund_session");
  });
});
