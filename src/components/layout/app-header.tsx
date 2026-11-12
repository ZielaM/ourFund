import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/app/(auth)/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { getCurrentUser } from "@/server/auth/current-user";
import { NavLink } from "./nav-link";

function HeaderFrame({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center gap-x-8 px-6">
        <Link href="/" className="py-3">
          <Wordmark className="text-xl" />
        </Link>
        {children}
      </div>
    </header>
  );
}

/** Shown while the signed-in user is being looked up. */
export function AppHeaderFallback() {
  return <HeaderFrame />;
}

export async function AppHeader() {
  const user = await getCurrentUser();
  const t = await getTranslations("nav");

  if (!user) {
    return <HeaderFrame />;
  }

  return (
    <HeaderFrame>
      <nav aria-label={t("main")} className="flex items-center gap-5">
        <NavLink href="/" exact>
          {t("dashboard")}
        </NavLink>
        {user.role === "ADMIN" ? <NavLink href="/admin/users">{t("users")}</NavLink> : null}
      </nav>
      <div className="ml-auto flex items-center gap-5">
        <NavLink href="/settings">
          <span className="sr-only">{t("signedInAs", { username: user.username })}. </span>
          <span aria-hidden="true">{user.username}</span>
          <span className="sr-only">{t("settings")}</span>
        </NavLink>
        <form action={signOutAction}>
          <button
            type="submit"
            className="cursor-pointer py-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("signOut")}
          </button>
        </form>
      </div>
    </HeaderFrame>
  );
}
