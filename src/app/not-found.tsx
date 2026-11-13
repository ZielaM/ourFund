import Link from "next/link";
import { useTranslations } from "next-intl";
import { LedgerRule } from "@/components/brand/ledger-rule";
import { Wordmark } from "@/components/brand/wordmark";

export default function NotFound() {
  const t = useTranslations("notFound");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12 sm:py-20">
      <div className="flex max-w-sm flex-col gap-3">
        <Wordmark className="text-4xl" />
        <LedgerRule />
      </div>
      <div className="mt-12 flex max-w-prose flex-col gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("body")}</p>
        <Link href="/" className="w-fit underline underline-offset-4">
          {t("back")}
        </Link>
      </div>
    </main>
  );
}
