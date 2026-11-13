"use client";

import type { FormState } from "@/lib/form-state";
import { useErrorMessage } from "./use-error-message";

/** Returns a lookup of translated field errors and previously entered values for a form. */
export function useFieldState(state: FormState) {
  const errorMessage = useErrorMessage();
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const values = state.status === "error" ? state.values : undefined;

  return {
    error: (name: string): string | undefined => {
      const code = fieldErrors?.[name];
      return code ? errorMessage(code) : undefined;
    },
    value: (name: string): string | undefined => values?.[name],
  };
}
