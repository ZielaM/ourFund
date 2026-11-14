import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { downloadHeaders, exportFileName } from "@/server/export/download";
import { exportTransactionsCsv } from "@/server/export/export";

const TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "DEPOSIT",
  "WITHDRAWAL",
  "SPLIT",
] as const;

/** The signed-in user's transactions as a CSV file. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response(null, { status: 401 });
  }

  const [t, tTypes] = await Promise.all([
    getTranslations("export.columns"),
    getTranslations("transactionTypes"),
  ]);
  const csv = await exportTransactionsCsv(getDb(), user, {
    columns: {
      date: t("date"),
      portfolio: t("portfolio"),
      account: t("account"),
      type: t("type"),
      symbol: t("symbol"),
      market: t("market"),
      name: t("name"),
      quantity: t("quantity"),
      price: t("price"),
      currency: t("currency"),
      fxRate: t("fxRate"),
      amount: t("amount"),
      fee: t("fee"),
      tax: t("tax"),
      splitRatio: t("splitRatio"),
      note: t("note"),
    },
    types: Object.fromEntries(TYPES.map((type) => [type, tTypes(type)])),
  });

  return new Response(csv, {
    headers: downloadHeaders(exportFileName(t("fileName"), "csv"), "text/csv; charset=utf-8"),
  });
}
