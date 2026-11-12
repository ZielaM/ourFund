import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { defaultLocale } from "@/i18n/config";
import messages from "@/i18n/messages/pl.json";

/** Renders a component with the same translations the app uses. */
export function renderWithIntl(ui: ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={messages} timeZone="Europe/Warsaw">
      {ui}
    </NextIntlClientProvider>,
  );
}
