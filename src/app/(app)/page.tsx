import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/layout/page-title";
import { requireUser } from "@/server/auth/current-user";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage() {
  await requireUser();
  const t = await getTranslations("dashboard");

  return (
    <>
      <PageTitle>{t("title")}</PageTitle>
      <section className="mt-10 flex max-w-prose flex-col gap-2">
        <h2 className="text-xl font-semibold">{t("empty.title")}</h2>
        <p className="text-muted-foreground">{t("empty.body")}</p>
      </section>
    </>
  );
}
