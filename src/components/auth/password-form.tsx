import { useTranslations } from "next-intl";
import { ActionForm } from "@/components/form/action-form";
import { TextField } from "@/components/form/fields";
import { SubmitButton } from "@/components/form/submit-button";
import { PASSWORD_MIN_LENGTH } from "@/domain/auth/schemas";
import type { FormState } from "@/lib/form-state";

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

  return (
    <ActionForm action={action}>
      {askForCurrentPassword ? (
        <TextField
          name="currentPassword"
          type="password"
          label={t("currentPassword")}
          autoComplete="current-password"
          required
        />
      ) : null}
      <TextField
        name="password"
        type="password"
        label={t("newPassword")}
        hint={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}
        autoComplete="new-password"
        required
      />
      <TextField
        name="passwordConfirmation"
        type="password"
        label={t("passwordConfirmation")}
        autoComplete="new-password"
        required
      />
      <SubmitButton className="self-start">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
