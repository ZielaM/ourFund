import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavLink } from "./nav-link";

const pathname = vi.fn<() => string>();

vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

describe("NavLink", () => {
  beforeEach(() => {
    pathname.mockReturnValue("/");
  });

  it("marks the link to the current page", () => {
    pathname.mockReturnValue("/settings");
    render(<NavLink href="/settings">Ustawienia</NavLink>);

    expect(screen.getByRole("link", { name: "Ustawienia" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("stays marked on pages below the link", () => {
    pathname.mockReturnValue("/admin/users/123");
    render(<NavLink href="/admin/users">Użytkownicy</NavLink>);

    expect(screen.getByRole("link")).toHaveAttribute("aria-current", "page");
  });

  it("is not marked on other pages", () => {
    pathname.mockReturnValue("/settings");
    render(<NavLink href="/admin/users">Użytkownicy</NavLink>);

    expect(screen.getByRole("link")).not.toHaveAttribute("aria-current");
  });

  it("does not confuse paths that merely start with the same letters", () => {
    pathname.mockReturnValue("/settings-archive");
    render(<NavLink href="/settings">Ustawienia</NavLink>);

    expect(screen.getByRole("link")).not.toHaveAttribute("aria-current");
  });

  it("can also cover other sections", () => {
    pathname.mockReturnValue("/portfolios/123/settings");
    render(
      <NavLink href="/" exact alsoActiveUnder={["/portfolios"]}>
        Pulpit
      </NavLink>,
    );

    expect(screen.getByRole("link")).toHaveAttribute("aria-current", "page");
  });

  it("with `exact`, is marked only on the exact path", () => {
    pathname.mockReturnValue("/settings");
    render(
      <NavLink href="/" exact>
        Pulpit
      </NavLink>,
    );
    expect(screen.getByRole("link")).not.toHaveAttribute("aria-current");

    pathname.mockReturnValue("/");
    render(
      <NavLink href="/" exact>
        Pulpit (bieżący)
      </NavLink>,
    );
    expect(screen.getByRole("link", { name: "Pulpit (bieżący)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
