import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { createTestUser } from "@/test/fixtures";
import { getContributionLimits } from "./contribution-limits";

const db = getDb();
const now = new Date("2026-11-16T12:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

let ania: SessionUser;
let bartek: SessionUser;
let portfolioId: string;

async function account(
  name: string,
  type: "STANDARD" | "IKE" | "IKZE" | "OKI",
  owner = portfolioId,
) {
  return (await db.account.create({ data: { portfolioId: owner, name, type } })).id;
}

async function cash(
  accountId: string,
  type: "DEPOSIT" | "WITHDRAWAL",
  date: string,
  amount: string,
  currency = "PLN",
) {
  await db.transaction.create({ data: { accountId, type, date: day(date), amount, currency } });
}

const summary = async (actor: SessionUser = ania) =>
  (await getContributionLimits(db, actor, now)).map((view) => [
    view.type,
    view.usage.contributed.toFixed(2),
    view.usage.remaining.toFixed(2),
    view.noDeposits,
  ]);

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  bartek = await createTestUser(db, "bartek");
  portfolioId = (await db.portfolio.create({ data: { userId: ania.id, name: "Emerytura" } })).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe("getContributionLimits", () => {
  it("is empty for a user without IKE or IKZE accounts", async () => {
    await account("Makler", "STANDARD");
    await account("OKI", "OKI");

    await expect(summary()).resolves.toEqual([]);
  });

  it("adds up this year's deposits per kind of account; withdrawals give nothing back", async () => {
    const ike = await account("IKE", "IKE");
    const ikze = await account("IKZE", "IKZE");
    await cash(ike, "DEPOSIT", "2025-12-30", "9000");
    await cash(ike, "DEPOSIT", "2026-01-05", "10000");
    await cash(ike, "DEPOSIT", "2026-06-05", "2500.50");
    await cash(ike, "WITHDRAWAL", "2026-07-01", "3000");
    await cash(ikze, "DEPOSIT", "2026-02-01", "11304");

    await expect(summary()).resolves.toEqual([
      ["IKE", "12500.50", "15759.50", false],
      ["IKZE", "11304.00", "0.00", false],
    ]);
  });

  it("carries the limits of the year, the higher IKZE limit and next year's limit", async () => {
    await account("IKE", "IKE");
    await account("IKZE", "IKZE");

    const [ike, ikze] = await getContributionLimits(db, ania, now);

    expect(ike).toMatchObject({
      type: "IKE",
      year: 2026,
      selfEmployedLimit: null,
      noDeposits: true,
    });
    expect(ike.limit.toFixed()).toBe("28260");
    expect(ike.next?.limit.toFixed()).toBe("30099");
    expect(ikze.selfEmployedLimit?.toFixed()).toBe("16956");
  });

  it("shares one limit between accounts of the same kind, across portfolios", async () => {
    const other = (await db.portfolio.create({ data: { userId: ania.id, name: "Stary" } })).id;
    const before = await account("IKE u starego brokera", "IKE", other);
    const after = await account("IKE", "IKE");
    await cash(before, "DEPOSIT", "2026-01-05", "4000");
    await cash(after, "DEPOSIT", "2026-09-05", "6000");

    const [ike] = await getContributionLimits(db, ania, now);

    expect(ike.usage.contributed.toFixed()).toBe("10000");
    expect(ike.accounts.map((a) => `${a.name} / ${a.portfolioName}`).sort()).toEqual([
      "IKE / Emerytura",
      "IKE u starego brokera / Stary",
    ]);
  });

  it("flags deposits in another currency and an exceeded limit", async () => {
    const ike = await account("IKE", "IKE");
    await cash(ike, "DEPOSIT", "2026-01-05", "29000");
    await cash(ike, "DEPOSIT", "2026-02-05", "100", "EUR");

    const [view] = await getContributionLimits(db, ania, now);

    expect(view.usage).toMatchObject({ exceeded: true, incomplete: true });
    expect(view.usage.remaining.toFixed()).toBe("0");
  });

  it("counts only the actor's own accounts", async () => {
    const ike = await account("IKE", "IKE");
    await cash(ike, "DEPOSIT", "2026-01-05", "10000");

    await expect(summary(bartek)).resolves.toEqual([]);
  });

  it("returns nothing in a year whose limit is not known", async () => {
    await account("IKE", "IKE");

    await expect(
      getContributionLimits(db, ania, new Date("2040-01-10T12:00:00Z")),
    ).resolves.toEqual([]);
  });
});
