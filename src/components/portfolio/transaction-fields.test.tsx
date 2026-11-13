import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithIntl } from "@/test/render";
import { TransactionFields, type TransactionFormValues } from "./transaction-fields";

const accounts = [
  { id: "account-1", name: "XTB" },
  { id: "account-2", name: "IKE" },
];
const instruments = [
  { id: "cdr", symbol: "CDR", name: "CD Projekt", currency: "PLN" },
  { id: "aapl", symbol: "AAPL", name: "Apple", currency: "USD" },
];
const currencies = ["PLN", "EUR", "USD"];

function renderFields(initial: TransactionFormValues = {}, lockAccount = false) {
  return renderWithIntl(
    <TransactionFields
      accounts={accounts}
      instruments={instruments}
      currencies={currencies}
      initial={{ type: "BUY", accountId: "account-1", date: "2026-01-10", ...initial }}
      lockAccount={lockAccount}
    />,
  );
}

const labels = () =>
  [...document.querySelectorAll("label")].map((label) => label.textContent ?? "");

describe("TransactionFields", () => {
  it("shows the trade fields for a purchase", () => {
    renderFields();

    expect(labels()).toEqual([
      "Typ transakcji",
      "Rachunek",
      "Data",
      "Instrument",
      "Liczba",
      "Cena za sztukę",
      "Waluta rozliczenia",
      "Prowizja (PLN)",
      "Notatka",
    ]);
  });

  it.each([
    ["Dywidenda", ["Instrument", "Kwota brutto", "Podatek pobrany u źródła", "Waluta"]],
    ["Odsetki", ["Instrument", "Kwota brutto", "Podatek pobrany u źródła", "Waluta"]],
    ["Wpłata", ["Kwota", "Waluta"]],
    ["Wypłata", ["Kwota", "Waluta"]],
    ["Opłata", ["Kwota", "Waluta"]],
    ["Split", ["Instrument", "Stosunek podziału"]],
  ])("shows only the fields that apply to: %s", async (type, expected) => {
    renderFields();

    await userEvent.selectOptions(screen.getByLabelText("Typ transakcji"), type);

    expect(labels()).toEqual(["Typ transakcji", "Rachunek", "Data", ...expected, "Notatka"]);
  });

  it("offers interest without an instrument", async () => {
    renderFields();

    await userEvent.selectOptions(screen.getByLabelText("Typ transakcji"), "Odsetki");

    expect(
      screen.getByRole("option", { name: "Bez instrumentu (odsetki od gotówki)" }),
    ).toBeInTheDocument();
  });

  it("names the instrument's currency in the price label and settles in it by default", async () => {
    renderFields();

    await userEvent.selectOptions(screen.getByLabelText("Instrument"), "AAPL (Apple)");

    expect(screen.getByLabelText("Cena za sztukę (USD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Waluta rozliczenia")).toHaveValue("USD");
    expect(screen.getByLabelText("Prowizja (USD)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Kurs przewalutowania")).not.toBeInTheDocument();
  });

  it("asks for the conversion rate only when the account paid in another currency", async () => {
    renderFields();
    await userEvent.selectOptions(screen.getByLabelText("Instrument"), "AAPL (Apple)");

    await userEvent.selectOptions(screen.getByLabelText("Waluta rozliczenia"), "PLN");

    expect(screen.getByLabelText("Kurs przewalutowania")).toHaveAccessibleDescription(
      "Ile PLN kosztowała 1 jednostka USD.",
    );
    expect(screen.getByLabelText("Prowizja (PLN)")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Waluta rozliczenia"), "USD");

    expect(screen.queryByLabelText("Kurs przewalutowania")).not.toBeInTheDocument();
  });

  it("starts with the stored values when editing", () => {
    renderFields(
      {
        type: "SELL",
        accountId: "account-2",
        instrumentId: "aapl",
        quantity: "2",
        price: "150,5",
        fee: "8",
        currency: "PLN",
        fxRate: "4,05",
        note: "realizacja zysku",
      },
      true,
    );

    expect(screen.getByLabelText("Typ transakcji")).toHaveValue("SELL");
    expect(screen.getByLabelText("Instrument")).toHaveValue("aapl");
    expect(screen.getByLabelText("Liczba")).toHaveValue("2");
    expect(screen.getByLabelText("Cena za sztukę (USD)")).toHaveValue("150,5");
    expect(screen.getByLabelText("Waluta rozliczenia")).toHaveValue("PLN");
    expect(screen.getByLabelText("Kurs przewalutowania")).toHaveValue("4,05");
    expect(screen.getByLabelText("Notatka")).toHaveValue("realizacja zysku");
  });

  it("locks the account when editing but still submits it", () => {
    const { container } = renderFields({ accountId: "account-2" }, true);

    expect(screen.getByLabelText("Rachunek")).toBeDisabled();
    expect(container.querySelector('input[type="hidden"][name="accountId"]')).toHaveValue(
      "account-2",
    );
  });

  it("lets the account be chosen for a new transaction", () => {
    const { container } = renderFields();

    expect(screen.getByLabelText("Rachunek")).toBeEnabled();
    expect(container.querySelector('input[type="hidden"][name="accountId"]')).toBeNull();
  });
});
