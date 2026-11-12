import type { ZodError } from "zod";

export type FormValues = Record<string, string>;

/**
 * Result of a form submission handled by a Server Action.
 * `formError`, `fieldErrors` values and `message` are translation keys, not display text.
 */
export type FormState =
  | { status: "idle" }
  | {
      status: "error";
      formError?: string;
      formErrorParams?: Record<string, number>;
      fieldErrors?: Record<string, string>;
      /** Non-secret values to put back into the form. */
      values?: FormValues;
    }
  | { status: "success"; message: string; messageParams?: Record<string, string> };

export const idleFormState: FormState = { status: "idle" };

/** Keeps the first problem reported for each field. */
export function validationFailed(error: ZodError, values?: FormValues): FormState {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !(field in fieldErrors)) {
      fieldErrors[field] = issue.message;
    }
  }

  return { status: "error", fieldErrors, values };
}

export function formFailed(
  formError: string,
  options: { values?: FormValues; params?: Record<string, number> } = {},
): FormState {
  return {
    status: "error",
    formError,
    formErrorParams: options.params,
    values: options.values,
  };
}

export function formSucceeded(message: string, messageParams?: Record<string, string>): FormState {
  return { status: "success", message, messageParams };
}

/** Reads a text field from submitted form data; files and missing fields become "". */
export function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
