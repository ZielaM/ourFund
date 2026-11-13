import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, parseEnv, resetEnvCache } from "./env";

const validUrl = "postgresql://user:secret@localhost:5432/ourfund?schema=public";

describe("parseEnv", () => {
  it("returns the validated configuration", () => {
    expect(parseEnv({ DATABASE_URL: validUrl })).toEqual({
      DATABASE_URL: validUrl,
      ALLOW_REGISTRATION: false,
      MARKET_DATA: "live",
    });
  });

  it('turns open registration on only for the exact value "true"', () => {
    expect(parseEnv({ DATABASE_URL: validUrl, ALLOW_REGISTRATION: "true" })).toMatchObject({
      ALLOW_REGISTRATION: true,
    });
    expect(parseEnv({ DATABASE_URL: validUrl, ALLOW_REGISTRATION: "false" })).toMatchObject({
      ALLOW_REGISTRATION: false,
    });
  });

  it("rejects an unclear registration setting instead of guessing", () => {
    expect(() => parseEnv({ DATABASE_URL: validUrl, ALLOW_REGISTRATION: "yes" })).toThrowError(
      /ALLOW_REGISTRATION must be "true" or "false"/,
    );
  });

  it.each(["live", "fixture", "off"])("accepts MARKET_DATA=%s", (mode) => {
    expect(parseEnv({ DATABASE_URL: validUrl, MARKET_DATA: mode }).MARKET_DATA).toBe(mode);
  });

  it("rejects an unknown market data mode", () => {
    expect(() => parseEnv({ DATABASE_URL: validUrl, MARKET_DATA: "yahoo" })).toThrowError(
      /MARKET_DATA must be/,
    );
  });

  it("lists every problem at once", () => {
    expect(() => parseEnv({ ALLOW_REGISTRATION: "yes" })).toThrowError(
      /DATABASE_URL is required[\s\S]*ALLOW_REGISTRATION/,
    );
  });

  it("accepts the short postgres:// scheme", () => {
    const url = "postgres://user:secret@db:5432/ourfund";

    expect(parseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("explains that DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL is required/);
  });

  it("rejects a connection string for another database engine", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://user@localhost/ourfund" })).toThrowError(
      /must be a PostgreSQL connection string/,
    );
  });

  it("does not leak the provided value in the error message", () => {
    let message = "";

    try {
      parseEnv({ DATABASE_URL: "mysql://user:top-secret@localhost/ourfund" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("Invalid server configuration");
    expect(message).not.toContain("top-secret");
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("reads process.env once and caches the result", () => {
    vi.stubEnv("DATABASE_URL", validUrl);
    const first = getEnv();

    vi.stubEnv("DATABASE_URL", "postgresql://other@localhost/other");

    expect(getEnv()).toBe(first);
    expect(first.DATABASE_URL).toBe(validUrl);
  });

  it("re-reads process.env after the cache is reset", () => {
    vi.stubEnv("DATABASE_URL", validUrl);
    getEnv();
    resetEnvCache();
    vi.stubEnv("DATABASE_URL", "postgresql://other@localhost/other");

    expect(getEnv().DATABASE_URL).toBe("postgresql://other@localhost/other");
  });
});
