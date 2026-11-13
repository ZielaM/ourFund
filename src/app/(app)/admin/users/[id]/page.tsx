import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { UserAccessForm } from "@/components/admin/user-access-form";
import { PasswordForm } from "@/components/auth/password-form";
import { PageTitle } from "@/components/layout/page-title";
import { Badge } from "@/components/ui/badge";
import { findUser } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { resetUserPasswordAction, setUserDisabledAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: t("title") };
}

export default async function UserPage({ params }: PageProps<"/admin/users/[id]">) {
  const actor = await requireAdmin();
  const { id } = await params;
  const user = await findUser(getDb(), actor, id);

  if (!user) {
    notFound();
  }

  const t = await getTranslations("users");
  const tRoles = await getTranslations("roles");
  const isOwnAccount = user.id === actor.id;

  return (
    <>
      <Link
        href="/admin/users"
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        {t("detail.back")}
      </Link>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <PageTitle>{user.username}</PageTitle>
        <p className="flex items-center gap-3 pb-2 text-sm text-muted-foreground">
          {tRoles(user.role)}
          <Badge variant={user.disabled ? "destructive" : "secondary"}>
            {user.disabled ? t("status.disabled") : t("status.active")}
          </Badge>
        </p>
      </div>

      {isOwnAccount ? (
        <p className="mt-10 max-w-prose">
          {t("detail.ownAccount")}{" "}
          <Link href="/settings" className="underline underline-offset-4">
            {t("detail.goToSettings")}
          </Link>
        </p>
      ) : (
        <>
          <section aria-labelledby="access-title" className="mt-10 flex max-w-prose flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="access-title" className="text-xl font-semibold">
                {t("detail.access.title")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {user.disabled ? t("detail.access.disabledBody") : t("detail.access.activeBody")}
              </p>
            </div>
            <UserAccessForm
              action={setUserDisabledAction.bind(null, user.id, !user.disabled)}
              submitLabel={user.disabled ? t("detail.access.enable") : t("detail.access.disable")}
              destructive={!user.disabled}
            />
          </section>

          <section aria-labelledby="password-title" className="mt-12 flex max-w-sm flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="password-title" className="text-xl font-semibold">
                {t("detail.password.title")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("detail.password.intro")}</p>
            </div>
            <PasswordForm
              action={resetUserPasswordAction.bind(null, user.id)}
              submitLabel={t("detail.password.submit")}
            />
          </section>
        </>
      )}
    </>
  );
}
