import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * An early, cheap redirect, not the security boundary.
 *
 * Proxy runs before every matched request, so it only looks at whether a session COOKIE exists (no database): a visitor with
 * no cookie is sent to Log in before anything renders. The real checks are made next to the data: every page, layout
 * and server action asks `resolveWorkspace()`, which validates the session in the database and the membership, and
 * PostgreSQL's Row Level Security checks it once more. A forged or expired cookie passes this file and is stopped there.
 *
 * Left alone on purpose: the auth endpoints, the Log in and Sign up pages (a cookie that no longer maps to a session must
 * still be able to reach them, or the person would be bounced between pages forever; the pages themselves send a truly
 * signed-in visitor on), and the PUBLISHED websites (/sites/<address>) and Marketplace listings (/listings/<address>), which must stay
 * reachable without a Climvia account. Those pages resolve the business from the public address on the server and show published
 * content only. The signed-in previews of a Draft (/website/preview, /marketplace/preview) are NOT public: they need a session cookie
 * here and a verified membership in the page.
 */
const PUBLIC_PREFIXES = ["/api/auth", "/sites", "/listings"];
const AUTH_PAGES = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (AUTH_PAGES.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return NextResponse.next();
  if (hasSession) return NextResponse.next();

  const login = new URL("/login", request.url);
  // Remember where they were going, but only ever a path on this site.
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own assets and files with an extension (icon.svg, fonts).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.[a-zA-Z0-9]+$).*)"],
};
