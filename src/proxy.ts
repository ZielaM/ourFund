import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";

const PUBLIC_PATHS = new Set(["/login", "/setup", "/register"]);

/**
 * A quick first check: visitors without a session cookie go straight to the sign-in page.
 * This is a convenience only. Whether the session is actually valid is checked on the server
 * by every page and action (see `requireUser`).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";

  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except the health endpoint, Next.js internals and static files.
  matcher: ["/((?!api/health|_next/|icon.svg|robots.txt|favicon.ico).*)"],
};
