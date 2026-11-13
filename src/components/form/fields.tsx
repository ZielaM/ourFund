"use client";

import { useId, type ComponentProps } from "react";
import { useFormState } from "./action-form";
import { FormField } from "./form-field";
import { FormSelect } from "./form-select";
import { useFieldState } from "./use-field-errors";

/** A text input inside an <ActionForm>: shows its error and keeps its value after a failed submit. */
export function TextField({ name, defaultValue, ...props }: ComponentProps<typeof FormField>) {
  const field = useFieldState(useFormState());

  return (
    <FormField
      name={name}
      defaultValue={field.value(name) ?? defaultValue}
      error={field.error(name)}
      {...props}
    />
  );
}

/** A select inside an <ActionForm>. */
export function SelectField({ name, defaultValue, ...props }: ComponentProps<typeof FormSelect>) {
  const field = useFieldState(useFormState());

  return (
    <FormSelect
      name={name}
      defaultValue={field.value(name) ?? defaultValue}
      error={field.error(name)}
      {...props}
    />
  );
}

type CheckboxFieldProps = {
  name: string;
  label: string;
};

/** A confirmation checkbox inside an <ActionForm>. */
export function CheckboxField({ name, label }: CheckboxFieldProps) {
  const error = useFieldState(useFormState()).error(name);
  const errorId = `${useId()}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
