import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("produces an Argon2id hash that does not contain the password", async () => {
    const hash = await hashPassword("tajne-haslo-123");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("tajne-haslo-123");
  });

  it("salts every hash", async () => {
    const [first, second] = await Promise.all([
      hashPassword("tajne-haslo-123"),
      hashPassword("tajne-haslo-123"),
    ]);

    expect(first).not.toBe(second);
  });

  it("verifies the right password", async () => {
    const hash = await hashPassword("tajne-haslo-123");

    await expect(verifyPassword(hash, "tajne-haslo-123")).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("tajne-haslo-123");

    await expect(verifyPassword(hash, "tajne-haslo-124")).resolves.toBe(false);
  });

  it("treats a malformed stored hash as a wrong password", async () => {
    await expect(verifyPassword("not-a-hash", "tajne-haslo-123")).resolves.toBe(false);
  });
});
