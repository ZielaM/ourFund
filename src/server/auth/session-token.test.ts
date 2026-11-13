import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken } from "./session-token";

describe("generateSessionToken", () => {
  it("returns 256 bits encoded for use in a cookie", () => {
    const token = generateSessionToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("returns a different token every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateSessionToken));

    expect(tokens.size).toBe(50);
  });
});

describe("hashSessionToken", () => {
  it("returns the SHA-256 of the token as hex", () => {
    expect(hashSessionToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is stable and differs between tokens", () => {
    expect(hashSessionToken("token-1")).toBe(hashSessionToken("token-1"));
    expect(hashSessionToken("token-1")).not.toBe(hashSessionToken("token-2"));
  });
});
