import { cn } from "cn";
import type { ReactNode } from "react";

type FormNoticeProps = {
  tone: "error" | "success";
  children: ReactNode;
};

/** A message about the whole form. Announced by screen readers as soon as it appears. */
export function FormNotice({ tone, children }: FormNoticeProps) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "border-l-4 py-2 pr-3 pl-3 text-sm",
        tone === "error" ? "border-destructive bg-destructive/5 text-destructive" : "",
        tone === "success" ? "border-gain bg-gain/5 text-gain" : "",
      )}
    >
      {children}
    </p>
  );
}
