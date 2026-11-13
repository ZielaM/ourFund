import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/submit-button";
import { PageTitle } from "@/components/layout/page-title";
import { TransactionFields } from "@/components/portfolio/transaction-fields";
import { CURRENCIES } from "@/domain/portfolio/currencies";
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

export default async function NewTransactionPage({
  params,
}: PageProps<"/portfolios/[id]/transactions/new">) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const portfolio = await getPortfolio(db, user, id);

  if (!portfolio) {
    notFound();
  }
  if (portfolio.accounts.length === 0) {
    redirect(`/portfolios/${portfolio.id}/settings`);
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
        <PageTitle>{t("newTitle")}</PageTitle>
      </div>

      <div className="mt-10 max-w-sm">
        <ActionForm action={saveTransactionAction.bind(null, portfolio.id, null)}>
          <TransactionFields
            accounts={portfolio.accounts.map(({ id, name }) => ({ id, name }))}
            instruments={instruments}
            currencies={CURRENCIES}
            initial={{
              type: "BUY",
              accountId: portfolio.accounts[0].id,
              date: todayInWarsaw(new Date()),
            }}
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
