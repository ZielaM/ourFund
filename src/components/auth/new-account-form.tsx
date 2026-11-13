import { useTranslations } from "next-intl";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, TextField } from "@/components/form/fields";
import { SubmitButton } from "@/components/form/submit-button";
import { PASSWORD_MIN_LENGTH } from "@/domain/auth/schemas";
import type { FormState } from "@/lib/form-state";

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

  return (
    <ActionForm action={action}>
      <TextField
        name="username"
        label={t("username")}
        hint={t("usernameHint")}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <TextField
        name="password"
        type="password"
        label={t("password")}
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
      {withRole ? (
        <SelectField name="role" label={tUsers("role")} defaultValue="USER">
          <option value="USER">{tRoles("USER")}</option>
          <option value="ADMIN">{tRoles("ADMIN")}</option>
        </SelectField>
      ) : null}
      <SubmitButton className="self-start">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
