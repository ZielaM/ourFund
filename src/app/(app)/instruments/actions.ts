"use server";

import { revalidatePath } from "next/cache";
import { manualPriceSchema, quoteSettingsSchema } from "@/domain/market-data/inputs";
import { isIsoDate } from "@/domain/portfolio/dates";
import { instrumentInputSchema } from "@/domain/portfolio/naming";
import {
  formFailed,
  formSucceeded,
  textField,
  validationFailed,
  type FormState,
} from "@/lib/form-state";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import {
  deleteManualPrice,
  setManualPrice,
  updateQuoteSettings,
} from "@/server/market-data/prices";
import { getMarketDataProviders } from "@/server/market-data/providers";
import { refreshMarketDataOnce } from "@/server/market-data/refresh";
import { createInstrument } from "@/server/portfolio/instruments";

export async function createInstrumentAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const values = {
    symbol: textField(formData, "symbol"),
    name: textField(formData, "name"),
    type: textField(formData, "type"),
    market: textField(formData, "market"),
    currency: textField(formData, "currency"),
  };
  const parsed = instrumentInputSchema.safeParse(values);

  if (!parsed.success) {
    return validationFailed(parsed.error, values);
  }

  const result = await createInstrument(getDb(), user, parsed.data);

  if (!result.ok) {
    return { status: "error", fieldErrors: { symbol: "instruments.exists" }, values };
  }

  revalidatePath("/instruments");
  return formSucceeded("instruments.created", { symbol: result.instrument.symbol });
}

export async function refreshMarketDataAction(
  // Signature required by useActionState; this form has no fields.
  _state: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _state;
  void _formData;
  await requireUser();

  const providers = getMarketDataProviders(getEnv().MARKET_DATA);
  if (!providers) {
    return formFailed("marketData.off");
  }

  const report = await refreshMarketDataOnce(getDb(), providers);
  const failed = report.instruments.failed.length + report.currencies.failed.length;

  revalidatePath("/instruments", "layout");
  return formSucceeded(failed > 0 ? "marketData.refreshedWithErrors" : "marketData.refreshed");
}

export async function updateQuoteSettingsAction(
  instrumentId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const values = {
    priceSource: textField(formData, "priceSource"),
    quoteSymbol: textField(formData, "quoteSymbol"),
  };
  const parsed = quoteSettingsSchema.safeParse(values);

  if (!parsed.success) {
    return validationFailed(parsed.error, values);
  }

  const result = await updateQuoteSettings(getDb(), user, instrumentId, parsed.data);

  if (!result.ok) {
    return formFailed("notFound");
  }

  revalidatePath("/instruments", "layout");
  return formSucceeded("instruments.sourceSaved");
}

export async function setManualPriceAction(
  instrumentId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const values = { date: textField(formData, "date"), close: textField(formData, "close") };
  const parsed = manualPriceSchema.safeParse(values);

  if (!parsed.success) {
    return validationFailed(parsed.error, values);
  }

  const result = await setManualPrice(getDb(), user, instrumentId, parsed.data);

  if (!result.ok) {
    return result.reason === "futureDate"
      ? { status: "error", fieldErrors: { date: "date.future" }, values }
      : formFailed("notFound");
  }

  revalidatePath("/instruments", "layout");
  return formSucceeded("prices.saved");
}

export async function deleteManualPriceAction(
  instrumentId: string,
  date: string,
  _state: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _state;
  void _formData;
  const user = await requireUser();

  if (!isIsoDate(date)) {
    return formFailed("prices.notFound");
  }

  const result = await deleteManualPrice(getDb(), user, instrumentId, date);

  if (!result.ok) {
    return formFailed(result.reason === "notManual" ? "prices.notManual" : "prices.notFound");
  }

  revalidatePath("/instruments", "layout");
  return formSucceeded("prices.deleted");
}
