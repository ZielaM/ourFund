"use client";

import { useActionState } from "react";
import { FormResult } from "@/components/form/form-result";
import { SubmitButton } from "@/components/form/submit-button";
import { idleFormState, type FormState } from "@/lib/form-state";

type UserAccessFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  /** Blocking is the destructive direction and is styled accordingly. */
  destructive: boolean;
};

/** One-button form that blocks or unblocks an account. */
export function UserAccessForm({ action, submitLabel, destructive }: UserAccessFormProps) {
  const [state, formAction] = useActionState(action, idleFormState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormResult state={state} />
      <SubmitButton variant={destructive ? "destructive" : "outline"} className="self-start">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
