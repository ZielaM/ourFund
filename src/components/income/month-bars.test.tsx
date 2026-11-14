import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MonthBars } from "./month-bars";

function renderBars() {
  render(
    <MonthBars
      bars={[
        { label: "sty", name: "styczeń", value: 0 },
        { label: "lut", name: "luty", value: 1234.5 },
        { label: "mar", name: "marzec", value: null },
      ]}
      description="Dywidendy netto w kolejnych miesiącach."
      valueLabel="Kwota netto"
      periodLabel="Miesiąc"
      tableLabel="Pokaż dane w tabeli"
      unknownLabel="brak kursu"
    />,
  );
}

const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell", { hidden: true })
    .map((cell) => cell.textContent?.replace(/\s/g, " "));

describe("MonthBars", () => {
  it("names the chart by its description", () => {
    renderBars();

    expect(
      screen.getByRole("img", { name: "Dywidendy netto w kolejnych miesiącach." }),
    ).toBeDefined();
    expect(screen.getByText("Pokaż dane w tabeli")).toBeInTheDocument();
  });

  it("offers the same data as a table, month by month", () => {
    renderBars();

    const rows = screen.getAllByRole("row", { hidden: true });
    expect(rows).toHaveLength(4);
    expect(cells(rows[1])).toEqual(["styczeń", "0,00 zł"]);
    expect(cells(rows[2])).toEqual(["luty", "1 234,50 zł"]);
  });

  it("says when an amount could not be computed", () => {
    renderBars();

    const rows = screen.getAllByRole("row", { hidden: true });
    expect(cells(rows[3])).toEqual(["marzec", "brak kursu"]);
  });
});
