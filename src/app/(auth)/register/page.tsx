import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NewAccountForm } from "@/components/auth/new-account-form";
import { isSetupRequired } from "@/server/auth/accounts";
import { getCurrentUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { registerAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register");
  return { title: t("title") };
}

export default async function RegisterPage() {
  if (await getCurrentUser()) {
    redirect("/");
  }
  if (!getEnv().ALLOW_REGISTRATION) {
    notFound();
  }
  if (await isSetupRequired(getDb())) {
    redirect("/setup");
  }

  const t = await getTranslations("auth.register");

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <NewAccountForm action={registerAction} submitLabel={t("submit")} />
      <p className="text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link href="/login" className="text-foreground underline underline-offset-4">
          {t("signIn")}
        </Link>
      </p>
    </>
  );
}
