"use client";

import { cn } from "cn";
import {
  createContext,
  startTransition,
  use,
  useActionState,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { idleFormState, type FormState } from "@/lib/form-state";
import { FormResult } from "./form-result";

type FormContext = { state: FormState; pending: boolean };

const FormStateContext = createContext<FormContext>({ state: idleFormState, pending: false });

/** The latest result of the surrounding <ActionForm>. */
export function useFormState(): FormState {
  return use(FormStateContext).state;
}

/** True while the surrounding <ActionForm> is being submitted. */
export function useFormPending(): boolean {
  return use(FormStateContext).pending;
}

type ActionFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
};

/**
 * A form submitted to a Server Action. Shows the form-level result and makes field errors
 * and previously entered values available to the fields inside it (see `fields.tsx`).
 *
 * What the user typed stays in place when the submission fails; the form is cleared only
 * after a success. (Left to itself, React resets a form after every action, which also
 * throws away the selection of controlled <select> elements.)
 */
export function ActionForm({ action, children, className }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      // Used when JavaScript has not loaded yet; `onSubmit` takes over afterwards.
      action={formAction}
      onSubmit={submit}
      className={cn("flex flex-col gap-5", className)}
      noValidate
    >
      <FormStateContext value={{ state, pending }}>
        <FormResult state={state} />
        {children}
      </FormStateContext>
    </form>
  );
}
