"use server";

import { revalidatePath } from "next/cache";
import { newAccountWithRoleSchema, setPasswordSchema } from "@/domain/auth/schemas";
import {
  formFailed,
  formSucceeded,
  textField,
  validationFailed,
  type FormState,
} from "@/lib/form-state";
import { createUserAsAdmin, resetUserPassword, setUserDisabled } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";

export async function createUserAction(_state: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdmin();

  const input = {
    username: textField(formData, "username"),
    password: textField(formData, "password"),
    passwordConfirmation: textField(formData, "passwordConfirmation"),
    role: textField(formData, "role"),
  };
  const values = { username: input.username, role: input.role };
  const parsed = newAccountWithRoleSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailed(parsed.error, values);
  }

  const result = await createUserAsAdmin(getDb(), actor, parsed.data);

  if (!result.ok) {
    return { status: "error", fieldErrors: { username: "username.taken" }, values };
  }

  revalidatePath("/admin/users");
  return formSucceeded("users.created", { username: result.user.username });
}

export async function setUserDisabledAction(
  userId: string,
  disabled: boolean,
  // Signature required by useActionState; this form has no fields.
  _state: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _state;
  void _formData;
  const actor = await requireAdmin();

  const result = await setUserDisabled(getDb(), actor, userId, disabled);

  if (!result.ok) {
    return formFailed(`users.${result.reason}`);
  }

  revalidatePath("/admin/users");
  return formSucceeded(disabled ? "users.disabled" : "users.enabled");
}

export async function resetUserPasswordAction(
  userId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireAdmin();

  const parsed = setPasswordSchema.safeParse({
    password: textField(formData, "password"),
    passwordConfirmation: textField(formData, "passwordConfirmation"),
  });

  if (!parsed.success) {
    return validationFailed(parsed.error);
  }

  const result = await resetUserPassword(getDb(), actor, userId, parsed.data.password);

  if (!result.ok) {
    return formFailed(`users.${result.reason}`);
  }

  return formSucceeded("password.set");
}
