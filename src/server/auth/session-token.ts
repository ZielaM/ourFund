import { createHash, randomBytes } from "node:crypto";

/** 256 bits of randomness, safe to put in a cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored, so a leaked database does not reveal usable session tokens. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
