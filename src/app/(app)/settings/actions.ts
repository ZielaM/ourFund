"use server";

import { changePasswordSchema } from "@/domain/auth/schemas";
import { formSucceeded, textField, validationFailed, type FormState } from "@/lib/form-state";
import { changeOwnPassword } from "@/server/auth/accounts";
import { getSessionToken, requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";

export async function changePasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: textField(formData, "currentPassword"),
    password: textField(formData, "password"),
    passwordConfirmation: textField(formData, "passwordConfirmation"),
  });

  if (!parsed.success) {
    return validationFailed(parsed.error);
  }

  const result = await changeOwnPassword(getDb(), user.id, parsed.data, {
    keepSessionToken: await getSessionToken(),
  });

  if (!result.ok) {
    return { status: "error", fieldErrors: { currentPassword: "auth.wrongCurrentPassword" } };
  }

  return formSucceeded("password.changed");
}
