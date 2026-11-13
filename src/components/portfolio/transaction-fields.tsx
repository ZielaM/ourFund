"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFormState } from "@/components/form/action-form";
import { FormField } from "@/components/form/form-field";
import { FormSelect } from "@/components/form/form-select";
import { useFieldState } from "@/components/form/use-field-errors";
import { TRANSACTION_TYPES, type TransactionType } from "@/domain/portfolio/transaction-input";

export type TransactionFormValues = Partial<Record<string, string>>;

type TransactionFieldsProps = {
  accounts: { id: string; name: string }[];
  instruments: { id: string; symbol: string; name: string; currency: string }[];
  currencies: readonly string[];
  /** Values the form starts with: today's date for a new transaction, stored values when editing. */
  initial: TransactionFormValues;
  /** A transaction stays on its account, so the account cannot be changed when editing. */
  lockAccount?: boolean;
};

const WITH_INSTRUMENT: readonly TransactionType[] = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "SPLIT",
];
const TRADES: readonly TransactionType[] = ["BUY", "SELL"];
const INCOME: readonly TransactionType[] = ["DIVIDEND", "INTEREST"];
const CASH: readonly TransactionType[] = ["FEE", "DEPOSIT", "WITHDRAWAL"];

/** The fields of the transaction form. Which ones are shown depends on the transaction type. */
export function TransactionFields({
  accounts,
  instruments,
  currencies,
  initial,
  lockAccount = false,
}: TransactionFieldsProps) {
  const t = useTranslations("transaction.fields");
  const tTypes = useTranslations("transactionTypes");
  const state = useFormState();
  const field = useFieldState(state);
  const value = (name: string) => field.value(name) ?? initial[name] ?? "";

  const [type, setType] = useState<TransactionType>((initial.type as TransactionType) ?? "BUY");
  const [instrumentId, setInstrumentId] = useState(initial.instrumentId ?? "");
  const [currency, setCurrency] = useState(initial.currency ?? "");

  const instrument = instruments.find((candidate) => candidate.id === instrumentId);
  const isTrade = TRADES.includes(type);
  const settlementCurrency = currency || instrument?.currency || currencies[0];
  const paidInAnotherCurrency =
    isTrade && instrument !== undefined && settlementCurrency !== instrument.currency;

  function chooseInstrument(id: string) {
    setInstrumentId(id);
    // A trade is normally settled in the instrument's own currency.
    const chosen = instruments.find((candidate) => candidate.id === id);
    if (chosen && isTrade) {
      setCurrency(chosen.currency);
    }
  }

  const decimalProps = { inputMode: "decimal", autoComplete: "off" } as const;

  return (
    <>
      <FormSelect
        name="type"
        label={t("type")}
        value={type}
        onChange={(event) => setType(event.target.value as TransactionType)}
        error={field.error("type")}
      >
        {TRANSACTION_TYPES.map((option) => (
          <option key={option} value={option}>
            {tTypes(option)}
          </option>
        ))}
      </FormSelect>

      <FormSelect
        name="accountId"
        label={t("account")}
        defaultValue={value("accountId")}
        disabled={lockAccount}
        error={field.error("accountId")}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </FormSelect>
      {lockAccount ? <input type="hidden" name="accountId" value={value("accountId")} /> : null}

      <FormField
        name="date"
        type="date"
        label={t("date")}
        defaultValue={value("date")}
        error={field.error("date")}
        required
      />

      {WITH_INSTRUMENT.includes(type) ? (
        <div className="flex flex-col gap-1.5">
          <FormSelect
            name="instrumentId"
            label={t("instrument")}
            value={instrumentId}
            onChange={(event) => chooseInstrument(event.target.value)}
            error={field.error("instrumentId")}
          >
            <option value="">
              {type === "INTEREST" ? t("noInstrument") : t("chooseInstrument")}
            </option>
            {instruments.map((option) => (
              <option key={option.id} value={option.id}>
                {option.symbol} ({option.name})
              </option>
            ))}
          </FormSelect>
          <p className="text-sm text-muted-foreground">
            {t("missingInstrument")}{" "}
            <Link href="/instruments" className="text-foreground underline underline-offset-4">
              {t("addInstrument")}
            </Link>
          </p>
        </div>
      ) : null}

      {isTrade ? (
        <>
          <FormField
            name="quantity"
            label={t("quantity")}
            defaultValue={value("quantity")}
            error={field.error("quantity")}
            {...decimalProps}
          />
          <FormField
            name="price"
            label={instrument ? t("priceIn", { currency: instrument.currency }) : t("price")}
            defaultValue={value("price")}
            error={field.error("price")}
            {...decimalProps}
          />
          <FormSelect
            name="currency"
            label={t("settlementCurrency")}
            hint={t("settlementCurrencyHint")}
            value={settlementCurrency}
            onChange={(event) => setCurrency(event.target.value)}
            error={field.error("currency")}
          >
            {currencies.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </FormSelect>
          {paidInAnotherCurrency ? (
            <FormField
              name="fxRate"
              label={t("fxRate")}
              hint={t("fxRateHint", {
                settlement: settlementCurrency,
                instrument: instrument.currency,
              })}
              defaultValue={value("fxRate")}
              error={field.error("fxRate")}
              {...decimalProps}
            />
          ) : null}
          <FormField
            name="fee"
            label={`${t("fee")} (${settlementCurrency})`}
            hint={t("feeHint")}
            defaultValue={value("fee")}
            error={field.error("fee")}
            {...decimalProps}
          />
        </>
      ) : null}

      {INCOME.includes(type) || CASH.includes(type) ? (
        <>
          <FormField
            name="amount"
            label={INCOME.includes(type) ? t("grossAmount") : t("amount")}
            defaultValue={value("amount")}
            error={field.error("amount")}
            {...decimalProps}
          />
          {INCOME.includes(type) ? (
            <FormField
              name="tax"
              label={t("tax")}
              hint={t("taxHint")}
              defaultValue={value("tax")}
              error={field.error("tax")}
              {...decimalProps}
            />
          ) : null}
          <FormSelect
            name="currency"
            label={t("currency")}
            value={settlementCurrency}
            onChange={(event) => setCurrency(event.target.value)}
            error={field.error("currency")}
          >
            {currencies.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </FormSelect>
        </>
      ) : null}

      {type === "SPLIT" ? (
        <FormField
          name="splitRatio"
          label={t("splitRatio")}
          hint={t("splitRatioHint")}
          defaultValue={value("splitRatio")}
          error={field.error("splitRatio")}
          {...decimalProps}
        />
      ) : null}

      <FormField
        name="note"
        label={t("note")}
        hint={t("noteHint")}
        defaultValue={value("note")}
        error={field.error("note")}
        autoComplete="off"
      />
    </>
  );
}
