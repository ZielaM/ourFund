"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountInputSchema, portfolioInputSchema } from "@/domain/portfolio/naming";
import { transactionInputSchema } from "@/domain/portfolio/transaction-input";
import {
  formFailed,
  formSucceeded,
  textField,
  validationFailed,
  type FormState,
} from "@/lib/form-state";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import {
  createAccount,
  createPortfolio,
  deleteAccount,
  deletePortfolio,
  renamePortfolio,
  updateAccount,
} from "@/server/portfolio/portfolios";
import {
  addTransaction,
  deleteTransaction,
  updateTransaction,
  type SaveTransactionResult,
} from "@/server/portfolio/transactions";

function fieldFailed(field: string, code: string, values?: Record<string, string>): FormState {
  return { status: "error", fieldErrors: { [field]: code }, values };
}

export async function createPortfolioAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const values = { name: textField(formData, "name") };
  const parsed = portfolioInputSchema.safeParse(values);

  if (!parsed.success) {
    return validationFailed(parsed.error, values);
  }

  const result = await createPortfolio(getDb(), user, parsed.data);

  if (!result.ok) {
    return fieldFailed("name", "portfolios.nameTaken", values);
  }

  redirect(`/portfolios/${result.id}`);
}

export async function renamePortfolioAction(
  portfolioId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const values = { name: textField(formData, "name") };
  const parsed = portfolioInputSchema.safeParse(values);

  if (!parsed.success) {
    return validationFailed(parsed.error, values);
  }

  const result = await renamePortfolio(getDb(), user, portfolioId, parsed.data);

  if (!result.ok) {
    return result.reason === "nameTaken"
      ? fieldFailed("name", "portfolios.nameTaken", values)
      : formFailed("notFound");
  }

  revalidatePath(`/portfolios/${portfolioId}`, "layout");
  return formSucceeded("portfolios.renamed");
}

export async function deletePortfolioAction(
  portfolioId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  if (textField(formData, "confirm") !== "on") {
    return fieldFailed("confirm", "confirmRequired");
  }

  const result = await deletePortfolio(getDb(), user, portfolioId);

  if (!result.ok) {
    return formFailed("notFound");
  }

  redirect("/");
}

function accountValues(formData: FormData) {
  return {
    name: textField(formData, "name"),
    type: textField(formData, "type"),
    institution: textField(formData, "institution"),
  };
}

export async function createAccountAction(
  portfolioId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const values = accountValues(formData);
  const parsed = accountInputSchema.safeParse(values);

  if (!parsed.success) {
    return validationFailed(parsed.error, values);
  }

  const result = await createAccount(getDb(), user, portfolioId, parsed.data);

  if (!result.ok) {
    return result.reason === "nameTaken"
      ? fieldFailed("name", "accounts.nameTaken", values)
      : formFailed("notFound");
  }

  revalidatePath(`/portfolios/${portfolioId}`, "layout");
  return formSucceeded("accounts.created", { name: parsed.data.name });
}

export async function updateAccountAction(
  portfolioId: string,
  accountId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const values = accountValues(formData);
  const parsed = accountInputSchema.safeParse(values);

  if (!parsed.success) {
    return validationFailed(parsed.error, values);
  }

  const result = await updateAccount(getDb(), user, accountId, parsed.data);

  if (!result.ok) {
    return result.reason === "nameTaken"
      ? fieldFailed("name", "accounts.nameTaken", values)
      : formFailed("notFound");
  }

  revalidatePath(`/portfolios/${portfolioId}`, "layout");
  return formSucceeded("accounts.updated");
}

export async function deleteAccountAction(
  portfolioId: string,
  accountId: string,
  // Signature required by useActionState; this form has no fields.
  _state: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _state;
  void _formData;
  const user = await requireUser();

  const result = await deleteAccount(getDb(), user, accountId);

  if (!result.ok) {
    return formFailed(
      result.reason === "hasTransactions" ? "accounts.hasTransactions" : "notFound",
    );
  }

  revalidatePath(`/portfolios/${portfolioId}`, "layout");
  return formSucceeded("accounts.deleted");
}

const TRANSACTION_FIELDS = [
  "type",
  "accountId",
  "date",
  "instrumentId",
  "quantity",
  "price",
  "fee",
  "currency",
  "fxRate",
  "amount",
  "tax",
  "splitRatio",
  "note",
] as const;

function transactionFailure(
  result: Extract<SaveTransactionResult, { ok: false }>,
  values: Record<string, string>,
): FormState {
  switch (result.reason) {
    case "futureDate":
      return fieldFailed("date", "date.future", values);
    case "accountNotFound":
      return fieldFailed("accountId", "transactions.accountNotFound", values);
    case "instrumentNotFound":
      return fieldFailed("instrumentId", "transactions.instrumentNotFound", values);
    case "insufficientQuantity":
      return formFailed("transactions.insufficientQuantity", { values });
    case "notFound":
      return formFailed("transactions.notFound", { values });
  }
}

/** Adds a transaction, or changes an existing one when `transactionId` is given. */
export async function saveTransactionAction(
  portfolioId: string,
  transactionId: string | null,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  // Fields that are not shown for the chosen type are simply absent from the form.
  const values: Record<string, string> = {};
  for (const name of TRANSACTION_FIELDS) {
    if (formData.has(name)) {
      values[name] = textField(formData, name);
    }
  }

  const parsed = transactionInputSchema.safeParse(values);

  if (!parsed.success) {
    return validationFailed(parsed.error, values);
  }

  const result = transactionId
    ? await updateTransaction(getDb(), user, transactionId, parsed.data)
    : await addTransaction(getDb(), user, parsed.data);

  if (!result.ok) {
    return transactionFailure(result, values);
  }

  redirect(`/portfolios/${portfolioId}`);
}

export async function deleteTransactionAction(
  portfolioId: string,
  transactionId: string,
  _state: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _state;
  void _formData;
  const user = await requireUser();

  const result = await deleteTransaction(getDb(), user, transactionId);

  if (!result.ok) {
    return formFailed(
      result.reason === "insufficientQuantity"
        ? "transactions.insufficientQuantity"
        : "transactions.notFound",
    );
  }

  redirect(`/portfolios/${portfolioId}`);
}
