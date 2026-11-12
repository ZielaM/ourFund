"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormField } from "@/components/form/form-field";
import { FormResult } from "@/components/form/form-result";
import { SubmitButton } from "@/components/form/submit-button";
import { useFieldState } from "@/components/form/use-field-errors";
import { PASSWORD_MIN_LENGTH } from "@/domain/auth/schemas";
import { idleFormState, type FormState } from "@/lib/form-state";

type PasswordFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  /** Users changing their own password must confirm the current one. */
  askForCurrentPassword?: boolean;
};

export function PasswordForm({
  action,
  submitLabel,
  askForCurrentPassword = false,
}: PasswordFormProps) {
  const t = useTranslations("auth.fields");
  const [state, formAction] = useActionState(action, idleFormState);
  const field = useFieldState(state);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormResult state={state} />
      {askForCurrentPassword ? (
        <FormField
          name="currentPassword"
          type="password"
          label={t("currentPassword")}
          autoComplete="current-password"
          error={field.error("currentPassword")}
          required
        />
      ) : null}
      <FormField
        name="password"
        type="password"
        label={t("newPassword")}
        hint={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}
        autoComplete="new-password"
        error={field.error("password")}
        required
      />
      <FormField
        name="passwordConfirmation"
        type="password"
        label={t("passwordConfirmation")}
        autoComplete="new-password"
        error={field.error("passwordConfirmation")}
        required
      />
      <SubmitButton className="self-start">{submitLabel}</SubmitButton>
    </form>
  );
}
