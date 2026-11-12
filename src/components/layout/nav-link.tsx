"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavLinkProps = {
  href: string;
  /** Match only the exact path (used for the dashboard at "/"). */
  exact?: boolean;
  children: ReactNode;
};

export function NavLink({ href, exact = false, children }: NavLinkProps) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "border-b-2 border-transparent px-1 py-4 text-sm font-medium transition-colors hover:text-foreground",
        active ? "border-primary text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </Link>
  );
}
