import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { downloadHeaders, exportFileName } from "@/server/export/download";
import { exportData } from "@/server/export/export";

/** Everything the signed-in user entered, as one JSON document. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response(null, { status: 401 });
  }

  const t = await getTranslations("export");
  const document = await exportData(getDb(), user);

  return new Response(`${JSON.stringify(document, null, 2)}\n`, {
    headers: downloadHeaders(
      exportFileName(t("dataFileName"), "json"),
      "application/json; charset=utf-8",
    ),
  });
}
