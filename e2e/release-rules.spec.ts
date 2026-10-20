/**
 * Phase 19D, the rules behind the release candidate that need no server: a Site's address is written from the deployment's configuration and from nothing
 * the product owns, the names a deployment answers on are exactly the ones it lists, and the committed source and configuration carry no hostname.
 * Pure functions and source reads: no database, no network.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { getPlatformAddress, getPrimaryAddress, type DomainRecord, type DomainState, type SiteIdentity } from "../src/data/website";
import { canonicalScheme, hostConfig, platformOrigin, siteAddressing } from "../src/lib/domain-config";
import { productionConfigProblems } from "../src/lib/deployment";
import { BRAND_DOMAIN, classifyHost, reservedReason } from "../src/lib/hostname";
import { NO_ADDRESSING, customSiteUrl, platformSiteUrl } from "../src/lib/site-domain";
import { ROOT, SRC, posix, walk } from "./import-graph";

const read = (path: string) => readFileSync(path, "utf8");
const SITE: SiteIdentity = { id: "site-1", name: "Acme Heating", platformSlug: "acme-heating" };
const claim = (hostname: string, status: DomainRecord["status"], isPrimary: boolean): DomainRecord => ({
  id: hostname,
  hostname,
  status,
  isPrimary,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  verifiedAt: null,
  activatedAt: null,
  disabledAt: null,
  lastCheckedAt: null,
  verification: null,
});
const stateOf = (env: Record<string, string | undefined>, domains: DomainRecord[] = []): DomainState => ({ domains, routingTarget: null, addressing: siteAddressing(env) });

/* ───────────────────────────── a Site's address is the deployment's, not the product's ───────────────────────────── */

test.describe("a Site's address is written from the configured origin", () => {
  test("a single host: `<origin>/sites/<slug>`, whatever the host, port or scheme", () => {
    for (const [origin, expected] of [
      ["https://example.duckdns.org", "https://example.duckdns.org/sites/acme-heating"],
      ["https://example.duckdns.org:8443", "https://example.duckdns.org:8443/sites/acme-heating"],
      ["https://app.example.test/", "https://app.example.test/sites/acme-heating"],
      ["http://localhost:3460", "http://localhost:3460/sites/acme-heating"],
    ] as const) {
      const env = { BETTER_AUTH_URL: origin };
      expect(getPlatformAddress(SITE, stateOf(env)), origin).toBe(expected);
      expect(getPrimaryAddress(SITE, stateOf(env)), origin).toBe(expected);
    }
  });

  test("with no usable origin it is the path alone, never a made-up host", () => {
    for (const env of [{}, { BETTER_AUTH_URL: "not a url" }, { BETTER_AUTH_URL: "" }]) {
      expect(getPlatformAddress(SITE, stateOf(env))).toBe("/sites/acme-heating");
    }
    expect(platformSiteUrl("acme-heating")).toBe("/sites/acme-heating");
    expect(platformSiteUrl("acme-heating", NO_ADDRESSING, "/services")).toBe("/sites/acme-heating/services");
  });

  test("an active, primary custom domain is the main address; every other claim, and a missing one, leaves the platform's", () => {
    const env = { BETTER_AUTH_URL: "https://example.duckdns.org", CUSTOM_DOMAIN_URL_SCHEME: "https" };
    expect(getPrimaryAddress(SITE, stateOf(env, [claim("www.acme.test", "active", true)]))).toBe("https://www.acme.test");
    // The platform's own address stays the platform's: a custom domain is added to it, never in its place.
    expect(getPlatformAddress(SITE, stateOf(env, [claim("www.acme.test", "active", true)]))).toBe("https://example.duckdns.org/sites/acme-heating");
    for (const other of [claim("a.acme.test", "pending_verification", false), claim("b.acme.test", "verified", false), claim("c.acme.test", "disabled", false), claim("d.acme.test", "active", false)]) {
      expect(getPrimaryAddress(SITE, stateOf(env, [other])), other.hostname).toBe("https://example.duckdns.org/sites/acme-heating");
    }
    expect(customSiteUrl("www.acme.test", { origin: null, customScheme: "http" }, "/book")).toBe("http://www.acme.test/book");
    expect(canonicalScheme({ CUSTOM_DOMAIN_URL_SCHEME: "http" })).toBe("http");
  });

  test("the address names no product domain whatever the configuration is, and none is added or assumed", () => {
    for (const env of [{ BETTER_AUTH_URL: "https://example.duckdns.org" }, { BETTER_AUTH_URL: "https://sites.example.test" }, {}]) {
      expect(getPrimaryAddress(SITE, stateOf(env))).not.toMatch(/climvia/i);
      expect(getPlatformAddress(SITE, stateOf(env))).not.toMatch(/climvia/i);
    }
    expect(platformOrigin({ BETTER_AUTH_URL: "https://example.duckdns.org/some/path?x=1" })).toBe("https://example.duckdns.org");
  });
});

