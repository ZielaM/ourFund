import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormField } from "./form-field";

describe("FormField", () => {
  it("connects the label with the input", () => {
    render(<FormField name="username" label="Nazwa użytkownika" />);

    expect(screen.getByLabelText("Nazwa użytkownika")).toHaveAttribute("name", "username");
  });

  it("describes the input with its hint", () => {
    render(<FormField name="password" label="Hasło" hint="Co najmniej 10 znaków." />);

    const input = screen.getByLabelText("Hasło");
    expect(input).toHaveAccessibleDescription("Co najmniej 10 znaków.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("shows the error instead of the hint and marks the input as invalid", () => {
    render(
      <FormField
        name="password"
        label="Hasło"
        hint="Co najmniej 10 znaków."
        error="Hasło musi mieć co najmniej 10 znaków."
      />,
    );

    const input = screen.getByLabelText("Hasło");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Hasło musi mieć co najmniej 10 znaków.");
    expect(screen.queryByText("Co najmniej 10 znaków.")).not.toBeInTheDocument();
  });

  it("has no description when there is neither a hint nor an error", () => {
    render(<FormField name="username" label="Nazwa użytkownika" />);

    expect(screen.getByLabelText("Nazwa użytkownika")).not.toHaveAttribute("aria-describedby");
  });

  it("passes other attributes to the input", () => {
    render(<FormField name="password" label="Hasło" type="password" autoComplete="new-password" />);

    const input = screen.getByLabelText("Hasło");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
  });
});
