import { useTranslations } from "next-intl";
import { LedgerRule } from "@/components/brand/ledger-rule";
import { Wordmark } from "@/components/brand/wordmark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  const t = useTranslations("auth");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12 sm:py-20">
      <header className="flex max-w-sm flex-col gap-3">
        <Wordmark className="text-4xl" />
        <LedgerRule />
        <p className="text-sm text-muted-foreground">{t("tagline")}</p>
      </header>
      <main className="mt-12 flex w-full max-w-sm flex-col gap-6">{children}</main>
    </div>
  );
}
