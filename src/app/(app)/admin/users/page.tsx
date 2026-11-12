import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { NewAccountForm } from "@/components/auth/new-account-form";
import { PageTitle } from "@/components/layout/page-title";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listUsers } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { createUserAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: t("title") };
}

export default async function UsersPage() {
  const actor = await requireAdmin();
  const users = await listUsers(getDb(), actor);
  const t = await getTranslations("users");
  const tRoles = await getTranslations("roles");
  const format = await getFormatter();

  return (
    <>
      <PageTitle>{t("title")}</PageTitle>
      <p className="mt-6 max-w-prose text-sm text-muted-foreground">{t("intro")}</p>

      <div className="mt-8 rounded-lg border bg-card">
        <Table>
          <TableCaption className="sr-only">{t("table.caption")}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.username")}</TableHead>
              <TableHead>{t("table.role")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.createdAt")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("table.manage")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {user.username}
                  {user.id === actor.id ? (
                    <span className="font-normal text-muted-foreground"> ({t("table.you")})</span>
                  ) : null}
                </TableCell>
                <TableCell>{tRoles(user.role)}</TableCell>
                <TableCell>
                  <Badge variant={user.disabled ? "destructive" : "secondary"}>
                    {user.disabled ? t("status.disabled") : t("status.active")}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">
                  {format.dateTime(user.createdAt, { dateStyle: "medium" })}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/admin/users/${user.id}`}
                    aria-label={t("table.manageUser", { username: user.username })}
                    className="underline underline-offset-4"
                  >
                    {t("table.manage")}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <section aria-labelledby="create-title" className="mt-12 flex max-w-sm flex-col gap-5">
        <h2 id="create-title" className="text-xl font-semibold">
          {t("create.title")}
        </h2>
        <NewAccountForm action={createUserAction} submitLabel={t("create.submit")} withRole />
      </section>
    </>
  );
}
