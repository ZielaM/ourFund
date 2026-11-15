import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { ThemeSync } from "@/components/theme/theme-sync";
import { APP_NAME } from "@/config/app";
import { THEME_SCRIPT } from "@/lib/theme";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/brygada-1918";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return {
    title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
    description: t("description"),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    // The inline script changes `data-theme` before React hydrates, hence the suppression.
    <html lang={locale} data-theme="light" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeSync />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
