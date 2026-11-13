"use server";

import { revalidatePath } from "next/cache";
import { instrumentInputSchema } from "@/domain/portfolio/naming";
import { formSucceeded, textField, validationFailed, type FormState } from "@/lib/form-state";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
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
