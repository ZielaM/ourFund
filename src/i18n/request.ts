import { getRequestConfig } from "next-intl/server";
import { defaultLocale } from "./config";

// Single-locale setup without locale-prefixed routes. Adding a language later means
// adding a messages file and resolving the locale here (e.g. from a cookie).
export default getRequestConfig(async () => {
  const locale = defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
