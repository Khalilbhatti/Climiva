/**
 * What the environment says about domains. Read here and nowhere else.
 *
 *   APP_HOSTS                comma-separated names this application is served on besides the host of BETTER_AUTH_URL (`app.example.com`). The
 *                            host of BETTER_AUTH_URL is always one. Each name and everything beneath it is the platform's and can not be claimed;
 *                            every other multi-label name is treated as a customer's domain, so a name the deployment answers on must be listed or
 *                            it is refused. Single-label names (`localhost`, a container name) and IP addresses are always the platform's. (A
 *                            deployment that later owns a domain for its Sites lists it here; Sites are written as `<origin>/sites/<slug>` today.)
 *   CUSTOM_DOMAIN_TARGET     the name customers point their DNS at (`sites.example.com`): shown in the routing instructions, and never claimable.
 *   CUSTOM_DOMAIN_URL_SCHEME `https` (the default; a custom domain is served over TLS) or `http` for local development and the tests.
 *
 * No `server-only` import on purpose: the proxy and the specs read it too. No credentials are read or written here.
 */
import { normalizeHostname, type HostConfig } from "@/lib/hostname";
import type { SiteAddressing } from "@/lib/site-domain";

type Env = Record<string, string | undefined>;

function names(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const result = normalizeHostname(part);
      return result.ok ? [result.hostname] : [];
    });
}

function hostOfUrl(value: string | undefined): string[] {
  if (!value) return [];
  try {
    return names(new URL(value).hostname);
  } catch {
    return [];
  }
}

export function hostConfig(env: Env = process.env): HostConfig {
  return {
    appHosts: [...names(env.APP_HOSTS), ...hostOfUrl(env.BETTER_AUTH_URL)],
    customDomainTarget: names(env.CUSTOM_DOMAIN_TARGET)[0] ?? null,
  };
}

/** The scheme a canonical address on a custom domain uses. */
export function canonicalScheme(env: Env = process.env): "http" | "https" {
  return env.CUSTOM_DOMAIN_URL_SCHEME === "http" ? "http" : "https";
}

/**
 * The platform's own address (scheme, host and optional port) from BETTER_AUTH_URL, or null when it is not a valid URL. The Marketplace's canonical
 * addresses and its sitemap are built on it, so a search engine is only ever told the platform's name for a page of the platform.
 */
export function platformOrigin(env: Env = process.env): string | null {
  if (!env.BETTER_AUTH_URL) return null;
  try {
    return new URL(env.BETTER_AUTH_URL).origin;
  } catch {
    return null;
  }
}

/** How the screens write a Site's address: the platform's origin and the scheme of a custom domain, both from the environment. */
export function siteAddressing(env: Env = process.env): SiteAddressing {
  return { origin: platformOrigin(env), customScheme: canonicalScheme(env) };
}
