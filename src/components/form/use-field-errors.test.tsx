import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import messages from "@/i18n/messages/pl.json";
import { idleFormState, type FormState } from "@/lib/form-state";
import { useFieldState } from "./use-field-errors";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {children}
    </NextIntlClientProvider>
  );
}

const fieldState = (state: FormState) =>
  renderHook(() => useFieldState(state), { wrapper }).result.current;

describe("useFieldState", () => {
  it("has no errors or values for an untouched form", () => {
    const field = fieldState(idleFormState);

    expect(field.error("username")).toBeUndefined();
    expect(field.value("username")).toBeUndefined();
  });

  it("translates field errors, filling in the password limits", () => {
    const field = fieldState({
      status: "error",
      fieldErrors: { password: "password.tooShort", username: "username.taken" },
    });

    expect(field.error("password")).toBe("Hasło musi mieć co najmniej 10 znaków.");
    expect(field.error("username")).toBe("Ta nazwa użytkownika jest już zajęta.");
    expect(field.error("passwordConfirmation")).toBeUndefined();
  });

  it("returns the values to put back into the form", () => {
    const field = fieldState({ status: "error", values: { username: "ania" } });

    expect(field.value("username")).toBe("ania");
    expect(field.value("password")).toBeUndefined();
  });

  it("has nothing to restore after a successful submission", () => {
    const field = fieldState({ status: "success", message: "password.changed" });

    expect(field.error("password")).toBeUndefined();
    expect(field.value("username")).toBeUndefined();
  });
});
