import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, TextField } from "@/components/form/fields";
import { SubmitButton } from "@/components/form/submit-button";
import { PageTitle } from "@/components/layout/page-title";
import { AccountFields } from "@/components/portfolio/account-fields";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getPortfolio } from "@/server/portfolio/portfolios";
import {
  createAccountAction,
  deleteAccountAction,
  deletePortfolioAction,
  renamePortfolioAction,
  updateAccountAction,
} from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portfolio");
  return { title: t("settings") };
}

export default async function PortfolioSettingsPage({
  params,
}: PageProps<"/portfolios/[id]/settings">) {
  const user = await requireUser();
  const { id } = await params;
  const portfolio = await getPortfolio(getDb(), user, id);

  if (!portfolio) {
    notFound();
  }

  const t = await getTranslations("portfolio");
  const tTypes = await getTranslations("accountTypes");

  return (
    <>
      <Link
        href={`/portfolios/${portfolio.id}`}
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        {t("back")}
      </Link>
      <div className="mt-4">
        <PageTitle>{t("settings")}</PageTitle>
      </div>

      <section aria-labelledby="accounts-title" className="mt-10 flex flex-col gap-5">
        <h2 id="accounts-title" className="text-xl font-semibold">
          {t("accounts.title")}
        </h2>
        {portfolio.accounts.length === 0 ? (
          <p className="text-muted-foreground">{t("accounts.empty")}</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {portfolio.accounts.map((account) => (
              <li key={account.id}>
                <details className="group">
                  <summary
                    aria-label={t("accounts.edit", { name: account.name })}
                    className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3 transition-colors hover:bg-accent/50"
                  >
                    <span>
                      <span className="font-medium">{account.name}</span>{" "}
                      <span className="text-sm text-muted-foreground">
                        {tTypes(account.type)}
                        {account.institution ? `, ${account.institution}` : ""}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t("accounts.transactionCount", { count: account.transactionCount })}
                    </span>
                  </summary>
                  <div className="flex max-w-sm flex-col gap-6 px-4 pt-2 pb-5">
                    <ActionForm action={updateAccountAction.bind(null, portfolio.id, account.id)}>
                      <AccountFields initial={account} />
                      <SubmitButton className="self-start">{t("accounts.save")}</SubmitButton>
                    </ActionForm>
                    <ActionForm
                      action={deleteAccountAction.bind(null, portfolio.id, account.id)}
                      className="gap-2"
                    >
                      <SubmitButton variant="outline" className="self-start">
                        {t("accounts.delete")}
                      </SubmitButton>
                      <p className="text-sm text-muted-foreground">{t("accounts.deleteHint")}</p>
                    </ActionForm>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex max-w-sm flex-col gap-5">
          <h3 className="font-display text-lg font-semibold">{t("accounts.addTitle")}</h3>
          <ActionForm action={createAccountAction.bind(null, portfolio.id)}>
            <AccountFields />
            <SubmitButton className="self-start">{t("accounts.add")}</SubmitButton>
          </ActionForm>
        </div>
      </section>

      <section aria-labelledby="rename-title" className="mt-12 flex max-w-sm flex-col gap-5">
        <h2 id="rename-title" className="text-xl font-semibold">
          {t("rename.title")}
        </h2>
        <ActionForm action={renamePortfolioAction.bind(null, portfolio.id)}>
          <TextField
            name="name"
            label={t("rename.name")}
            defaultValue={portfolio.name}
            autoComplete="off"
            required
          />
          <SubmitButton className="self-start">{t("rename.submit")}</SubmitButton>
        </ActionForm>
      </section>

      <section aria-labelledby="delete-title" className="mt-12 flex max-w-prose flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="delete-title" className="text-xl font-semibold">
            {t("delete.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("delete.body")}</p>
        </div>
        <ActionForm action={deletePortfolioAction.bind(null, portfolio.id)}>
          <CheckboxField name="confirm" label={t("delete.confirm", { name: portfolio.name })} />
          <SubmitButton variant="destructive" className="self-start">
            {t("delete.submit")}
          </SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
