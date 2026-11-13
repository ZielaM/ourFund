import type { InstrumentInput } from "@/domain/portfolio/naming";
import type { InstrumentType } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import { isUniqueViolation } from "./portfolios";

export type InstrumentSummary = {
  id: string;
  symbol: string;
  market: string;
  name: string;
  type: InstrumentType;
  currency: string;
};

export type CreateInstrumentResult =
  { ok: true; instrument: InstrumentSummary } | { ok: false; reason: "exists" };

const summary = {
  id: true,
  symbol: true,
  market: true,
  name: true,
  type: true,
  currency: true,
} as const;

/** The instrument catalogue, shared by every user of the instance. */
export function listInstruments(db: Db): Promise<InstrumentSummary[]> {
  return db.instrument.findMany({
    select: summary,
    orderBy: [{ symbol: "asc" }, { market: "asc" }],
  });
}

/** Any signed-in user can add an instrument; a symbol can exist only once per market. */
export async function createInstrument(
  db: Db,
  actor: SessionUser,
  input: InstrumentInput,
): Promise<CreateInstrumentResult> {
  try {
    const instrument = await db.instrument.create({
      data: { ...input, createdById: actor.id },
      select: summary,
    });
    return { ok: true, instrument };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "exists" };
    }
    throw error;
  }
}
