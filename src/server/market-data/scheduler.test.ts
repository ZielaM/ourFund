import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cron = vi.fn();
const env = { MARKET_DATA: "live" };
const refreshMarketDataOnce = vi.fn();
const getLastRefresh = vi.fn();
const providers = { name: "fake providers" };
const db = { name: "fake database" };

vi.mock("croner", () => ({
  Cron: class {
    constructor(...args: unknown[]) {
      cron(...args);
    }
  },
}));
vi.mock("@/server/env", () => ({ getEnv: () => env }));
vi.mock("@/server/db/client", () => ({ getDb: () => db }));
vi.mock("./providers", () => ({
  getMarketDataProviders: (mode: string) => (mode === "off" ? null : providers),
}));
vi.mock("./refresh", () => ({ refreshMarketDataOnce, getLastRefresh }));

const { startMarketDataScheduler } = await import("./scheduler");

const report = {
  finishedAt: "2026-11-13T10:00:00.000Z",
  instruments: { updated: 2, failed: [] },
  currencies: { updated: 1, failed: [] },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  env.MARKET_DATA = "live";
  refreshMarketDataOnce.mockResolvedValue(report);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("startMarketDataScheduler", () => {
  it.each(["fixture", "off"])("does nothing in %s mode", async (mode) => {
    env.MARKET_DATA = mode;

    startMarketDataScheduler();
    await vi.runAllTimersAsync();

    expect(cron).not.toHaveBeenCalled();
    expect(refreshMarketDataOnce).not.toHaveBeenCalled();
  });

  it("schedules two daily runs in Polish time", () => {
    getLastRefresh.mockResolvedValue(report);

    startMarketDataScheduler();

    expect(cron.mock.calls.map((call) => call[0])).toEqual(["30 18 * * *", "15 23 * * *"]);
    expect(cron.mock.calls[0][1]).toMatchObject({ timezone: "Europe/Warsaw" });
  });

  it("refreshes when a scheduled time comes", async () => {
    getLastRefresh.mockResolvedValue(report);
    startMarketDataScheduler();

    await cron.mock.calls[0][2]();

    expect(refreshMarketDataOnce).toHaveBeenCalledWith(db, providers);
  });

  it("catches up shortly after start when the data is old", async () => {
    getLastRefresh.mockResolvedValue({ ...report, finishedAt: "2026-11-13T05:59:00.000Z" });

    startMarketDataScheduler();
    expect(refreshMarketDataOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(refreshMarketDataOnce).toHaveBeenCalledOnce();
  });

  it("catches up when no refresh has ever run", async () => {
    getLastRefresh.mockResolvedValue(null);

    startMarketDataScheduler();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(refreshMarketDataOnce).toHaveBeenCalledOnce();
  });

  it("does not refresh at start when the data is recent", async () => {
    getLastRefresh.mockResolvedValue({ ...report, finishedAt: "2026-11-13T09:00:00.000Z" });

    startMarketDataScheduler();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(refreshMarketDataOnce).not.toHaveBeenCalled();
  });

  it("logs a failed refresh instead of crashing the server", async () => {
    getLastRefresh.mockResolvedValue(null);
    const failure = new Error("database is down");
    refreshMarketDataOnce.mockRejectedValue(failure);

    startMarketDataScheduler();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("startup"), failure);
  });

  it("logs a failure to read the last refresh instead of crashing the server", async () => {
    const failure = new Error("database is down");
    getLastRefresh.mockRejectedValue(failure);

    startMarketDataScheduler();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(console.error).toHaveBeenCalledWith(expect.any(String), failure);
    expect(refreshMarketDataOnce).not.toHaveBeenCalled();
  });
});
