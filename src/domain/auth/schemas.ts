import { z } from "zod";
import { normalizeUsername, USERNAME_PATTERN } from "./username";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

// Validation messages are error codes; the UI translates them (see `errors` in the messages file).
const requiredText = z.string("required").min(1, "required");

const username = z
  .string("required")
  .transform(normalizeUsername)
  .pipe(z.string().min(1, "required").regex(USERNAME_PATTERN, "username.invalid"));

const newPassword = z
  .string("required")
  .min(PASSWORD_MIN_LENGTH, "password.tooShort")
  .max(PASSWORD_MAX_LENGTH, "password.tooLong");

const confirmation = {
  path: ["passwordConfirmation"],
  message: "passwordConfirmation.mismatch",
};

function passwordsMatch(data: { password: string; passwordConfirmation: string }): boolean {
  return data.password === data.passwordConfirmation;
}

export const signInSchema = z.object({
  username: z.string("required").transform(normalizeUsername).pipe(requiredText),
  password: requiredText,
});

export const newAccountSchema = z
  .object({
    username,
    password: newPassword,
    passwordConfirmation: z.string("required"),
  })
  .refine(passwordsMatch, confirmation);

export const newAccountWithRoleSchema = z
  .object({
    username,
    password: newPassword,
    passwordConfirmation: z.string("required"),
    role: z.enum(["ADMIN", "USER"], "required"),
  })
  .refine(passwordsMatch, confirmation);

export const changePasswordSchema = z
  .object({
    currentPassword: requiredText,
    password: newPassword,
    passwordConfirmation: z.string("required"),
  })
  .refine(passwordsMatch, confirmation);

export const setPasswordSchema = z
  .object({
    password: newPassword,
    passwordConfirmation: z.string("required"),
  })
  .refine(passwordsMatch, confirmation);

export type SignInInput = z.infer<typeof signInSchema>;
export type NewAccountInput = z.infer<typeof newAccountSchema>;
export type NewAccountWithRoleInput = z.infer<typeof newAccountWithRoleSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
