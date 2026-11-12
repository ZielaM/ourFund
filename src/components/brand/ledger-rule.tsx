import { cn } from "cn";

/** The double rule that closes a column of figures in a ledger: thick line, then a thin one. */
export function LedgerRule({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-[3px]", className)}>
      <div className="h-[3px] bg-primary" />
      <div className="h-px bg-primary" />
    </div>
  );
}
