import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { SignedMoney } from "./signed-money";

const text = (value: string) => {
  const { container } = render(<SignedMoney value={new Decimal(value)} currency="PLN" />);
  return container.textContent?.replace(/[  ]/g, " ");
};

describe("SignedMoney", () => {
  it("marks a gain with a plus sign and the gain colour", () => {
    expect(text("1234.5")).toBe("+1 234,50 zł");
    expect(screen.getByText(/1.234,50/)).toHaveClass("text-gain");
  });

  it("marks a loss with a minus sign and the loss colour", () => {
    expect(text("-80")).toBe("-80,00 zł");
    expect(screen.getByText(/80,00/)).toHaveClass("text-loss");
  });

  it("shows zero without a sign or a colour", () => {
    expect(text("0")).toBe("0,00 zł");
    expect(screen.getByText(/0,00/)).not.toHaveClass("text-gain", "text-loss");
  });
});
