"use server";

import { redirect } from "next/navigation";
import { newAccountSchema, signInSchema } from "@/domain/auth/schemas";
import { formFailed, textField, validationFailed, type FormState } from "@/lib/form-state";
import { authenticate, createFirstAdmin, registerUser } from "@/server/auth/accounts";
import { endSession, startSession } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";

function newAccountInput(formData: FormData) {
  return {
    username: textField(formData, "username"),
    password: textField(formData, "password"),
    passwordConfirmation: textField(formData, "passwordConfirmation"),
  };
}

export async function signInAction(_state: FormState, formData: FormData): Promise<FormState> {
  const username = textField(formData, "username");
  const parsed = signInSchema.safeParse({ username, password: textField(formData, "password") });

  if (!parsed.success) {
    return validationFailed(parsed.error, { username });
  }

  const result = await authenticate(getDb(), parsed.data);

  if (!result.ok) {
    if (result.reason === "locked") {
      const minutes = Math.max(1, Math.ceil((result.retryAt.getTime() - Date.now()) / 60_000));
      return formFailed("auth.locked", { values: { username }, params: { minutes } });
    }
    return formFailed("auth.invalidCredentials", { values: { username } });
  }

  await startSession(result.user.id);
  redirect("/");
}

export async function setupAction(_state: FormState, formData: FormData): Promise<FormState> {
  const input = newAccountInput(formData);
  const parsed = newAccountSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailed(parsed.error, { username: input.username });
  }

  const result = await createFirstAdmin(getDb(), parsed.data);

  if (!result.ok) {
    return formFailed("setup.alreadyDone");
  }

  await startSession(result.user.id);
  redirect("/");
}

export async function registerAction(_state: FormState, formData: FormData): Promise<FormState> {
  // The page is hidden when registration is off; the action must refuse on its own as well.
  if (!getEnv().ALLOW_REGISTRATION) {
    return formFailed("unknown");
  }

  const input = newAccountInput(formData);
  const parsed = newAccountSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailed(parsed.error, { username: input.username });
  }

  const result = await registerUser(getDb(), parsed.data);

  if (!result.ok) {
    return {
      status: "error",
      fieldErrors: { username: "username.taken" },
      values: { username: input.username },
    };
  }

  await startSession(result.user.id);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
