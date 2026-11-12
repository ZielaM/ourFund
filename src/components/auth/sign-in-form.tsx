"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormField } from "@/components/form/form-field";
import { FormResult } from "@/components/form/form-result";
import { SubmitButton } from "@/components/form/submit-button";
import { useFieldState } from "@/components/form/use-field-errors";
import { idleFormState, type FormState } from "@/lib/form-state";

type SignInFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
};

export function SignInForm({ action }: SignInFormProps) {
  const t = useTranslations("auth");
  const [state, formAction] = useActionState(action, idleFormState);
  const field = useFieldState(state);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormResult state={state} />
      <FormField
        name="username"
        label={t("fields.username")}
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
        label={t("fields.password")}
        autoComplete="current-password"
        error={field.error("password")}
        required
      />
      <SubmitButton className="self-start">{t("signIn.submit")}</SubmitButton>
    </form>
  );
}
