import "server-only";

/**
 * Whether a state-changing request came from this application's own pages.
 *
 * A Server Action gets this check from the framework; a Route Handler does not, and the upload is one. The browser sends an `Origin` on every
 * POST it makes from a page, so a request that has none, or has one that is not this site's, is not a page of this application submitting
 * its own form. The session cookie is SameSite=Lax as well, so a page on another site cannot even send it on such a POST; this is the second
 * layer, and it is the one that does not depend on a cookie setting.
 *
 * The site's own host is the request's `Host` (or the proxy's `X-Forwarded-Host`), the configured public origin, and any origins listed in
 * AUTH_TRUSTED_ORIGINS, which is the same list the sign-in endpoints trust. `Sec-Fetch-Site`, where the browser sends it, must say the
 * request is from the same origin.
 */
export function isSameOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const allowed = new Set<string>();
  for (const value of [request.headers.get("host"), request.headers.get("x-forwarded-host")]) if (value) allowed.add(value.split(",")[0].trim());
  for (const value of [env.BETTER_AUTH_URL, ...(env.AUTH_TRUSTED_ORIGINS ?? "").split(",")]) {
    if (!value?.trim()) continue;
    try {
      allowed.add(new URL(value.trim()).host);
    } catch {
      // a malformed entry trusts nothing
    }
  }
  return allowed.has(host);
}
