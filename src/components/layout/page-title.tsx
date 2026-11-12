import type { ReactNode } from "react";
import { LedgerRule } from "@/components/brand/ledger-rule";

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-fit flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">{children}</h1>
      <LedgerRule />
    </div>
  );
}
