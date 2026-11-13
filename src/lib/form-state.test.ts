import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  formFailed,
  formSucceeded,
  idleFormState,
  textField,
  validationFailed,
} from "./form-state";

describe("validationFailed", () => {
  const schema = z.object({
    username: z
      .string()
      .min(3, "username.invalid")
      .regex(/^[a-z]+$/, "username.letters"),
    password: z.string().min(1, "required"),
  });

  it("keeps the first message for each field", () => {
    const result = schema.safeParse({ username: "A", password: "" });
    if (result.success) throw new Error("expected a validation error");

    expect(validationFailed(result.error)).toEqual({
      status: "error",
      fieldErrors: { username: "username.invalid", password: "required" },
      values: undefined,
    });
  });

  it("returns the values that should be put back into the form", () => {
    const result = schema.safeParse({ username: "ania", password: "" });
    if (result.success) throw new Error("expected a validation error");

    expect(validationFailed(result.error, { username: "ania" })).toMatchObject({
      values: { username: "ania" },
    });
  });

  it("ignores problems that are not tied to a field", () => {
    const result = z.string().safeParse(5);
    if (result.success) throw new Error("expected a validation error");

    expect(validationFailed(result.error)).toMatchObject({ fieldErrors: {} });
  });
});

describe("formFailed", () => {
  it("builds a form-level error", () => {
    expect(formFailed("auth.invalidCredentials")).toEqual({
      status: "error",
      formError: "auth.invalidCredentials",
      formErrorParams: undefined,
      values: undefined,
    });
  });

  it("carries message parameters and form values", () => {
    expect(
      formFailed("auth.locked", { params: { minutes: 7 }, values: { username: "ania" } }),
    ).toEqual({
      status: "error",
      formError: "auth.locked",
      formErrorParams: { minutes: 7 },
      values: { username: "ania" },
    });
  });
});

describe("formSucceeded", () => {
  it("builds a success message with its parameters", () => {
    expect(formSucceeded("users.created", { username: "ania" })).toEqual({
      status: "success",
      message: "users.created",
      messageParams: { username: "ania" },
    });
  });
});

describe("textField", () => {
  it("reads a text value", () => {
    const formData = new FormData();
    formData.set("username", "ania");

    expect(textField(formData, "username")).toBe("ania");
  });

  it("returns an empty string for a missing field", () => {
    expect(textField(new FormData(), "username")).toBe("");
  });

  it("returns an empty string for an uploaded file", () => {
    const formData = new FormData();
    formData.set("username", new Blob(["x"]), "file.txt");

    expect(textField(formData, "username")).toBe("");
  });
});

describe("idleFormState", () => {
  it("is the starting state of every form", () => {
    expect(idleFormState).toEqual({ status: "idle" });
  });
});
