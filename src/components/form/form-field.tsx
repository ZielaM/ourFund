import { useId, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFieldProps = Omit<ComponentProps<"input">, "id"> & {
  name: string;
  label: string;
  /** Short guidance shown under the field. */
  hint?: string;
  /** Already translated error text. */
  error?: string;
};

export function FormField({ name, label, hint, error, ...inputProps }: FormFieldProps) {
  // Several forms on one page may have a field with the same name, so ids must be unique.
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && !error && hintId, error && errorId].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="h-10 bg-card"
        {...inputProps}
      />
      {hint && !error ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
