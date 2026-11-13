"use client";

import type { FormState } from "@/lib/form-state";
import { FormNotice } from "./form-notice";
import { useErrorMessage } from "./use-error-message";
import { useNoticeMessage } from "./use-notice-message";

/** Shows the form-level outcome of a submission: an error or a confirmation. */
export function FormResult({ state }: { state: FormState }) {
  const errorMessage = useErrorMessage();
  const noticeMessage = useNoticeMessage();

  if (state.status === "error" && state.formError) {
    return (
      <FormNotice tone="error">{errorMessage(state.formError, state.formErrorParams)}</FormNotice>
    );
  }

  if (state.status === "success") {
    return (
      <FormNotice tone="success">{noticeMessage(state.message, state.messageParams)}</FormNotice>
    );
  }

  return null;
}
