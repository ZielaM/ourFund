"use client";

import { cn } from "cn";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { useFormPending } from "./action-form";

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "type">;

/** Submit button that cannot be pressed twice while its form is being sent. */
export function SubmitButton({ children, disabled, className, ...props }: SubmitButtonProps) {
  const status = useFormStatus();
  const pending = useFormPending() || status.pending;

  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={cn("h-10 px-4", className)}
      {...props}
    >
      {children}
    </Button>
  );
}
