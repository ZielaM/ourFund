import { cn } from "cn";
import { APP_NAME } from "@/config/app";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display font-semibold tracking-tight text-primary", className)}>
      {APP_NAME}
    </span>
  );
}
