import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_NAME, REPOSITORY_URL } from "@/config/app";
import { renderWithIntl } from "@/test/render";
import HomePage from "./page";

describe("HomePage", () => {
  it("shows the application name as the main heading", () => {
    renderWithIntl(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: APP_NAME })).toBeInTheDocument();
  });

  it("lists the planned features", () => {
    renderWithIntl(<HomePage />);

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText(/IKE, IKZE i OKI/)).toBeInTheDocument();
  });

  it("links to the source code", () => {
    renderWithIntl(<HomePage />);

    expect(screen.getByRole("link", { name: "Kod źródłowy" })).toHaveAttribute(
      "href",
      REPOSITORY_URL,
    );
  });
});
