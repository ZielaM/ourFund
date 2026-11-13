import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formFailed, formSucceeded, idleFormState } from "@/lib/form-state";
import { renderWithIntl } from "@/test/render";
import { FormResult } from "./form-result";

describe("FormResult", () => {
  it("renders nothing before the form is submitted", () => {
    const { container } = renderWithIntl(<FormResult state={idleFormState} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when only fields have errors", () => {
    const { container } = renderWithIntl(
      <FormResult state={{ status: "error", fieldErrors: { username: "required" } }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("announces a form error", () => {
    renderWithIntl(<FormResult state={formFailed("auth.invalidCredentials")} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nieprawidłowa nazwa użytkownika lub hasło.",
    );
  });

  it.each([
    [1, "za 1 minutę."],
    [3, "za 3 minuty."],
    [15, "za 15 minut."],
    [22, "za 22 minuty."],
  ])("uses the right Polish plural for %i minute(s)", (minutes, ending) => {
    renderWithIntl(<FormResult state={formFailed("auth.locked", { params: { minutes } })} />);

    expect(screen.getByRole("alert")).toHaveTextContent(ending);
  });

  it("falls back to a general message for an unknown error code", () => {
    renderWithIntl(<FormResult state={formFailed("something.unexpected")} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Coś poszło nie tak. Spróbuj ponownie.");
  });

  it("confirms a successful submission", () => {
    renderWithIntl(<FormResult state={formSucceeded("users.created", { username: "ania" })} />);

    expect(screen.getByRole("status")).toHaveTextContent("Konto ania zostało utworzone.");
  });
});
