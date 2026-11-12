import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("common");

  return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
}
