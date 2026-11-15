"use client";

import { cn } from "cn";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition, type FormEvent } from "react";
import type { ImportActionResult, ImportPreview } from "@/app/(app)/portfolios/[id]/import/actions";
import { FormField } from "@/components/form/form-field";
import { FormNotice } from "@/components/form/form-notice";
import { FormSelect } from "@/components/form/form-select";
import { DataTable } from "@/components/layout/data-table";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ImportFormProps = {
  accounts: { id: string; name: string }[];
  currencies: readonly string[];
  portfolioHref: string;
  preview: (formData: FormData) => Promise<ImportActionResult>;
  commit: (formData: FormData) => Promise<ImportActionResult>;
};

const idle: ImportActionResult | null = null;

/**
 * Importing a broker's file in two steps: first the file is read and the user sees what
 * would be added, then the same file is sent again to be imported. Nothing is kept on the
 * server in between.
 */
export function ImportForm({
  accounts,
  currencies,
  portfolioHref,
  preview,
  commit,
}: ImportFormProps) {
  const t = useTranslations("import");
  const tTypes = useTranslations("transactionTypes");
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState(idle);
  const [pending, startTransition] = useTransition();

  const errorText = (code: string, params?: Record<string, string>) => {
    const key = `errors.${code}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key, params) : t("errors.unknown");
  };

  function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => setResult(await preview(formData)));
  }

  function confirm() {
    const formData = new FormData(formRef.current!);
    startTransition(async () => {
      const outcome = await commit(formData);
      setResult(outcome);
      if (outcome.status === "done") {
        formRef.current?.reset();
      }
    });
  }

  /** What was shown no longer describes the form once the account or the file changes. */
  const forget = () => setResult(idle);

  return (
    <div className="flex flex-col gap-10">
      <form ref={formRef} onSubmit={check} className="flex max-w-sm flex-col gap-5" noValidate>
        {result?.status === "error" ? (
          <FormNotice tone="error">{errorText(result.code, result.params)}</FormNotice>
        ) : null}
        {result?.status === "done" ? (
          <FormNotice tone="success">
            {t("done", {
              imported: result.imported,
              duplicates: result.duplicates,
              instruments: result.instrumentsCreated,
            })}{" "}
            <Link href={portfolioHref} className="underline underline-offset-4">
              {t("backToPortfolio")}
            </Link>
          </FormNotice>
        ) : null}

        <FormSelect name="accountId" label={t("account")} hint={t("accountHint")} onChange={forget}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </FormSelect>
        <FormField
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          label={t("file")}
          hint={t("fileHint")}
          onChange={forget}
          className="h-auto bg-card py-2"
        />
        <FormSelect
          name="currency"
          label={t("currency")}
          hint={t("currencyHint")}
          onChange={forget}
        >
          <option value="">{t("currencyFromFile")}</option>
          {currencies.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </FormSelect>

        <Button type="submit" disabled={pending} aria-busy={pending} className="h-10 w-fit px-4">
          {t("check")}
        </Button>
      </form>

      {result?.status === "preview" ? (
        <PreviewSection
          preview={result.preview}
          pending={pending}
          onConfirm={confirm}
          typeLabel={(type) => tTypes(type)}
        />
      ) : null}
    </div>
  );
}

type PreviewSectionProps = {
  preview: ImportPreview;
  pending: boolean;
  onConfirm: () => void;
  typeLabel: (type: ImportPreview["rows"][number]["type"]) => string;
};

function PreviewSection({ preview, pending, onConfirm, typeLabel }: PreviewSectionProps) {
  const t = useTranslations("import.preview");
  const count = preview.rows.length;
  const blocked = preview.problem !== null || count === 0;

  return (
    <section aria-labelledby="import-preview-title" className="flex flex-col gap-6">
      <div className="flex max-w-prose flex-col gap-2">
        <h2 id="import-preview-title" className="text-xl font-semibold">
          {t("title")}
        </h2>
        <p role="status">
          {t("summary", {
            account: preview.accountNumber,
            currency: preview.currency,
            count,
            duplicates: preview.duplicates,
          })}
        </p>
      </div>

      {preview.problem ? (
        <FormNotice tone="error">{t("problem", preview.problem)}</FormNotice>
      ) : null}

      <ul className="flex max-w-prose flex-col gap-4 text-sm empty:hidden">
        {preview.newInstruments.length > 0 ? (
          <li className="flex flex-col gap-1">
            <span className="font-medium">{t("newInstruments")}</span>
            <span className="text-muted-foreground">
              {preview.newInstruments
                .map((instrument) => `${instrument.symbol} (${instrument.name})`)
                .join(", ")}
            </span>
          </li>
        ) : null}
        {preview.mismatches.length > 0 ? (
          <li className="flex flex-col gap-1">
            <span className="font-medium">{t("mismatches")}</span>
            <span className="text-muted-foreground">
              {preview.mismatches
                .map((entry) =>
                  t("mismatch", {
                    symbol: entry.symbol,
                    inFile: entry.inFile,
                    fromOperations: entry.fromOperations,
                  }),
                )
                .join("; ")}
              . {t("mismatchesHint")}
            </span>
          </li>
        ) : null}
        {preview.conflicts.length > 0 ? (
          <li className="flex flex-col gap-1">
            <span className="font-medium">{t("conflicts")}</span>
            <span className="text-muted-foreground">
              {preview.conflicts.join(", ")}. {t("conflictsHint")}
            </span>
          </li>
        ) : null}
      </ul>

      {preview.skipped.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{t("skipped", { count: preview.skipped.length })}</h3>
          <p className="max-w-prose text-sm text-muted-foreground">{t("skippedHint")}</p>
          <DataTable className="max-w-2xl">
            <Table>
              <TableCaption className="sr-only">{t("skippedCaption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("row")}</TableHead>
                  <TableHead>{t("operation")}</TableHead>
                  <TableHead>{t("reason")}</TableHead>
                  <TableHead className="text-right">{t("amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.skipped.map((row) => (
                  <TableRow key={row.row}>
                    <TableCell className="tabular-nums">{row.row}</TableCell>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>{t(`reasons.${row.reason}` as Parameters<typeof t>[0])}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.amount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        </div>
      ) : null}

      {count > 0 ? (
        <details className="flex flex-col gap-3">
          <summary className="w-fit cursor-pointer font-medium">
            {t("operations", { count })}
          </summary>
          <DataTable className="mt-3">
            <Table>
              <TableCaption className="sr-only">{t("operationsCaption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("date")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("instrument")}</TableHead>
                  <TableHead className="text-right">{t("quantity")}</TableHead>
                  <TableHead className="text-right">{t("price")}</TableHead>
                  <TableHead className="text-right">{t("cash")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell className="tabular-nums">{row.date}</TableCell>
                    <TableCell>{typeLabel(row.type)}</TableCell>
                    <TableCell className="font-medium">{row.symbol}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.price}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        row.outflow ? "text-loss" : "text-gain",
                      )}
                    >
                      {row.outflow ? "" : "+"}
                      {row.cash}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        </details>
      ) : null}

      <Button
        type="button"
        onClick={onConfirm}
        disabled={pending || blocked}
        aria-busy={pending}
        className="h-10 w-fit px-4"
      >
        {t("confirm", { count })}
      </Button>
    </section>
  );
}