/* ───────────────────────────── the names a deployment answers on ───────────────────────────── */

test.describe("the platform is exactly the names a deployment lists", () => {
  const single = hostConfig({ BETTER_AUTH_URL: "https://example.duckdns.org", CUSTOM_DOMAIN_TARGET: "sites.example.duckdns.org" });

  test("on one host nothing but that host, what is beneath it and the routing target is the platform's; the product's own domain is not assumed", () => {
    expect(single).toEqual({ appHosts: ["example.duckdns.org"], customDomainTarget: "sites.example.duckdns.org" });
    for (const host of ["example.duckdns.org", "www.example.duckdns.org", "sites.example.duckdns.org", "localhost", "127.0.0.1", "app"]) expect(classifyHost(host, single), host).toBe("platform");
    for (const host of ["climvia.com", "www.climvia.com", "app.climvia.com", "apexclimate.climvia.com", "other.duckdns.org", "duckdns.org", "example.duckdns.org.evil.test"]) {
      expect(classifyHost(host, single), host).toBe("custom");
    }
  });

  test("a later purchased domain is one entry in APP_HOSTS, with nothing else changed", () => {
    const later = hostConfig({ BETTER_AUTH_URL: "https://example.duckdns.org", APP_HOSTS: "climvia.example", CUSTOM_DOMAIN_TARGET: "sites.climvia.example" });
    for (const host of ["example.duckdns.org", "climvia.example", "app.climvia.example", "acme.climvia.example", "sites.climvia.example"]) expect(classifyHost(host, later), host).toBe("platform");
    expect(classifyHost("www.acme.test", later)).toBe("custom");
    for (const name of ["climvia.example", "acme.climvia.example", "example.duckdns.org"]) expect(reservedReason(name, later), name).toBe("platform");
  });

  test("the product's own name is only ever a reservation, never a route: nobody can claim it, and it makes no request the platform's", () => {
    expect(BRAND_DOMAIN).toBe("climvia.com");
    for (const name of ["climvia.com", "www.climvia.com", "deep.sub.climvia.com"]) expect(reservedReason(name, single), name).toBe("platform");
    for (const name of ["notclimvia.com", "climvia.com.evil.test", "climvia.co"]) expect(reservedReason(name, single), name).toBeNull();
    expect(classifyHost("www.climvia.com", single)).toBe("custom");
  });
});

/* ───────────────────────────── the committed code and configuration ───────────────────────────── */

const SHIPPED_ROOTS = ["src", "deploy", "scripts/deploy", "scripts/platform-admin", "scripts/check-config.ts", "Dockerfile", "docker-compose.production.yml", ".env.example", ".env.production.example"];
const SCANNED_EXTENSIONS = /\.(ts|tsx|css|caddy|sh|yml|yaml|json|example)$|Caddyfile$|Dockerfile$/;

function filesUnder(path: string): string[] {
  const full = join(ROOT, path);
  const stats = statSync(full);
  if (!stats.isDirectory()) return [full];
  return readdirSync(full).flatMap((entry) => filesUnder(join(path, entry)));
}
const shipped = SHIPPED_ROOTS.flatMap(filesUnder).filter((file) => SCANNED_EXTENSIONS.test(file) || /\.env\./.test(file));

