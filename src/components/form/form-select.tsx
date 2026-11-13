import { useId, type ComponentProps, type ReactNode } from "react";
import { Label } from "@/components/ui/label";

type FormSelectProps = Omit<ComponentProps<"select">, "id"> & {
  name: string;
  label: string;
  hint?: string;
  /** Already translated error text. */
  error?: string;
  children: ReactNode;
};

export function FormSelect({
  name,
  label,
  hint,
  error,
  children,
  ...selectProps
}: FormSelectProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && !error && hintId, error && errorId].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="h-10 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        {...selectProps}
      >
        {children}
      </select>
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
