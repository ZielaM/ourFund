import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/submit-button";
import { PageTitle } from "@/components/layout/page-title";
import {
  TransactionFields,
  type TransactionFormValues,
} from "@/components/portfolio/transaction-fields";
import { CURRENCIES } from "@/domain/portfolio/currencies";
import { TREASURY_MARKET } from "@/domain/portfolio/markets";
import { isTradable } from "@/domain/portfolio/naming";
import { TRANSACTION_TYPES } from "@/domain/portfolio/transaction-input";
import { todayInWarsaw } from "@/domain/portfolio/dates";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listInstruments } from "@/server/portfolio/instruments";
import { getPortfolio } from "@/server/portfolio/portfolios";
import { saveTransactionAction } from "../../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("transaction");
  return { title: t("newTitle") };
}

/** Fields a link may fill in, e.g. from a suggested dividend. The form still validates them. */
const PREFILLABLE = ["instrumentId", "amount", "tax", "currency", "splitRatio"] as const;

function prefilled(
  query: Record<string, string | string[] | undefined>,
  accountIds: string[],
): TransactionFormValues {
  const text = (name: string) => {
    const value = query[name];
    return typeof value === "string" && value.length <= 60 ? value : undefined;
  };

  const values: TransactionFormValues = {};
  const type = text("type");
  if (type && (TRANSACTION_TYPES as readonly string[]).includes(type)) {
    values.type = type;
  }
  const accountId = text("accountId");
  if (accountId && accountIds.includes(accountId)) {
    values.accountId = accountId;
  }
  const date = text("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    values.date = date;
  }
  for (const name of PREFILLABLE) {
    const value = text(name);
    if (value) {
      values[name] = value;
    }
  }
  return values;
}

export default async function NewTransactionPage({
  params,
  searchParams,
}: PageProps<"/portfolios/[id]/transactions/new">) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const db = getDb();
  const portfolio = await getPortfolio(db, user, id);

  if (!portfolio) {
    notFound();
  }
  if (portfolio.accounts.length === 0) {
    redirect(`/portfolios/${portfolio.id}/settings`);
  }

  const instruments = (await listInstruments(db))
    .filter(({ type }) => isTradable(type))
    .map((instrument) => ({
      ...instrument,
      treasuryBond: instrument.market === TREASURY_MARKET,
    }));
  const initial: TransactionFormValues = {
    type: "BUY",
    accountId: portfolio.accounts[0].id,
    date: todayInWarsaw(new Date()),
    ...prefilled(
      query,
      portfolio.accounts.map((account) => account.id),
    ),
  };

  const t = await getTranslations("transaction");
  const portfolioHref = `/portfolios/${portfolio.id}`;

  return (
    <>
      <Link
        href={portfolioHref}
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        {portfolio.name}
      </Link>
      <div className="mt-4">
        <PageTitle>{t("newTitle")}</PageTitle>
      </div>

      <div className="mt-10 max-w-sm">
        {/* The key starts the form afresh when a link opens it with other values filled in. */}
        <ActionForm
          key={JSON.stringify(initial)}
          action={saveTransactionAction.bind(null, portfolio.id, null)}
        >
          <TransactionFields
            accounts={portfolio.accounts.map(({ id, name }) => ({ id, name }))}
            instruments={instruments}
            currencies={CURRENCIES}
            initial={initial}
          />
          <div className="flex items-center gap-5">
            <SubmitButton>{t("add")}</SubmitButton>
            <Link href={portfolioHref} className="text-sm underline underline-offset-4">
              {t("cancel")}
            </Link>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
