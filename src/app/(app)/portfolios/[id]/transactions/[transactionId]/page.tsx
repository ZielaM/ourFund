import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/submit-button";
import { PageTitle } from "@/components/layout/page-title";
import {
  TransactionFields,
  type TransactionFormValues,
} from "@/components/portfolio/transaction-fields";
import { CURRENCIES } from "@/domain/portfolio/currencies";
import { toInputValue } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listInstruments } from "@/server/portfolio/instruments";
import { getPortfolio } from "@/server/portfolio/portfolios";
import { getTransaction, type TransactionView } from "@/server/portfolio/transactions";
import { deleteTransactionAction, saveTransactionAction } from "../../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("transaction");
  return { title: t("editTitle") };
}

/** Turns a stored transaction back into the text the form fields hold. */
function toFormValues(transaction: TransactionView): TransactionFormValues {
  const optional = (value: TransactionView["quantity"]) =>
    value ? toInputValue(value) : undefined;
  const unlessZero = (value: TransactionView["fee"]) =>
    value.isZero() ? undefined : toInputValue(value);

  return {
    type: transaction.type,
    accountId: transaction.accountId,
    date: transaction.date,
    instrumentId: transaction.instrument?.id,
    quantity: optional(transaction.quantity),
    price: optional(transaction.price),
    fee: unlessZero(transaction.fee),
    currency: transaction.currency,
    fxRate: transaction.fxRate.eq(1) ? undefined : toInputValue(transaction.fxRate),
    amount: optional(transaction.amount),
    tax: unlessZero(transaction.tax),
    splitRatio: optional(transaction.splitRatio),
    note: transaction.note ?? undefined,
  };
}

export default async function EditTransactionPage({
  params,
}: PageProps<"/portfolios/[id]/transactions/[transactionId]">) {
  const user = await requireUser();
  const { id, transactionId } = await params;
  const db = getDb();
  const [portfolio, transaction] = await Promise.all([
    getPortfolio(db, user, id),
    getTransaction(db, user, transactionId),
  ]);

  if (!portfolio || !transaction || transaction.portfolioId !== portfolio.id) {
    notFound();
  }

  const instruments = await listInstruments(db);
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
        <PageTitle>{t("editTitle")}</PageTitle>
      </div>

      <div className="mt-10 max-w-sm">
        <ActionForm action={saveTransactionAction.bind(null, portfolio.id, transaction.id)}>
          <TransactionFields
            accounts={portfolio.accounts.map(({ id, name }) => ({ id, name }))}
            instruments={instruments}
            currencies={CURRENCIES}
            initial={toFormValues(transaction)}
            lockAccount
          />
          <div className="flex items-center gap-5">
            <SubmitButton>{t("save")}</SubmitButton>
            <Link href={portfolioHref} className="text-sm underline underline-offset-4">
              {t("cancel")}
            </Link>
          </div>
        </ActionForm>
      </div>

      <section aria-labelledby="delete-title" className="mt-14 flex max-w-prose flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="delete-title" className="text-xl font-semibold">
            {t("delete.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("delete.body")}</p>
        </div>
        <ActionForm action={deleteTransactionAction.bind(null, portfolio.id, transaction.id)}>
          <SubmitButton variant="destructive" className="self-start">
            {t("delete.submit")}
          </SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
