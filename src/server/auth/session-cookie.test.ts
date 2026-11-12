import { describe, expect, it } from "vitest";
import { isSecureRequest, sessionCookieOptions } from "./session-cookie";

const headers = (values: Record<string, string>) => new Headers(values);

describe("isSecureRequest", () => {
  it("is false for a direct plain-HTTP request", () => {
    expect(isSecureRequest(headers({}))).toBe(false);
  });

  it("is true behind an HTTPS reverse proxy", () => {
    expect(isSecureRequest(headers({ "x-forwarded-proto": "https" }))).toBe(true);
  });

  it("uses the protocol seen by the outermost proxy", () => {
    expect(isSecureRequest(headers({ "x-forwarded-proto": "HTTPS, http" }))).toBe(true);
    expect(isSecureRequest(headers({ "x-forwarded-proto": "http, https" }))).toBe(false);
  });
});

describe("sessionCookieOptions", () => {
  const expiresAt = new Date("2026-12-12T12:00:00Z");

  it("hides the cookie from scripts and limits cross-site sending", () => {
    expect(sessionCookieOptions(expiresAt, false)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: expiresAt,
    });
  });

  it("marks the cookie as secure for HTTPS requests", () => {
    expect(sessionCookieOptions(expiresAt, true).secure).toBe(true);
  });
});
