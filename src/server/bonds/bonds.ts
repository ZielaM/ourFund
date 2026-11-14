import type { BondInput } from "@/domain/bonds/inputs";
import { bondKindOf, bondName, periodCount, type BondKind } from "@/domain/bonds/kinds";
import type { BondSeries } from "@/domain/bonds/valuation";
import { Decimal } from "@/domain/decimal";
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
  rates: { period: number; rate: Decimal }[];
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

/** The terms of a bond series, or null when the instrument is not a treasury bond. */
export async function getBond(db: Db, instrumentId: string): Promise<BondDetail | null> {
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

  return {
    instrumentId,
    series: series.instrument.symbol,
    kind: series.kind,
    firstRate: toDecimal(series.firstRate),
    margin: series.margin ? toDecimal(series.margin) : null,
    rates: series.rates.map(({ period, rate }) => ({ period, rate: toDecimal(rate) })),
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
): Promise<Map<string, BondSeries>> {
  const rows = await db.bondSeries.findMany({
    where: { instrumentId: { in: [...instrumentIds] } },
    include: { rates: true },
  });

  // Stored in percent, used as fractions.
  const fraction = (value: { toString(): string }) => toDecimal(value).div(100);

  return new Map(
    rows.map((row) => [
      row.instrumentId,
      {
        kind: row.kind,
        firstRate: fraction(row.firstRate),
        laterRates: new Map(row.rates.map(({ period, rate }) => [period, fraction(rate)])),
      },
    ]),
  );
}
