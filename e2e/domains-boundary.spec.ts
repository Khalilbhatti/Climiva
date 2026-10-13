/**
 * Phase 18B: the lines custom domains must not cross, held against the source tree and the production build rather than against behaviour.
 *
 *   - no Client Component reaches the domain data layer, the DNS code or the environment, and the client JavaScript holds no verification
 *     token and no customer's domain name;
 *   - a request is attributed to a business by its `Host` header and by nothing a client can add to it;
 *   - Climvia reads DNS and never writes it, calls no DNS provider and never fetches anything from a customer's domain;
 *   - the test resolver is for tests: no deployment file turns it on;
 *   - there is one normalizer for a hostname.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { ROOT, SRC, chainOf, posix, reachable, walk } from "./import-graph";
import { expect, test } from "./saas";

const read = (path: string) => readFileSync(path, "utf8");
const sourceFiles = walk(SRC).filter((file) => /\.(ts|tsx)$/.test(file));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const isClientFile = (file: string) => /^\s*(["'])use client\1/m.test(read(file));
const isServerAction = (file: string) => posix(file).startsWith("src/server/actions/");
const clientFiles = sourceFiles.filter(isClientFile);

/** What a Client Component may never reach: the domain data layer, the DNS code, the host resolver and the environment reader. */
const NOT_FOR_BROWSERS = [
  /^src\/db\/domain-queries\.ts$/,
  /^src\/db\/domain-verification\.ts$/,
  /^src\/db\/public-queries\.ts$/,
  /^src\/lib\/dns-resolver\.ts$/,
  /^src\/lib\/domain-config\.ts$/,
  /^src\/server\/(?!actions\/)/,
];

test.describe("the browser", () => {
  test("no Client Component reaches the domain data layer, the DNS code, the host resolver or the environment, through any chain of imports", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    // Control: the Domain Manager is a Client Component and does reach the pure rules, so the walker sees what it should.
    const manager = reachable([join(SRC, "components", "website", "DomainManager.tsx")], (file) => !isServerAction(file));
    expect([...manager.keys()].map(posix)).toEqual(expect.arrayContaining(["src/lib/domain-rules.ts", "src/lib/hostname.ts"]));
    const seen = reachable(clientFiles, (file) => !isServerAction(file));
    const offenders = [...seen.keys()].filter((file) => !isServerAction(file) && NOT_FOR_BROWSERS.some((pattern) => pattern.test(posix(file)))).map((file) => chainOf(seen, file));
    expect(offenders).toEqual([]);
  });

  test("the built client JavaScript holds no verification token, no customer's domain name and no DNS client", async () => {
    const STATIC = join(ROOT, ".next", "static");
    const scripts = (dir: string): string[] =>
      existsSync(dir) ? readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? scripts(join(dir, entry)) : entry.endsWith(".js") ? [join(dir, entry)] : [])) : [];
    expect(existsSync(join(ROOT, ".next", "BUILD_ID")), "run `npm run build` first: this reads the client files it emits").toBe(true);
    const files = scripts(STATIC).map(read);
    expect(files.length).toBeGreaterThan(20);
    const bundle = files.join("\n");
    // Control: the pure rules are client code, so what the Domain Manager says about routing is found.
    expect(bundle).toContain("ALIAS, ANAME or CNAME-flattening");

    const admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 1 });
    try {
      const claims = (await admin.query<{ hostname: string; verification_token: string }>("select hostname, verification_token from site_domains")).rows;
      // Whatever claims the other tests have made so far: none of their tokens or names is in what the browser downloads.
      for (const claim of claims) {
        expect(bundle.includes(claim.verification_token), `a token (${claim.hostname}) is in the client JavaScript`).toBe(false);
        expect(bundle.includes(claim.hostname), `${claim.hostname} is in the client JavaScript`).toBe(false);
      }
    } finally {
      await admin.end();
    }
    // The record's value is built on the server and sent to the person who may see it: the browser's code does not even hold its prefix.
    expect(bundle).not.toContain("climvia-site-verification=");
    for (const forbidden of ["resolveTxt", "node:dns", "DOMAIN_DNS_FIXTURE_DIR", "DOMAIN_DNS_RESOLVER", "verification_token", "app_public_domain", "CUSTOM_DOMAIN_TARGET"]) {
      expect(bundle.includes(forbidden), forbidden).toBe(false);
    }
  });
});

