import { Cron } from "croner";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { getMarketDataProviders } from "./providers";
import { getLastRefresh, refreshMarketDataOnce } from "./refresh";

const TIME_ZONE = "Europe/Warsaw";
/** After the Warsaw close (17:05) and after the US close (22:00 Polish time). */
const SCHEDULES = ["30 18 * * *", "15 23 * * *"];
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 20_000;

async function run(reason: string): Promise<void> {
  const providers = getMarketDataProviders(getEnv().MARKET_DATA);
  if (!providers) {
    return;
  }

  try {
    const report = await refreshMarketDataOnce(getDb(), providers);
    console.log(
      `Market data refreshed (${reason}): ${report.instruments.updated} instruments, ` +
        `${report.currencies.updated} currencies, ` +
        `${report.instruments.failed.length + report.currencies.failed.length} failed`,
    );
  } catch (error) {
    console.error(`Market data refresh failed (${reason})`, error);
  }
}

async function runIfStale(): Promise<void> {
  try {
    const last = await getLastRefresh(getDb());
    const age = last ? Date.now() - Date.parse(last.finishedAt) : Infinity;

    if (age > STALE_AFTER_MS) {
      await run("startup");
    }
  } catch (error) {
    console.error("Could not check the age of market data", error);
  }
}

/**
 * Keeps prices and exchange rates fresh while the server runs. Only in "live" mode:
 * tests and instances with market data switched off never start background fetching.
 */
export function startMarketDataScheduler(): void {
  if (getEnv().MARKET_DATA !== "live") {
    return;
  }

  for (const schedule of SCHEDULES) {
    new Cron(schedule, { timezone: TIME_ZONE, protect: true }, () => run("schedule"));
  }

  // Catch up after downtime, once the server has had time to finish starting.
  setTimeout(() => void runIfStale(), STARTUP_DELAY_MS).unref();
}
