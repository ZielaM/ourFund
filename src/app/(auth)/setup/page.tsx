import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { NewAccountForm } from "@/components/auth/new-account-form";
import { isSetupRequired } from "@/server/auth/accounts";
import { getDb } from "@/server/db/client";
import { setupAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.setup");
  return { title: t("title") };
}

export default async function SetupPage() {
  await connection();

  if (!(await isSetupRequired(getDb()))) {
    redirect("/login");
  }

  const t = await getTranslations("auth.setup");

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <NewAccountForm action={setupAction} submitLabel={t("submit")} />
    </>
  );
}
