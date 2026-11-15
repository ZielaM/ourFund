import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ImportForm } from "@/components/import/import-form";
import { PageTitle } from "@/components/layout/page-title";
import { CURRENCIES } from "@/domain/portfolio/currencies";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getPortfolio } from "@/server/portfolio/portfolios";
import { commitImportAction, previewImportAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import");
  return { title: t("title") };
}

export default async function ImportPage({ params }: PageProps<"/portfolios/[id]/import">) {
  const user = await requireUser();
  const { id } = await params;
  const portfolio = await getPortfolio(getDb(), user, id);

  if (!portfolio) {
    notFound();
  }
  if (portfolio.accounts.length === 0) {
    redirect(`/portfolios/${portfolio.id}/settings`);
  }

  const t = await getTranslations("import");
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
        <PageTitle>{t("title")}</PageTitle>
      </div>

      <div className="mt-8 flex max-w-prose flex-col gap-2 text-sm text-muted-foreground">
        <p>{t("intro")}</p>
        <p>{t("howTo")}</p>
        <p>{t("accountsNote")}</p>
      </div>

      <div className="mt-10">
        <ImportForm
          accounts={portfolio.accounts.map(({ id: accountId, name }) => ({ id: accountId, name }))}
          currencies={CURRENCIES}
          portfolioHref={portfolioHref}
          preview={previewImportAction.bind(null, portfolio.id)}
          commit={commitImportAction.bind(null, portfolio.id)}
        />
      </div>
    </>
  );
}
