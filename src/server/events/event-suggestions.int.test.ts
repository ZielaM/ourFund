import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { createTestUser, UNKNOWN_ID } from "@/test/fixtures";
import { dismissEvent, getEventSuggestions } from "./event-suggestions";

const db = getDb();
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

let ania: SessionUser;
let bartek: SessionUser;
let portfolioId: string;
let broker: string;
let ike: string;
let acme: string;
let foreign: string;

async function buy(accountId: string, instrumentId: string, date: string, quantity: string) {
  await db.transaction.create({
    data: {
      accountId,
      type: "BUY",
      date: day(date),
      instrumentId,
      quantity,
      price: "100",
      currency: "PLN",
    },
  });
}

async function event(
  instrumentId: string,
  type: "DIVIDEND" | "SPLIT",
  date: string,
  value: string,
): Promise<string> {
  const created = await db.instrumentEvent.create({
    data: { instrumentId, type, date: day(date), value },
  });
  return created.id;
}

const summary = async (actor: SessionUser = ania) =>
  (await getEventSuggestions(db, actor, portfolioId))?.map((view) => [
    view.account.name,
    view.instrument.symbol,
    view.suggestion.type,
    view.suggestion.quantity.toFixed(),
    view.suggestedTax?.toFixed() ?? null,
  ]);

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  bartek = await createTestUser(db, "bartek");

  const portfolio = await db.portfolio.create({ data: { userId: ania.id, name: "Główny" } });
  portfolioId = portfolio.id;
  broker = (await db.account.create({ data: { portfolioId, name: "Makler" } })).id;
  ike = (await db.account.create({ data: { portfolioId, name: "IKE", type: "IKE" } })).id;
  acme = (
    await db.instrument.create({
      data: { symbol: "ACME", market: "GPW", name: "Acme", type: "STOCK", currency: "PLN" },
    })
  ).id;
  foreign = (
    await db.instrument.create({
      data: { symbol: "FRGN", market: "NYSE", name: "Foreign", type: "STOCK", currency: "USD" },
    })
  ).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe("getEventSuggestions", () => {
  it("lists missing dividends and splits per account, with the tax a Polish payer withholds", async () => {
    await buy(broker, acme, "2026-01-05", "10");
    await buy(ike, acme, "2026-01-05", "4");
    await buy(broker, foreign, "2026-01-05", "3");
    await event(acme, "SPLIT", "2026-03-02", "2");
    await event(acme, "DIVIDEND", "2026-06-15", "1.5");
    await event(foreign, "DIVIDEND", "2026-06-15", "2");

    // 10 units x 1.50 = 15.00, of which 19% is withheld on the taxable account only.
    await expect(summary()).resolves.toEqual([
      ["Makler", "ACME", "SPLIT", "10", null],
      ["Makler", "ACME", "DIVIDEND", "10", "2.85"],
      ["Makler", "FRGN", "DIVIDEND", "3", "0"],
      ["IKE", "ACME", "SPLIT", "4", null],
      ["IKE", "ACME", "DIVIDEND", "4", "0"],
    ]);
  });

  it("drops a suggestion once the transaction is recorded", async () => {
    await buy(broker, acme, "2026-01-05", "10");
    await event(acme, "SPLIT", "2026-03-02", "2");
    await event(acme, "DIVIDEND", "2026-06-15", "1.5");
    await db.transaction.createMany({
      data: [
        {
          accountId: broker,
          type: "SPLIT",
          date: day("2026-03-02"),
          instrumentId: acme,
          splitRatio: "2",
          currency: "PLN",
        },
        {
          accountId: broker,
          type: "DIVIDEND",
          date: day("2026-06-29"),
          instrumentId: acme,
          amount: "30",
          tax: "5.7",
          currency: "PLN",
        },
      ],
    });

    await expect(summary()).resolves.toEqual([]);
  });

  it("ignores events of an instrument whose prices are entered by hand", async () => {
    await buy(broker, acme, "2026-01-05", "10");
    await event(acme, "DIVIDEND", "2026-06-15", "1.5");
    await db.instrument.update({ where: { id: acme }, data: { priceSource: "MANUAL" } });

    await expect(summary()).resolves.toEqual([]);
  });

  it("does not show another user's portfolio", async () => {
    await buy(broker, acme, "2026-01-05", "10");
    await event(acme, "DIVIDEND", "2026-06-15", "1.5");

    await expect(summary(bartek)).resolves.toBeUndefined();
    await expect(getEventSuggestions(db, ania, UNKNOWN_ID)).resolves.toBeNull();
    await expect(getEventSuggestions(db, ania, "nonsense")).resolves.toBeNull();
  });
});

describe("dismissEvent", () => {
  it("hides the event on that account only, and can be repeated", async () => {
    await buy(broker, acme, "2026-01-05", "10");
    await buy(ike, acme, "2026-01-05", "4");
    const dividend = await event(acme, "DIVIDEND", "2026-06-15", "1.5");

    await expect(dismissEvent(db, ania, broker, dividend)).resolves.toEqual({ ok: true });
    await expect(dismissEvent(db, ania, broker, dividend)).resolves.toEqual({ ok: true });

    await expect(summary()).resolves.toEqual([["IKE", "ACME", "DIVIDEND", "4", "0"]]);
  });

  it("refuses another user's account and unknown ids", async () => {
    await buy(broker, acme, "2026-01-05", "10");
    const dividend = await event(acme, "DIVIDEND", "2026-06-15", "1.5");
    const notFound = { ok: false, reason: "notFound" };

    await expect(dismissEvent(db, bartek, broker, dividend)).resolves.toEqual(notFound);
    await expect(dismissEvent(db, ania, broker, UNKNOWN_ID)).resolves.toEqual(notFound);
    await expect(dismissEvent(db, ania, UNKNOWN_ID, dividend)).resolves.toEqual(notFound);
    await expect(dismissEvent(db, ania, "nonsense", dividend)).resolves.toEqual(notFound);
    await expect(summary()).resolves.toHaveLength(1);
  });
});