test.describe("the Host", () => {
  test("only the Host header selects a business: no source reads a forwarded host (the upload's CSRF check included), and the places that look at the request's name read Host", () => {
    // Nothing reads a forwarded host any more, not even the upload's CSRF check (src/server/same-origin.ts): the proxy passes the original Host
    // through unchanged, so the request's own Host is the page's name and no header any client can send decides which names are "this application".
    const users = sourceFiles.filter((file) => /server\/same-origin/.test(read(file))).map(posix);
    expect(users).toEqual(["src/app/api/branding/route.ts"]);
    const hits = sourceFiles.flatMap((file) => {
      const code = stripComments(read(file));
      return [/x-forwarded-host/i, /x-original-host/i, /x-forwarded-server/i, /\bx-host\b/i, /get\(\s*["']forwarded["']\s*\)/i].filter((pattern) => pattern.test(code)).map((pattern) => `${posix(file)}: ${pattern}`);
    });
    expect(hits).toEqual([]);
    // Control: the same scan does find a header that IS read (the client's address, for rate limiting), so a clean result means something.
    expect(sourceFiles.some((file) => /x-forwarded-for/i.test(stripComments(read(file))))).toBe(true);
    expect(stripComments(read(join(SRC, "proxy.ts")))).toContain('request.headers.get("host")');
    expect(stripComments(read(join(SRC, "server", "request-host.ts")))).toContain('.get("host")');
  });

  test("the proxy decides what a name is before it looks at a session, and a customer's name never reaches the sign-in logic", () => {
    const proxy = stripComments(read(join(SRC, "proxy.ts")));
    expect(proxy.indexOf("classifyHost(")).toBeGreaterThan(-1);
    expect(proxy.indexOf("classifyHost(")).toBeLessThan(proxy.indexOf("getSessionCookie(request)"));
    expect(proxy.indexOf('host === "custom"')).toBeLessThan(proxy.indexOf("getSessionCookie(request)"));
    // Nothing is left out of the matcher but the two icons and Next's own static files, so no path on a customer's name escapes the check.
    expect(read(join(SRC, "proxy.ts"))).toContain('matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"]');
  });

  test("there is one normalizer for a hostname, and it is the platform's own URL parsing, not a hand-written one", () => {
    const users = sourceFiles.filter((file) => /domainToASCII|punycode|toASCII|domainToUnicode/i.test(stripComments(read(file)))).map(posix);
    expect(users).toEqual([]);
    const parsers = sourceFiles.filter((file) => /new URL\(`http:\/\/\$\{/.test(read(file))).map(posix);
    expect(parsers).toEqual(["src/lib/hostname.ts"]);
    // The claim path and the request path use it, and nothing re-implements its rules.
    expect(read(join(SRC, "db", "domain-queries.ts"))).toContain("normalizeHostname(input)");
    expect(read(join(SRC, "lib", "hostname.ts"))).toContain("export function normalizeHostname");
  });
});

test.describe("DNS is read, never written, and nothing is fetched from a customer", () => {
  test("no DNS provider is called: no Route 53, no hosted zone, no record is created anywhere", () => {
    const hits = sourceFiles.filter((file) => /route-?53|ChangeResourceRecordSets|CreateHostedZone|client-route|cloudflare|godaddy|namecheap/i.test(stripComments(read(file)))).map(posix);
    expect(hits).toEqual([]);
    const manifest = JSON.parse(read(join(ROOT, "package.json"))) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((name) => /route-?53|dns|cloudflare/i.test(name))).toEqual([]);
  });

  test("verifying a domain asks DNS and nothing else: the files that do it never fetch, connect or request anything over HTTP", () => {
    for (const file of ["db/domain-queries.ts", "db/domain-verification.ts", "lib/dns-resolver.ts", "lib/domain-rules.ts", "lib/hostname.ts", "server/request-host.ts"]) {
      expect(stripComments(read(join(SRC, file))), file).not.toMatch(/\bfetch\(|https?\.(request|get)\(|net\.connect|XMLHttpRequest|axios|node-fetch/);
    }
    const actions = stripComments(read(join(SRC, "server", "actions", "website.ts")));
    expect(actions).not.toMatch(/\bfetch\(/);
    // The DNS answers come from one place, and it only asks for TXT records.
    const resolver = stripComments(read(join(SRC, "lib", "dns-resolver.ts")));
    expect(resolver).toContain("resolveTxt");
    expect(resolver).not.toMatch(/resolve(A|4|6|Cname|Mx|Ns|Any)\(|lookup\(/);
  });

  test("the test resolver is turned on only by the test configuration: no deployment or example file sets it", () => {
    for (const file of [".env.example", "Dockerfile", "docker-compose.yml", ".dockerignore"]) {
      if (existsSync(join(ROOT, file))) expect(read(join(ROOT, file)), file).not.toMatch(/DOMAIN_DNS_RESOLVER|DOMAIN_DNS_FIXTURE_DIR|TEST_DNS_DIR/);
    }
    const readers = sourceFiles.filter((file) => /DOMAIN_DNS_RESOLVER|DOMAIN_DNS_FIXTURE_DIR/.test(read(file))).map(posix);
    // The resolver reads it; the production configuration rules (src/lib/deployment.ts) NAME it, to refuse a deployment that sets it.
    expect(readers).toEqual(["src/lib/deployment.ts", "src/lib/dns-resolver.ts"]);
    expect(read(join(SRC, "lib", "deployment.ts"))).toContain('add("DOMAIN_DNS_RESOLVER", "must not be set: the test resolver is for tests only")');
    const config = read(join(ROOT, "playwright.config.ts"));
    expect(config).toContain('process.env.DOMAIN_DNS_RESOLVER = "fixture"');
  });
});

test.describe("the stored record", () => {
  test("the token is never selected by a public path, a generic Site object or a list for someone who may not manage the website", () => {
    // The public functions return an identity and a name; no source under the public path names the table or the column.
    for (const file of ["db/public-queries.ts", "server/public-site.ts", "server/public-site-route.tsx", "server/request-host.ts"]) {
      expect(stripComments(read(join(SRC, file))), file).not.toMatch(/site_domains|siteDomains|verification_?token/i);
    }
    // The only place a record is built from the token reveals it only to a caller who has been checked, and only while it is needed.
    const queries = read(join(SRC, "db", "domain-queries.ts"));
    expect(queries).toMatch(/reveal && row\.status === "pending_verification"/);
    expect(read(join(SRC, "server", "core-data.ts"))).toContain('reveal: can(role, "website:manage")');
    expect(read(join(SRC, "server", "actions", "website.ts"))).toContain("const domains = () => ({ reveal: true");
    // And nothing outside the data layer and the verification service reads the column.
    const readers = sourceFiles.filter((file) => /verificationToken/.test(read(file))).map(posix).sort();
    expect(readers).toEqual(["src/db/domain-queries.ts", "src/db/schema/sites.ts"]);
  });

  test("a customer's domain is never written to a file or a log by the application", () => {
    const hits = sourceFiles.filter((file) => /console\.(log|info|warn|error)\([^)]*(hostname|verificationToken|token)/i.test(read(file))).map(posix);
    expect(hits).toEqual([]);
  });
});
