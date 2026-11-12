"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormField } from "@/components/form/form-field";
import { FormResult } from "@/components/form/form-result";
import { SubmitButton } from "@/components/form/submit-button";
import { useFieldState } from "@/components/form/use-field-errors";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN_LENGTH } from "@/domain/auth/schemas";
import { idleFormState, type FormState } from "@/lib/form-state";

type NewAccountFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  /** Administrators also choose the role of the account they create. */
  withRole?: boolean;
};

/** User name + password + confirmation; used by first-run setup, registration and user management. */
export function NewAccountForm({ action, submitLabel, withRole = false }: NewAccountFormProps) {
  const t = useTranslations("auth.fields");
  const tUsers = useTranslations("users.create");
  const tRoles = useTranslations("roles");
  const [state, formAction] = useActionState(action, idleFormState);
  const field = useFieldState(state);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormResult state={state} />
      <FormField
        name="username"
        label={t("username")}
        hint={t("usernameHint")}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={field.value("username")}
        error={field.error("username")}
        required
      />
      <FormField
        name="password"
        type="password"
        label={t("password")}
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
      {withRole ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">{tUsers("role")}</Label>
          <select
            id="role"
            name="role"
            defaultValue={field.value("role") ?? "USER"}
            className="h-10 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="USER">{tRoles("USER")}</option>
            <option value="ADMIN">{tRoles("ADMIN")}</option>
          </select>
        </div>
      ) : null}
      <SubmitButton className="self-start">{submitLabel}</SubmitButton>
    </form>
  );
}