test.describe("no hostname is written into what ships", () => {
  test("the product's domain appears in the application in two places only: the reservation of its own name, and the database's matching constraint", () => {
    const offenders = new Map<string, number>();
    for (const file of shipped) {
      const hits = (read(file).match(/climvia(\\+)?\.com/gi) ?? []).length;
      if (hits > 0) offenders.set(posix(file), hits);
    }
    expect(Object.fromEntries(offenders)).toEqual({
      // `export const BRAND_DOMAIN = "climvia.com"` and nothing derived from it.
      "src/lib/hostname.ts": 1,
      // The Drizzle mirror of migration 0019's CHECK `site_domains_hostname_reserved`; changing it needs a migration.
      "src/db/schema/sites.ts": 1,
    });
    expect(read(join(SRC, "lib", "hostname.ts"))).toMatch(/export const BRAND_DOMAIN = "climvia\.com";/);
    // And the constant is used for refusing a claim, nowhere else.
    const users = walk(SRC).filter((file) => /\bBRAND_DOMAIN\b/.test(read(file))).map(posix).sort();
    expect(users).toEqual(["src/lib/hostname.ts"]);
  });

  test("no module builds a Site's address from a name of its own: the old helper and the constant are gone, and nothing joins a slug to a domain", () => {
    for (const file of walk(SRC)) {
      const code = read(file);
      expect(code, posix(file)).not.toMatch(/\bplatformHost\b|\bPLATFORM_DOMAIN\b|\bplatformDomain\b|getPrimaryDomain/);
      expect(code, posix(file)).not.toMatch(/\$\{[^}]*(slug|Slug)[^}]*\}\.\$\{|\+ "\." \+ [A-Z_]*DOMAIN/);
    }
  });

  test("the committed source and configuration name no deployment host: no free-DNS provider, only example domains in the examples", () => {
    for (const file of shipped) {
      const code = read(file);
      expect(code, posix(file)).not.toMatch(/duckdns|no-ip\.|ngrok|trycloudflare|nip\.io|sslip\.io/i);
    }
    for (const example of [".env.example", ".env.production.example"]) {
      const hosts = [...read(join(ROOT, example)).matchAll(/^#?\s*(?:BETTER_AUTH_URL|PUBLIC_HOST|APP_HOSTS|CUSTOM_DOMAIN_TARGET)=(\S+)/gm)].map(([, value]) => value.replace(/^https?:\/\//, "").split(",")[0]);
      expect(hosts.length, example).toBeGreaterThan(0);
      for (const host of hosts) expect(host, `${example}: ${host}`).toMatch(/(^|\.)(example\.(com|test|org)|localhost)(:\d+)?$|^$/);
    }
  });

  test("the production rules accept a single-host configuration without any source edit, and refuse the settings that would make it a demo", () => {
    const good = {
      CLIMVIA_ENV: "production",
      NODE_ENV: "production",
      DATABASE_URL: "postgres://climvia_app:Zk3pQ9vLw2XnR7sTb4Yc@db:5432/climvia",
      BETTER_AUTH_SECRET: "k9Fh2Lw7QxPz4VnR8sTb3YcJd6MeUa1G",
      BETTER_AUTH_URL: "https://example.duckdns.org",
      AUTH_TRUSTED_PROXIES: "172.30.0.0/24",
      CUSTOM_DOMAIN_TARGET: "sites.example.duckdns.org",
      TLS_ASK_TOKEN: "Qm7Vx2Lp9Rk4Zt6Wc1Hb8NsDf3Ya5JgE",
      ASSET_STORAGE_DRIVER: "local",
      ASSET_LOCAL_DIR: "/data/assets",
    };
    expect(productionConfigProblems(good)).toEqual([]);
    const refused = (extra: Record<string, string>, setting: string) => expect(productionConfigProblems({ ...good, ...extra }).some((problem) => problem.startsWith(setting)), setting).toBe(true);
    refused({ DOMAIN_DNS_RESOLVER: "fixture" }, "DOMAIN_DNS_RESOLVER");
    refused({ DOMAIN_DNS_FIXTURE_DIR: "/tmp/dns" }, "DOMAIN_DNS_FIXTURE_DIR");
    refused({ ALLOW_SEED: "1" }, "ALLOW_SEED");
    refused({ SEED_PASSWORD: "whatever" }, "SEED_PASSWORD");
    refused({ AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE" }, "AWS_ACCESS_KEY_ID");
    refused({ AWS_SECRET_ACCESS_KEY: "x" }, "AWS_SECRET_ACCESS_KEY");
    refused({ DATABASE_ADMIN_URL: "postgres://climvia_owner:x@db:5432/climvia" }, "DATABASE_ADMIN_URL");
    refused({ CUSTOM_DOMAIN_URL_SCHEME: "http" }, "CUSTOM_DOMAIN_URL_SCHEME");
  });
});
