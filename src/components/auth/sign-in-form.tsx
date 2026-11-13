import { useTranslations } from "next-intl";
import { ActionForm } from "@/components/form/action-form";
import { TextField } from "@/components/form/fields";
import { SubmitButton } from "@/components/form/submit-button";
import type { FormState } from "@/lib/form-state";

type SignInFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
};

export function SignInForm({ action }: SignInFormProps) {
  const t = useTranslations("auth");

  return (
    <ActionForm action={action}>
      <TextField
        name="username"
        label={t("fields.username")}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <TextField
        name="password"
        type="password"
        label={t("fields.password")}
        autoComplete="current-password"
        required
      />
      <SubmitButton className="self-start">{t("signIn.submit")}</SubmitButton>
    </ActionForm>
  );
}
