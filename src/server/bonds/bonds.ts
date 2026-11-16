import { indexedRates, monthKey, type IndexData } from "@/domain/bonds/indexation";
import type { BondInput } from "@/domain/bonds/inputs";
import { bondKindOf, bondName, periodCount, type BondKind } from "@/domain/bonds/kinds";
import type { BondSeries } from "@/domain/bonds/valuation";
import { Decimal } from "@/domain/decimal";
import { todayInWarsaw, utcToIsoDate } from "@/domain/portfolio/dates";
import { TREASURY_MARKET } from "@/domain/portfolio/markets";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import { isUniqueViolation, isUuid } from "@/server/portfolio/portfolios";

export type BondDetail = {
  instrumentId: string;
  series: string;
  kind: BondKind;
  /** Rates are in percent, as entered: 5.35 means 5.35% a year. */
  firstRate: Decimal;
  margin: Decimal | null;
  /**
   * Later periods with a known rate: entered by hand ("MANUAL") or worked out from GUS's
   * inflation or the NBP reference rate ("COMPUTED"). An entered rate replaces a computed one.
   */
  rates: { period: number; rate: Decimal; source: "MANUAL" | "COMPUTED" }[];
};

export type CreateBondResult = { ok: true; instrumentId: string } | { ok: false; reason: "exists" };

export type BondRateResult = { ok: true } | { ok: false; reason: "notFound" | "invalidPeriod" };

const toDecimal = (value: { toString(): string }) => new Decimal(value.toString());

// The catalogue is shared, so any signed-in user may maintain it. The acting user is still
// required: these functions must never be reachable without a session.

/** Adds a retail treasury bond series to the catalogue, valued from its terms. */
export async function createBond(
  db: Db,
  actor: SessionUser,
  input: BondInput,
): Promise<CreateBondResult> {
  const kind = bondKindOf(input.series);
  const name = bondName(input.series);
  if (!kind || !name) {
    throw new Error(`"${input.series}" is not a bond series`);
  }

  try {
    const instrument = await db.instrument.create({
      data: {
        symbol: input.series,
        market: TREASURY_MARKET,
        name,
        type: "BOND",
        currency: "PLN",
        priceSource: "TREASURY",
        createdById: actor.id,
        bondSeries: {
          create: {
            kind,
            firstRate: input.firstRate.toFixed(),
            margin: input.margin?.toFixed() ?? null,
          },
        },
      },
    });
    return { ok: true, instrumentId: instrument.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "exists" };
    }
    throw error;
  }
}

/** The stored inflation readings and reference rate changes that floating rates follow. */
export async function loadIndexData(db: Db): Promise<IndexData> {
  const [readings, changes] = await Promise.all([
    db.inflationReading.findMany(),
    db.referenceRate.findMany({ orderBy: { validFrom: "asc" } }),
  ]);

  return {
    inflation: new Map(readings.map((row) => [monthKey(row), toDecimal(row.value)])),
    referenceRates: changes.map((row) => ({
      validFrom: utcToIsoDate(row.validFrom),
      rate: toDecimal(row.rate),
    })),
  };
}

/** The terms of a bond series, or null when the instrument is not a treasury bond. */
export async function getBond(
  db: Db,
  instrumentId: string,
  now: Date = new Date(),
): Promise<BondDetail | null> {
  if (!isUuid(instrumentId)) {
    return null;
  }

  const series = await db.bondSeries.findUnique({
    where: { instrumentId },
    include: { instrument: { select: { symbol: true } }, rates: { orderBy: { period: "asc" } } },
  });

  if (!series) {
    return null;
  }

  const margin = series.margin ? toDecimal(series.margin) : null;
  const entered = new Map(series.rates.map(({ period, rate }) => [period, toDecimal(rate)]));
  const computed = indexedRates(
    series.instrument.symbol,
    margin,
    await loadIndexData(db),
    todayInWarsaw(now),
  );

  return {
    instrumentId,
    series: series.instrument.symbol,
    kind: series.kind,
    firstRate: toDecimal(series.firstRate),
    margin,
    rates: [...new Set([...entered.keys(), ...computed.keys()])]
      .sort((a, b) => a - b)
      .map((period) => {
        const manual = entered.get(period);
        return manual
          ? { period, rate: manual, source: "MANUAL" as const }
          : { period, rate: computed.get(period)!, source: "COMPUTED" as const };
      }),
  };
}

/** Records the announced rate (in percent) of a later interest period, replacing any earlier entry. */
export async function setBondRate(
  db: Db,
  _actor: SessionUser,
  instrumentId: string,
  period: number,
  rate: Decimal,
): Promise<BondRateResult> {
  const bond = await getBond(db, instrumentId);
  if (!bond) {
    return { ok: false, reason: "notFound" };
  }
  if (!Number.isInteger(period) || period < 2 || period > periodCount(bond.kind)) {
    return { ok: false, reason: "invalidPeriod" };
  }

  await db.bondRate.upsert({
    where: { instrumentId_period: { instrumentId, period } },
    create: { instrumentId, period, rate: rate.toFixed() },
    update: { rate: rate.toFixed() },
  });
  return { ok: true };
}

export async function deleteBondRate(
  db: Db,
  _actor: SessionUser,
  instrumentId: string,
  period: number,
): Promise<BondRateResult> {
  if (!isUuid(instrumentId) || !Number.isInteger(period)) {
    return { ok: false, reason: "notFound" };
  }

  const { count } = await db.bondRate.deleteMany({ where: { instrumentId, period } });
  return count > 0 ? { ok: true } : { ok: false, reason: "notFound" };
}

/** The terms of the given instruments that are treasury bonds, ready for valuation. */
export async function loadBondSeries(
  db: Db,
  instrumentIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, BondSeries>> {
  const rows = await db.bondSeries.findMany({
    where: { instrumentId: { in: [...instrumentIds] } },
    include: { rates: true, instrument: { select: { symbol: true } } },
  });
  if (rows.length === 0) {
    return new Map();
  }

  const indexes = await loadIndexData(db);
  const today = todayInWarsaw(now);

  // Stored in percent, used as fractions.
  const fraction = (value: { toString(): string }) => toDecimal(value).div(100);

  return new Map(
    rows.map((row) => [
      row.instrumentId,
      {
        kind: row.kind,
        firstRate: fraction(row.firstRate),
        // Rates worked out from the indexes first, so that entered ones replace them.
        laterRates: new Map([
          ...[
            ...indexedRates(
              row.instrument.symbol,
              row.margin ? toDecimal(row.margin) : null,
              indexes,
              today,
            ),
          ].map(([period, rate]) => [period, rate.div(100)] as const),
          ...row.rates.map(({ period, rate }) => [period, fraction(rate)] as const),
        ]),
      },
    ]),
  );
}
