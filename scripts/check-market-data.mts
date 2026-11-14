// Manual check of the live data providers: `pnpm exec tsx scripts/check-market-data.mts`.
// Not part of the test suite, because it needs the internet and real third-party services.
import { addDays } from "@/domain/market-data/nbp";
import { todayInWarsaw } from "@/domain/portfolio/dates";
import { createLiveProviders } from "@/server/market-data/providers";

const providers = createLiveProviders();
const today = todayInWarsaw(new Date());
const from = addDays(today, -10);

const quotes: [string, string][] = [
  ["CDR.WA", "PLN"],
  ["VWCE.DE", "EUR"],
  ["VOD.L", "GBP"],
  ["AAPL", "USD"],
  ["BTC-USD", "USD"],
  // Benchmarks: an ETF tracking WIG20TR and the S&P 500 index.
  ["ETFBW20TR.WA", "PLN"],
  ["^GSPC", "USD"],
  ["NO-SUCH-SYMBOL.WA", "PLN"],
];

let failed = false;

for (const [symbol, currency] of quotes) {
  const result = await providers.quotes(symbol, currency, from, today);
  const expectMissing = symbol.startsWith("NO-SUCH");

  if (result.ok) {
    const last = result.closes.at(-1);
    console.log(
      `${symbol}: ${result.closes.length} closes, last ${last?.date} ${last?.close} ${currency}`,
    );
    failed ||= expectMissing || result.closes.length === 0;
  } else {
    console.log(`${symbol}: ${result.reason}`);
    failed ||= !(expectMissing && result.reason === "notFound");
  }
}

for (const currency of ["USD", "EUR", "JPY"]) {
  const result = await providers.rates(currency, from, today);

  if (result.ok) {
    const last = result.rates.at(-1);
    console.log(`${currency}/PLN: ${result.rates.length} rates, last ${last?.date} ${last?.rate}`);
    failed ||= result.rates.length === 0;
  } else {
    console.log(`${currency}/PLN: ${result.reason}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
