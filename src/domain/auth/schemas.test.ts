import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  newAccountSchema,
  newAccountWithRoleSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  setPasswordSchema,
  signInSchema,
} from "./schemas";

const goodPassword = "poprawne-haslo-123";

function issues(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => `${String(issue.path[0])}:${issue.message}`);
}

describe("signInSchema", () => {
  it("normalizes the user name and keeps the password untouched", () => {
    const result = signInSchema.parse({ username: "  Ania ", password: " Haslo " });

    expect(result).toEqual({ username: "ania", password: " Haslo " });
  });

  it("requires both fields", () => {
    expect(issues(signInSchema.safeParse({ username: "  ", password: "" }))).toEqual([
      "username:required",
      "password:required",
    ]);
  });

  it("treats missing fields as required", () => {
    expect(issues(signInSchema.safeParse({ username: null, password: undefined }))).toEqual([
      "username:required",
      "password:required",
    ]);
  });

  it("does not apply the new-account rules to existing accounts", () => {
    expect(signInSchema.safeParse({ username: "ab", password: "x" }).success).toBe(true);
  });
});

describe("newAccountSchema", () => {
  const valid = { username: "Ania", password: goodPassword, passwordConfirmation: goodPassword };

  it("accepts a valid account and normalizes the user name", () => {
    expect(newAccountSchema.parse(valid).username).toBe("ania");
  });

  it("rejects an invalid user name", () => {
    expect(issues(newAccountSchema.safeParse({ ...valid, username: "a b" }))).toEqual([
      "username:username.invalid",
    ]);
  });

  it("requires a user name", () => {
    expect(issues(newAccountSchema.safeParse({ ...valid, username: "" }))).toContain(
      "username:required",
    );
  });

  it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} characters`, () => {
    const password = "a".repeat(PASSWORD_MIN_LENGTH - 1);

    expect(
      issues(newAccountSchema.safeParse({ ...valid, password, passwordConfirmation: password })),
    ).toEqual(["password:password.tooShort"]);
  });

  it(`accepts a password of exactly ${PASSWORD_MIN_LENGTH} characters`, () => {
    const password = "a".repeat(PASSWORD_MIN_LENGTH);

    expect(
      newAccountSchema.safeParse({ ...valid, password, passwordConfirmation: password }).success,
    ).toBe(true);
  });

  it(`rejects a password longer than ${PASSWORD_MAX_LENGTH} characters`, () => {
    const password = "a".repeat(PASSWORD_MAX_LENGTH + 1);

    expect(
      issues(newAccountSchema.safeParse({ ...valid, password, passwordConfirmation: password })),
    ).toEqual(["password:password.tooLong"]);
  });

  it("reports a confirmation that does not match", () => {
    expect(
      issues(newAccountSchema.safeParse({ ...valid, passwordConfirmation: "inne-haslo-123" })),
    ).toEqual(["passwordConfirmation:passwordConfirmation.mismatch"]);
  });
});

describe("newAccountWithRoleSchema", () => {
  const valid = {
    username: "nowy",
    password: goodPassword,
    passwordConfirmation: goodPassword,
    role: "USER",
  };

  it.each(["ADMIN", "USER"])("accepts the %s role", (role) => {
    expect(newAccountWithRoleSchema.parse({ ...valid, role }).role).toBe(role);
  });

  it("rejects an unknown role", () => {
    expect(issues(newAccountWithRoleSchema.safeParse({ ...valid, role: "OWNER" }))).toEqual([
      "role:required",
    ]);
  });
});

describe("changePasswordSchema", () => {
  const valid = {
    currentPassword: "stare",
    password: goodPassword,
    passwordConfirmation: goodPassword,
  };

  it("accepts a valid change", () => {
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
  });

  it("requires the current password", () => {
    expect(issues(changePasswordSchema.safeParse({ ...valid, currentPassword: "" }))).toEqual([
      "currentPassword:required",
    ]);
  });

  it("applies the password rules to the new password", () => {
    expect(
      issues(
        changePasswordSchema.safeParse({
          ...valid,
          password: "krotkie",
          passwordConfirmation: "krotkie",
        }),
      ),
    ).toEqual(["password:password.tooShort"]);
  });
});

describe("setPasswordSchema", () => {
  it("accepts matching passwords", () => {
    expect(
      setPasswordSchema.safeParse({ password: goodPassword, passwordConfirmation: goodPassword })
        .success,
    ).toBe(true);
  });

  it("reports a confirmation that does not match", () => {
    expect(
      issues(setPasswordSchema.safeParse({ password: goodPassword, passwordConfirmation: "" })),
    ).toEqual(["passwordConfirmation:passwordConfirmation.mismatch"]);
  });
});
