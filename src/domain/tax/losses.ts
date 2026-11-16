import { Decimal } from "@/domain/decimal";

/** A loss of one tax year that later income of the same source may still absorb. */
export type LossPool = {
  /** The year the loss was made in. */
  year: number;
  original: Decimal;
  remaining: Decimal;
  /** Whether the single deduction above half of the loss has been used. */
  oneOffUsed: boolean;
};

export type LossDeduction = {
  total: Decimal;
  /** How much comes from the loss of which year, oldest first. */
  parts: { year: number; amount: Decimal }[];
};

/** A loss can be deducted in the five tax years that follow it. */
export const LOSS_WINDOW_YEARS = 5;
/** In one of those years the deduction may exceed half of the loss, up to this amount. */
const ONE_OFF_LIMIT = new Decimal(5_000_000);
const HALF = new Decimal("0.5");
const ZERO = new Decimal(0);

export function isUsable(pool: LossPool, year: number): boolean {
  return pool.remaining.gt(0) && year > pool.year && year <= pool.year + LOSS_WINDOW_YEARS;
}

/**
 * The largest deduction of earlier losses the law allows from `income` of `year`
 * (art. 9 ust. 3 of the Polish PIT act, for losses made from 2019 on): in each of the five
 * following years at most half of a loss, except once, when up to 5 000 000 zł of it may be
 * deducted at a time. The oldest loss is used first, as it expires first, and the single
 * larger deduction is spent only when half of the loss would not be enough.
 *
 * Deducting is the taxpayer's choice; this is the upper limit, not what a return must say.
 * Returns the deduction and the pools as they are left afterwards.
 */
export function deductLosses(
  pools: readonly LossPool[],
  year: number,
  income: Decimal,
): { deduction: LossDeduction; pools: LossPool[] } {
  let left = Decimal.max(income, ZERO);
  const parts: LossDeduction["parts"] = [];

  const after = [...pools]
    .sort((a, b) => a.year - b.year)
    .map((pool) => {
      if (!isUsable(pool, year) || left.lte(0)) {
        return pool;
      }

      const wanted = Decimal.min(pool.remaining, left);
      const half = pool.original.times(HALF);
      let amount = wanted;
      let oneOffUsed = pool.oneOffUsed;
      if (wanted.gt(half)) {
        if (pool.oneOffUsed) {
          amount = half;
        } else {
          amount = Decimal.min(wanted, ONE_OFF_LIMIT);
          oneOffUsed = true;
        }
      }

      left = left.minus(amount);
      parts.push({ year: pool.year, amount });
      return { ...pool, remaining: pool.remaining.minus(amount), oneOffUsed };
    });

  return {
    deduction: {
      total: parts.reduce((sum, part) => sum.plus(part.amount), ZERO),
      parts,
    },
    pools: after,
  };
}
