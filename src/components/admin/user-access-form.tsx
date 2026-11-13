import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/submit-button";
import type { FormState } from "@/lib/form-state";

type UserAccessFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  /** Blocking is the destructive direction and is styled accordingly. */
  destructive: boolean;
};

/** One-button form that blocks or unblocks an account. */
export function UserAccessForm({ action, submitLabel, destructive }: UserAccessFormProps) {
  return (
    <ActionForm action={action} className="gap-4">
      <SubmitButton variant={destructive ? "destructive" : "outline"} className="self-start">
        {submitLabel}
      </SubmitButton>
    </ActionForm>
  );
}
