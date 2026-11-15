import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/submit-button";
import { DataTable } from "@/components/layout/data-table";
import { PageTitle } from "@/components/layout/page-title";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeSplitRatio } from "@/domain/events/suggestions";
import { formatDate, formatMoney, formatQuantity, toInputValue } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getEventSuggestions, type EventSuggestionView } from "@/server/events/event-suggestions";
import { getPortfolio } from "@/server/portfolio/portfolios";
import { dismissEventAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("events");
  return { title: t("title") };
}

/** The new-transaction form, filled in with what the suggestion knows. */
function recordHref(
  portfolioId: string,
  { account, instrument, suggestion, suggestedTax }: EventSuggestionView,
) {
  const params = new URLSearchParams({
    accountId: account.id,
    instrumentId: instrument.id,
    date: suggestion.date,
  });

  if (suggestion.type === "SPLIT") {
    params.set("type", "SPLIT");
    params.set("splitRatio", toInputValue(suggestion.ratio));
  } else {
    params.set("type", "DIVIDEND");
    params.set("amount", toInputValue(suggestion.amount.toDecimalPlaces(2)));
    params.set("currency", instrument.currency);
    if (suggestedTax?.gt(0)) {
      params.set("tax", toInputValue(suggestedTax));
    }
  }

  return `/portfolios/${portfolioId}/transactions/new?${params}`;
}

export default async function PortfolioEventsPage({
  params,
}: PageProps<"/portfolios/[id]/events">) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const [portfolio, suggestions] = await Promise.all([
    getPortfolio(db, user, id),
    getEventSuggestions(db, user, id),
  ]);
  if (!portfolio || !suggestions) {
    notFound();
  }

  const t = await getTranslations("events");
  const portfolioHref = `/portfolios/${portfolio.id}`;
  const hasSplit = suggestions.some(({ suggestion }) => suggestion.type === "SPLIT");

  return (
    <>
      <Link
        href={portfolioHref}
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        {portfolio.name}
      </Link>
      <div className="mt-4">
        <PageTitle>{t("title")}</PageTitle>
      </div>
      <p className="mt-6 max-w-prose text-muted-foreground">{t("intro")}</p>

      {suggestions.length === 0 ? (
        <p className="mt-10">{t("empty")}</p>
      ) : (
        <section className="mt-10 flex flex-col gap-4">
          {hasSplit ? <p className="max-w-prose text-sm">{t("splitsFirst")}</p> : null}
          <DataTable>
            <Table>
              <TableCaption className="sr-only">{t("table.caption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.date")}</TableHead>
                  <TableHead>{t("table.account")}</TableHead>
                  <TableHead>{t("table.instrument")}</TableHead>
                  <TableHead>{t("table.event")}</TableHead>
                  <TableHead className="text-right">{t("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suggestions.map((view) => {
                  const { account, instrument, suggestion } = view;
                  const label = t(`describe.${suggestion.type}`, {
                    symbol: instrument.symbol,
                    account: account.name,
                    date: formatDate(suggestion.date),
                  });

                  return (
                    <TableRow key={view.key}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(suggestion.date)}
                      </TableCell>
                      <TableCell>{account.name}</TableCell>
                      <TableCell>
                        <span className="font-medium">{instrument.symbol}</span>{" "}
                        <span className="hidden text-muted-foreground sm:inline">
                          {instrument.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        {suggestion.type === "SPLIT" ? (
                          <>
                            <span className="font-medium">
                              {t("split", { ratio: describeSplitRatio(suggestion.ratio) })}
                            </span>
                            <span className="block text-sm text-muted-foreground">
                              {t("splitDetail", {
                                before: formatQuantity(suggestion.quantity),
                                after: formatQuantity(suggestion.quantity.times(suggestion.ratio)),
                              })}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-medium">
                              {t("dividend", {
                                amount: formatMoney(suggestion.amount, instrument.currency),
                              })}
                            </span>
                            <span className="block text-sm text-muted-foreground">
                              {t("dividendDetail", {
                                quantity: formatQuantity(suggestion.quantity),
                                perUnit: formatMoney(suggestion.perUnit, instrument.currency),
                              })}
                            </span>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-4">
                          <Link
                            href={recordHref(portfolio.id, view)}
                            aria-label={t("recordLabel", { label })}
                            className="text-sm font-medium underline underline-offset-4"
                          >
                            {t("record")}
                          </Link>
                          <ActionForm
                            action={dismissEventAction.bind(
                              null,
                              portfolio.id,
                              account.id,
                              suggestion.eventId,
                            )}
                          >
                            <SubmitButton
                              variant="ghost"
                              className="h-8 px-2"
                              aria-label={t("dismissLabel", { label })}
                            >
                              {t("dismiss")}
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTable>
          <p className="max-w-prose text-sm text-muted-foreground">{t("disclaimer")}</p>
        </section>
      )}
    </>
  );
}
