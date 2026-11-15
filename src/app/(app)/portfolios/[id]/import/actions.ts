"use server";

import { MAX_IMPORT_FILE_BYTES, readXtbFile } from "@/domain/import/read";
import type { ImportedReport } from "@/domain/import/types";
import { isCurrency } from "@/domain/portfolio/currencies";
import { formatDate, formatMoney, formatPrice, formatQuantity } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { planImport, runImport, type ImportPlan } from "@/server/importers/import";
import { getPortfolio } from "@/server/portfolio/portfolios";

/** What an import would do, with every figure already formatted for display. */
export type ImportPreview = {
  accountNumber: string;
  currency: string;
  duplicates: number;
  rows: {
    date: string;
    type: ImportPlan["rows"][number]["type"];
    symbol: string | null;
    quantity: string | null;
    price: string | null;
    cash: string;
    outflow: boolean;
  }[];
  newInstruments: { symbol: string; market: string; name: string }[];
  skipped: { row: number; label: string; reason: string; amount: string | null }[];
  conflicts: string[];
  mismatches: { symbol: string; inFile: string; fromOperations: string }[];
  problem: { symbol: string; date: string } | null;
};

export type ImportActionResult =
  | { status: "error"; code: string; params?: Record<string, string> }
  | { status: "preview"; preview: ImportPreview }
  | { status: "done"; imported: number; duplicates: number; instrumentsCreated: number };

const failed = (code: string, params?: Record<string, string>): ImportActionResult => ({
  status: "error",
  code,
  params,
});

type Upload =
  | { ok: true; accountId: string; report: ImportedReport }
  | { ok: false; result: ImportActionResult };

/** Reads the form shared by both steps: the account, the file and the optional currency. */
async function readUpload(portfolioId: string, formData: FormData): Promise<Upload> {
  const user = await requireUser();
  const portfolio = await getPortfolio(getDb(), user, portfolioId);
  const accountId = String(formData.get("accountId") ?? "");

  if (!portfolio?.accounts.some((account) => account.id === accountId)) {
    return { ok: false, result: failed("accountNotFound") };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, result: failed("fileRequired") };
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, result: failed("tooLarge") };
  }

  const currency = String(formData.get("currency") ?? "");
  const read = readXtbFile(new Uint8Array(await file.arrayBuffer()), {
    fileName: file.name,
    currency: isCurrency(currency) ? currency : undefined,
  });

  return read.ok
    ? { ok: true, accountId, report: read.report }
    : { ok: false, result: failed(`${read.reason}`) };
}

function toPreview(plan: ImportPlan): ImportPreview {
  return {
    accountNumber: plan.accountNumber,
    currency: plan.currency,
    duplicates: plan.duplicates,
    rows: plan.rows.map((row) => ({
      date: formatDate(row.date),
      type: row.type,
      symbol: row.symbol,
      quantity: row.quantity ? formatQuantity(row.quantity) : null,
      price: row.price ? formatPrice(row.price) : null,
      cash: formatMoney(row.cash, row.currency),
      outflow: row.cash.isNegative(),
    })),
    newInstruments: plan.newInstruments.map(({ symbol, market, name }) => ({
      symbol,
      market,
      name,
    })),
    skipped: plan.skipped.map((row) => ({
      row: row.row,
      label: row.label,
      reason: row.reason,
      amount: row.amount ? formatMoney(row.amount, plan.currency) : null,
    })),
    conflicts: plan.conflicts,
    mismatches: plan.holdingMismatches.map((entry) => ({
      symbol: entry.symbol,
      inFile: formatQuantity(entry.inFile),
      fromOperations: formatQuantity(entry.fromOperations),
    })),
    problem: plan.problem
      ? { symbol: plan.problem.symbol, date: formatDate(plan.problem.date) }
      : null,
  };
}

/** First step: reads the file and shows what importing it would add. Writes nothing. */
export async function previewImportAction(
  portfolioId: string,
  formData: FormData,
): Promise<ImportActionResult> {
  const upload = await readUpload(portfolioId, formData);
  if (!upload.ok) {
    return upload.result;
  }

  const user = await requireUser();
  const result = await planImport(getDb(), user, upload.accountId, upload.report);

  return result.ok
    ? { status: "preview", preview: toPreview(result.plan) }
    : failed("accountNotFound");
}

/** Second step: reads the same file again and adds its operations to the account. */
export async function commitImportAction(
  portfolioId: string,
  formData: FormData,
): Promise<ImportActionResult> {
  const upload = await readUpload(portfolioId, formData);
  if (!upload.ok) {
    return upload.result;
  }

  const user = await requireUser();
  const result = await runImport(getDb(), user, upload.accountId, upload.report);

  if (result.ok) {
    return { status: "done", ...result };
  }
  if (result.reason === "insufficientQuantity") {
    return failed("insufficientQuantity", {
      symbol: result.symbol,
      date: formatDate(result.date),
    });
  }
  return failed(`${result.reason}`);
}
