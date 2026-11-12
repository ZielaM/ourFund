"use client";

import { cn } from "cn";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "type">;

/** Submit button that cannot be pressed twice while its form is being sent. */
export function SubmitButton({ children, disabled, className, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

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
