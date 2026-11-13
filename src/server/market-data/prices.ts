import { Decimal } from "@/domain/decimal";
import type { ManualPriceInput, QuoteSettingsInput } from "@/domain/market-data/inputs";
import { isoDateToUtc, todayInWarsaw, utcToIsoDate, type IsoDate } from "@/domain/portfolio/dates";
import type { PriceSource } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import { isUuid } from "@/server/portfolio/portfolios";

export type PriceView = {
  date: IsoDate;
  close: Decimal;
  source: PriceSource;
};

export type InstrumentDetail = {
  id: string;
  symbol: string;
  market: string;
  name: string;
  type: string;
  currency: string;
  priceSource: PriceSource;
  quoteSymbol: string | null;
};

export type PriceChangeResult =
  { ok: true } | { ok: false; reason: "notFound" | "futureDate" | "notManual" };

function toView(row: {
  date: Date;
  close: { toString(): string };
  source: PriceSource;
}): PriceView {
  return {
    date: utcToIsoDate(row.date),
    close: new Decimal(row.close.toString()),
    source: row.source,
  };
}

/** The most recent price of each instrument that has one. */
export async function getLatestPrices(
  db: Db,
  instrumentIds: readonly string[],
): Promise<Map<string, PriceView>> {
  const rows = await db.price.findMany({
    where: { instrumentId: { in: [...instrumentIds] } },
    orderBy: [{ instrumentId: "asc" }, { date: "desc" }],
    distinct: ["instrumentId"],
  });

  return new Map(rows.map((row) => [row.instrumentId, toView(row)]));
}

export async function getInstrument(
  db: Db,
  instrumentId: string,
): Promise<InstrumentDetail | null> {
  if (!isUuid(instrumentId)) {
    return null;
  }

  return db.instrument.findUnique({
    where: { id: instrumentId },
    select: {
      id: true,
      symbol: true,
      market: true,
      name: true,
      type: true,
      currency: true,
      priceSource: true,
      quoteSymbol: true,
    },
  });
}

/** An instrument's most recent prices, newest first. */
export async function listPrices(db: Db, instrumentId: string, limit = 15): Promise<PriceView[]> {
  if (!isUuid(instrumentId)) {
    return [];
  }

  const rows = await db.price.findMany({
    where: { instrumentId },
    orderBy: { date: "desc" },
    take: limit,
  });

  return rows.map(toView);
}

// The instrument catalogue is shared, so any signed-in user may maintain it. The acting user
// is still required: these functions must never be reachable without a session.

export async function updateQuoteSettings(
  db: Db,
  _actor: SessionUser,
  instrumentId: string,
  input: QuoteSettingsInput,
): Promise<{ ok: true } | { ok: false; reason: "notFound" }> {
  if (!(await getInstrument(db, instrumentId))) {
    return { ok: false, reason: "notFound" };
  }

  await db.instrument.update({ where: { id: instrumentId }, data: input });
  return { ok: true };
}

/** Records a price entered by hand. It replaces any price already stored for that day. */
export async function setManualPrice(
  db: Db,
  _actor: SessionUser,
  instrumentId: string,
  input: ManualPriceInput,
  now: Date = new Date(),
): Promise<PriceChangeResult> {
  if (!(await getInstrument(db, instrumentId))) {
    return { ok: false, reason: "notFound" };
  }
  if (input.date > todayInWarsaw(now)) {
    return { ok: false, reason: "futureDate" };
  }

  const date = isoDateToUtc(input.date);
  const close = input.close.toFixed();

  await db.price.upsert({
    where: { instrumentId_date: { instrumentId, date } },
    create: { instrumentId, date, close, source: "MANUAL" },
    update: { close, source: "MANUAL" },
  });

  return { ok: true };
}

/** Removes a price entered by hand. Fetched prices are not deleted this way. */
export async function deleteManualPrice(
  db: Db,
  _actor: SessionUser,
  instrumentId: string,
  date: IsoDate,
): Promise<PriceChangeResult> {
  if (!isUuid(instrumentId)) {
    return { ok: false, reason: "notFound" };
  }

  const price = await db.price.findUnique({
    where: { instrumentId_date: { instrumentId, date: isoDateToUtc(date) } },
  });

  if (!price) {
    return { ok: false, reason: "notFound" };
  }
  if (price.source !== "MANUAL") {
    return { ok: false, reason: "notManual" };
  }

  await db.price.delete({
    where: { instrumentId_date: { instrumentId, date: isoDateToUtc(date) } },
  });
  return { ok: true };
}
