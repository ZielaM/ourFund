import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { renderWithIntl } from "@/test/render";
import { Statement } from "./statement";

describe("Statement", () => {
  it("lists each figure next to its label", () => {
    renderWithIntl(
      <Statement
        rows={[
          { label: "Przychód", value: new Decimal("1500") },
          { label: "Podatek 19%", value: new Decimal("93"), total: true },
        ]}
      />,
    );

    const terms = screen.getAllByRole("term").map((term) => term.textContent);
    const amounts = screen
      .getAllByRole("definition")
      .map((amount) => amount.textContent?.replace(/\s/g, " "));

    expect(terms).toEqual(["Przychód", "Podatek 19%"]);
    expect(amounts).toEqual(["1 500,00 zł", "93,00 zł"]);
  });

  it("says that a rate is missing instead of showing a made-up amount", () => {
    renderWithIntl(<Statement rows={[{ label: "Przychód", value: null }]} />);

    expect(screen.getByRole("definition")).toHaveTextContent("brak kursu");
  });

  it("shows the note that explains the figures", () => {
    renderWithIntl(
      <Statement rows={[{ label: "Do zapłaty", value: new Decimal("16"), total: true }]}>
        <p>Objaśnienie</p>
      </Statement>,
    );

    expect(screen.getByText("Objaśnienie")).toBeInTheDocument();
  });
});
