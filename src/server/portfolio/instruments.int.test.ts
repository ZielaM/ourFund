import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { createTestUser } from "@/test/fixtures";
import { createInstrument, listInstruments } from "./instruments";

const db = getDb();
let ania: SessionUser;

const cdr = {
  symbol: "CDR",
  market: "GPW" as const,
  name: "CD Projekt",
  type: "STOCK" as const,
  currency: "PLN" as const,
};

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
});

afterAll(async () => {
  await disconnectDb();
});

describe("instruments", () => {
  it("adds an instrument to the shared catalogue", async () => {
    const result = await createInstrument(db, ania, cdr);

    expect(result).toEqual({ ok: true, instrument: { id: expect.any(String), ...cdr } });
    await expect(listInstruments(db)).resolves.toEqual([{ id: expect.any(String), ...cdr }]);
  });

  it("lists instruments by symbol", async () => {
    await createInstrument(db, ania, { ...cdr, symbol: "PKN", name: "Orlen" });
    await createInstrument(db, ania, cdr);
    await createInstrument(db, ania, { ...cdr, symbol: "ALE", name: "Allegro" });

    const symbols = (await listInstruments(db)).map((instrument) => instrument.symbol);

    expect(symbols).toEqual(["ALE", "CDR", "PKN"]);
  });

  it("refuses a symbol that already exists on the same market", async () => {
    await createInstrument(db, ania, cdr);

    await expect(createInstrument(db, ania, { ...cdr, name: "Duplikat" })).resolves.toEqual({
      ok: false,
      reason: "exists",
    });
  });

  it("allows the same symbol on another market", async () => {
    await createInstrument(db, ania, cdr);

    await expect(
      createInstrument(db, ania, { ...cdr, market: "XETRA", currency: "EUR" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("is visible to every user and survives the removal of its creator", async () => {
    const jan = await createTestUser(db, "jan");
    await createInstrument(db, ania, cdr);

    await db.user.delete({ where: { id: ania.id } });

    await expect(listInstruments(db)).resolves.toHaveLength(1);
    await expect(createInstrument(db, jan, cdr)).resolves.toEqual({ ok: false, reason: "exists" });
  });
});
