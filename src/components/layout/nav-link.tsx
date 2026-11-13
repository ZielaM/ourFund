"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavLinkProps = {
  href: string;
  /** Match only the exact path (used for the dashboard at "/"). */
  exact?: boolean;
  /** Other sections that belong to this link, e.g. "/portfolios" for the dashboard. */
  alsoActiveUnder?: string[];
  children: ReactNode;
};

function isUnder(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

export function NavLink({ href, exact = false, alsoActiveUnder = [], children }: NavLinkProps) {
  const pathname = usePathname();
  const active =
    (exact ? pathname === href : isUnder(pathname, href)) ||
    alsoActiveUnder.some((section) => isUnder(pathname, section));

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
