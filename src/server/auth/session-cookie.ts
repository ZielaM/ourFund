export const SESSION_COOKIE = "ourfund_session";

type HeaderReader = { get(name: string): string | null };

/**
 * Self-hosted instances are often opened over plain HTTP on a home network, where a
 * `Secure` cookie would never be stored. The flag is therefore set only when the request
 * arrived over HTTPS (directly or through a reverse proxy).
 */
export function isSecureRequest(headers: HeaderReader): boolean {
  const forwardedProto = headers.get("x-forwarded-proto");
  return forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https";
}

export function sessionCookieOptions(expiresAt: Date, secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: expiresAt,
  } as const;
}
