import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/form/action-form";
import { TextField } from "@/components/form/fields";
import { SubmitButton } from "@/components/form/submit-button";
import { PageTitle } from "@/components/layout/page-title";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listPortfolios } from "@/server/portfolio/portfolios";
import { createPortfolioAction } from "./portfolios/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const portfolios = await listPortfolios(getDb(), user);
  const t = await getTranslations("dashboard");

  return (
    <>
      <PageTitle>{t("title")}</PageTitle>

      <section aria-labelledby="portfolios-title" className="mt-10 flex flex-col gap-4">
        {portfolios.length === 0 ? (
          <div className="flex max-w-prose flex-col gap-2">
            <h2 id="portfolios-title" className="text-xl font-semibold">
              {t("empty.title")}
            </h2>
            <p className="text-muted-foreground">{t("empty.body")}</p>
          </div>
        ) : (
          <>
            <h2 id="portfolios-title" className="text-xl font-semibold">
              {t("portfolios.title")}
            </h2>
            <ul className="divide-y rounded-lg border bg-card">
              {portfolios.map((portfolio) => (
                <li key={portfolio.id}>
                  <Link
                    href={`/portfolios/${portfolio.id}`}
                    aria-label={t("portfolios.open", { name: portfolio.name })}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-4 transition-colors hover:bg-accent/50"
                  >
                    <span className="font-display text-lg font-semibold">{portfolio.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {t("portfolios.accounts", { count: portfolio.accountCount })},{" "}
                      {t("portfolios.transactions", { count: portfolio.transactionCount })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="create-title" className="mt-12 flex max-w-sm flex-col gap-5">
        <h2 id="create-title" className="text-xl font-semibold">
          {t("create.title")}
        </h2>
        <ActionForm action={createPortfolioAction}>
          <TextField name="name" label={t("create.name")} hint={t("create.nameHint")} required />
          <SubmitButton className="self-start">{t("create.submit")}</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
