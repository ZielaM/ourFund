import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PasswordForm } from "@/components/auth/password-form";
import { PageTitle } from "@/components/layout/page-title";
import { requireUser } from "@/server/auth/current-user";
import { changePasswordAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const user = await requireUser();
  const t = await getTranslations("settings");
  const tRoles = await getTranslations("roles");

  return (
    <>
      <PageTitle>{t("title")}</PageTitle>

      <section aria-labelledby="account-title" className="mt-10 flex flex-col gap-4">
        <h2 id="account-title" className="text-xl font-semibold">
          {t("account.title")}
        </h2>
        <dl className="grid max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("account.username")}</dt>
          <dd className="font-medium">{user.username}</dd>
          <dt className="text-muted-foreground">{t("account.role")}</dt>
          <dd className="font-medium">{tRoles(user.role)}</dd>
        </dl>
      </section>

      <section aria-labelledby="password-title" className="mt-12 flex max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="password-title" className="text-xl font-semibold">
            {t("password.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("password.intro")}</p>
        </div>
        <PasswordForm
          action={changePasswordAction}
          submitLabel={t("password.submit")}
          askForCurrentPassword
        />
      </section>
    </>
  );
}
