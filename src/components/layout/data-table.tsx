import { cn } from "cn";
import type { ReactNode } from "react";

/** The framed surface every table of figures sits on. */
export function DataTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:whitespace-nowrap",
        className,
      )}
    >
      {children}
    </div>
  );
}
