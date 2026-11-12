import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health";

describe("checkHealth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports ok when the database answers", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };

    await expect(checkHealth(db as never)).resolves.toEqual({ status: "ok", database: "ok" });
    expect(db.$queryRaw).toHaveBeenCalledOnce();
  });

  it("reports an error instead of throwing when the database is unreachable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("connection refused");
    const db = { $queryRaw: vi.fn().mockRejectedValue(failure) };

    await expect(checkHealth(db as never)).resolves.toEqual({
      status: "error",
      database: "error",
    });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("database"), failure);
  });
});
