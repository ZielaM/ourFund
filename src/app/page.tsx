import { useTranslations } from "next-intl";
import { APP_NAME, REPOSITORY_URL } from "@/config/app";

const FEATURES = ["markets", "bonds", "accounts", "taxes"] as const;

export default function HomePage() {
  const t = useTranslations("home");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className="w-fit rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          {t("status")}
        </p>
        <h1 className="text-5xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="text-lg text-balance text-muted-foreground">{t("tagline")}</p>
      </header>

      <section aria-labelledby="features-title" className="flex flex-col gap-3">
        <h2 id="features-title" className="text-sm font-medium">
          {t("features.title")}
        </h2>
        <ul className="divide-y rounded-lg border">
          {FEATURES.map((feature) => (
            <li key={feature} className="px-4 py-3 text-sm">
              {t(`features.${feature}`)}
            </li>
          ))}
        </ul>
      </section>

      <footer className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>{t("selfHosted")}</p>
        <a
          href={REPOSITORY_URL}
          className="w-fit text-foreground underline underline-offset-4"
          rel="noreferrer"
        >
          {t("sourceCode")}
        </a>
      </footer>
    </main>
  );
}
