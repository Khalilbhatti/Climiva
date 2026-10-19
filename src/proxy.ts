import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { classifyHost } from "@/lib/hostname";
import { hostConfig } from "@/lib/domain-config";

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
 * reachable without a Climvia account, and the logos they draw (/assets/<id>, which serves only a logo a business has chosen: the route asks
 * the database, not this file). Those pages resolve the business from the public address on the server and show published
 * content only. The signed-in previews of a Draft (/website/preview, /marketplace/preview) are NOT public: they need a session cookie
 * here and a verified membership in the page.
 *
 * The first thing it does is look at the HOST, and only the `Host` header (`Forwarded` and `X-Forwarded-Host` are sent by whoever makes the
 * request, so they choose nothing). A name that is the platform's own (its domain, APP_HOSTS, `localhost`, an IP address) goes on to the rules
 * above. Any other name is a customer's domain, or nothing: the request is rewritten (the address in the browser does not change) to the one
 * route that serves a customer's site, `/custom-site`, where the database says whether the name is active. A customer's domain therefore
 * never reaches the workspace, the sign-in pages or any API: `/settings`, `/login` and `/api/branding` there are only pages the site does
 * not have. The one path passed through as it is is `/assets/<id>`, the public logo, which asks the database itself and ignores the host.
 * A Host that is not a name at all is refused.
 *
 * Also left alone on the platform's names: `/health/*` (the process answers "I am alive" and "I can serve": no session, no data) and
 * `/internal/tls-allow` (the reverse proxy asks whether a certificate may be requested for a name; it is refused without its secret, and the proxy
 * does not forward it to the public). On a customer's name neither exists: those paths take the rewrite above like any other.
 */
const PUBLIC_PREFIXES = ["/api/auth", "/sites", "/listings", "/assets", "/health", "/internal/tls-allow"];
const AUTH_PAGES = ["/login", "/signup"];

/** Where a customer's domain is served from. */
const CUSTOM_SITE = "/custom-site";

/** The platform console (Climvia's own administration) and its sign-in page. On a customer's domain these are just paths the site does not have. */
const PLATFORM_ROOT = "/platform-admin";
const PLATFORM_LOGIN = "/platform-admin/login";

/** A path that ends in a file extension is never a page. */
const FILE = /\.[a-zA-Z0-9]+$/;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const host = classifyHost(request.headers.get("host"), hostConfig());
  if (host === "refuse") return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  if (host === "custom") {
    if (pathname.startsWith("/assets/")) return NextResponse.next();
    const target = request.nextUrl.clone();
    target.pathname = `${CUSTOM_SITE}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(target);
  }

  // On the platform's own names a file path (an icon, a font) was never this file's business and still is not: it goes straight on. It is handled
  // here, and not left out of the matcher, because on a customer's domain EVERY path must pass the check above.
  if (FILE.test(pathname)) return NextResponse.next();

  const hasSession = Boolean(getSessionCookie(request));

  // The platform console has its own sign-in page, and a visitor without a session is sent THERE, not to the workspace's. This is only the early,
  // cheap redirect: whether a signed-in person is a platform administrator is decided by every console page, layout and action against the database.
  if (pathname === PLATFORM_LOGIN) return NextResponse.next();
  if (pathname === PLATFORM_ROOT || pathname.startsWith(`${PLATFORM_ROOT}/`)) {
    return hasSession ? NextResponse.next() : NextResponse.redirect(new URL(PLATFORM_LOGIN, request.url));
  }

  if (AUTH_PAGES.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return NextResponse.next();
  if (hasSession) return NextResponse.next();

  // A script calling the application's own endpoints (the Branding upload) is told it is signed out, not sent a login page to parse.
  if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "Your session has ended. Log in again." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const login = new URL("/login", request.url);
  // Remember where they were going, but only ever a path on this site.
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own assets and the two icons. (Other file paths are looked at too: see the customer's-domain check above.)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
