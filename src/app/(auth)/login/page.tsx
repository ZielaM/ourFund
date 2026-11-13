import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SignInForm } from "@/components/auth/sign-in-form";
import { isSetupRequired } from "@/server/auth/accounts";
import { getCurrentUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { signInAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signIn");
  return { title: t("title") };
}

export default async function LoginPage() {
  if (await getCurrentUser()) {
    redirect("/");
  }
  if (await isSetupRequired(getDb())) {
    redirect("/setup");
  }

  const t = await getTranslations("auth.signIn");

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <SignInForm action={signInAction} />
      {getEnv().ALLOW_REGISTRATION ? (
        <p className="text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <Link href="/register" className="text-foreground underline underline-offset-4">
            {t("register")}
          </Link>
        </p>
      ) : null}
    </>
  );
}
