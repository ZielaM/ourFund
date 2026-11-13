import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { createTestUser, UNKNOWN_ID } from "@/test/fixtures";
import {
  createAccount,
  createPortfolio,
  deleteAccount,
  deletePortfolio,
  findOwnAccount,
  getPortfolio,
  listPortfolios,
  renamePortfolio,
  updateAccount,
} from "./portfolios";

const db = getDb();
let ania: SessionUser;
let jan: SessionUser;

async function portfolioOf(owner: SessionUser, name = "Główny"): Promise<string> {
  const result = await createPortfolio(db, owner, { name });
  if (!result.ok) throw new Error("could not create the test portfolio");
  return result.id;
}

async function accountIn(owner: SessionUser, portfolioId: string, name = "XTB"): Promise<string> {
  const result = await createAccount(db, owner, portfolioId, {
    name,
    type: "STANDARD",
    institution: null,
  });
  if (!result.ok) throw new Error("could not create the test account");
  return result.id;
}

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  jan = await createTestUser(db, "jan");
});

afterAll(async () => {
  await disconnectDb();
});

describe("portfolios", () => {
  it("starts with none", async () => {
    await expect(listPortfolios(db, ania)).resolves.toEqual([]);
  });

  it("creates and lists a user's portfolios, oldest first, with counts", async () => {
    const first = await portfolioOf(ania, "Główny");
    await portfolioOf(ania, "Emerytura");
    await accountIn(ania, first, "XTB");
    await accountIn(ania, first, "mBank");

    await expect(listPortfolios(db, ania)).resolves.toEqual([
      { id: first, name: "Główny", accountCount: 2, transactionCount: 0 },
      { id: expect.any(String), name: "Emerytura", accountCount: 0, transactionCount: 0 },
    ]);
  });

  it("does not allow two portfolios with the same name for one user", async () => {
    await portfolioOf(ania, "Główny");

    await expect(createPortfolio(db, ania, { name: "Główny" })).resolves.toEqual({
      ok: false,
      reason: "nameTaken",
    });
  });

  it("lets different users use the same name", async () => {
    await portfolioOf(ania, "Główny");

    await expect(createPortfolio(db, jan, { name: "Główny" })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("renames a portfolio", async () => {
    const id = await portfolioOf(ania, "Główny");

    await expect(renamePortfolio(db, ania, id, { name: "Długoterminowy" })).resolves.toEqual({
      ok: true,
      id,
    });
    await expect(getPortfolio(db, ania, id)).resolves.toMatchObject({ name: "Długoterminowy" });
  });

  it("refuses to rename to a name that is already used", async () => {
    await portfolioOf(ania, "Główny");
    const second = await portfolioOf(ania, "Emerytura");

    await expect(renamePortfolio(db, ania, second, { name: "Główny" })).resolves.toEqual({
      ok: false,
      reason: "nameTaken",
    });
  });

  it("deletes a portfolio with its accounts", async () => {
    const id = await portfolioOf(ania);
    await accountIn(ania, id);

    await expect(deletePortfolio(db, ania, id)).resolves.toEqual({ ok: true });
    await expect(getPortfolio(db, ania, id)).resolves.toBeNull();
    await expect(db.account.count()).resolves.toBe(0);
  });

  it.each([UNKNOWN_ID, "not-an-id"])("reports a portfolio that does not exist (%s)", async (id) => {
    await expect(getPortfolio(db, ania, id)).resolves.toBeNull();
    await expect(renamePortfolio(db, ania, id, { name: "X" })).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
    await expect(deletePortfolio(db, ania, id)).resolves.toEqual({ ok: false, reason: "notFound" });
  });
});

describe("accounts", () => {
  it("creates accounts of every type and lists them with the portfolio", async () => {
    const portfolioId = await portfolioOf(ania);
    await createAccount(db, ania, portfolioId, {
      name: "XTB",
      type: "STANDARD",
      institution: "XTB",
    });
    await createAccount(db, ania, portfolioId, { name: "IKE", type: "IKE", institution: null });
    await createAccount(db, ania, portfolioId, { name: "IKZE", type: "IKZE", institution: null });
    await createAccount(db, ania, portfolioId, { name: "OKI", type: "OKI", institution: null });

    const portfolio = await getPortfolio(db, ania, portfolioId);

    expect(portfolio?.accounts.map((account) => [account.name, account.type])).toEqual([
      ["XTB", "STANDARD"],
      ["IKE", "IKE"],
      ["IKZE", "IKZE"],
      ["OKI", "OKI"],
    ]);
    expect(portfolio?.accounts[0]).toMatchObject({ institution: "XTB", transactionCount: 0 });
  });

  it("does not allow two accounts with the same name in one portfolio", async () => {
    const portfolioId = await portfolioOf(ania);
    await accountIn(ania, portfolioId, "XTB");

    await expect(
      createAccount(db, ania, portfolioId, { name: "XTB", type: "IKE", institution: null }),
    ).resolves.toEqual({ ok: false, reason: "nameTaken" });
  });

  it("updates an account", async () => {
    const portfolioId = await portfolioOf(ania);
    const accountId = await accountIn(ania, portfolioId, "XTB");

    await expect(
      updateAccount(db, ania, accountId, { name: "XTB IKE", type: "IKE", institution: "XTB" }),
    ).resolves.toEqual({ ok: true, id: accountId });

    const portfolio = await getPortfolio(db, ania, portfolioId);
    expect(portfolio?.accounts[0]).toMatchObject({
      name: "XTB IKE",
      type: "IKE",
      institution: "XTB",
    });
  });

  it("refuses to rename an account to a name used in the same portfolio", async () => {
    const portfolioId = await portfolioOf(ania);
    await accountIn(ania, portfolioId, "XTB");
    const second = await accountIn(ania, portfolioId, "mBank");

    await expect(
      updateAccount(db, ania, second, { name: "XTB", type: "STANDARD", institution: null }),
    ).resolves.toEqual({ ok: false, reason: "nameTaken" });
  });

  it("deletes an empty account", async () => {
    const accountId = await accountIn(ania, await portfolioOf(ania));

    await expect(deleteAccount(db, ania, accountId)).resolves.toEqual({ ok: true });
    await expect(findOwnAccount(db, ania, accountId)).resolves.toBeNull();
  });

  it("refuses to delete an account that has transactions", async () => {
    const accountId = await accountIn(ania, await portfolioOf(ania));
    await db.transaction.create({
      data: {
        accountId,
        type: "DEPOSIT",
        date: new Date("2026-01-05"),
        amount: "100",
        currency: "PLN",
      },
    });

    await expect(deleteAccount(db, ania, accountId)).resolves.toEqual({
      ok: false,
      reason: "hasTransactions",
    });
    await expect(findOwnAccount(db, ania, accountId)).resolves.not.toBeNull();
  });

  it.each([UNKNOWN_ID, "not-an-id"])("reports an account that does not exist (%s)", async (id) => {
    const input = { name: "X", type: "STANDARD" as const, institution: null };

    await expect(createAccount(db, ania, id, input)).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
    await expect(updateAccount(db, ania, id, input)).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
    await expect(deleteAccount(db, ania, id)).resolves.toEqual({ ok: false, reason: "notFound" });
  });
});

describe("isolation between users", () => {
  it("hides one user's portfolios and accounts from another", async () => {
    const portfolioId = await portfolioOf(ania);
    const accountId = await accountIn(ania, portfolioId);

    await expect(listPortfolios(db, jan)).resolves.toEqual([]);
    await expect(getPortfolio(db, jan, portfolioId)).resolves.toBeNull();
    await expect(findOwnAccount(db, jan, accountId)).resolves.toBeNull();
  });

  it("does not let one user change or delete another's data", async () => {
    const portfolioId = await portfolioOf(ania);
    const accountId = await accountIn(ania, portfolioId);
    const input = { name: "Przejęte", type: "STANDARD" as const, institution: null };
    const notFound = { ok: false, reason: "notFound" };

    await expect(renamePortfolio(db, jan, portfolioId, { name: "Przejęty" })).resolves.toEqual(
      notFound,
    );
    await expect(deletePortfolio(db, jan, portfolioId)).resolves.toEqual(notFound);
    await expect(createAccount(db, jan, portfolioId, input)).resolves.toEqual(notFound);
    await expect(updateAccount(db, jan, accountId, input)).resolves.toEqual(notFound);
    await expect(deleteAccount(db, jan, accountId)).resolves.toEqual(notFound);

    await expect(getPortfolio(db, ania, portfolioId)).resolves.toMatchObject({
      name: "Główny",
      accounts: [{ id: accountId, name: "XTB" }],
    });
  });

  it("removes a user's portfolios together with the user", async () => {
    const portfolioId = await portfolioOf(ania);
    await accountIn(ania, portfolioId);

    await db.user.delete({ where: { id: ania.id } });

    await expect(db.portfolio.count()).resolves.toBe(0);
    await expect(db.account.count()).resolves.toBe(0);
  });
});
