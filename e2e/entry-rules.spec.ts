/**
 * Phase 19C, the rules that need no server: where a login may send someone, which names a deployment answers on (a `climvia.duckdns.org`-style single
 * host included, with no hostname in the code), the structured data a page may carry, the review link's secret, what a customer's review form may send,
 * and what the source says about the landing and the entry module. Pure functions and source reads: no database, no network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { REVIEW_LINK_DAYS, REVIEW_TEXT_MAX } from "../src/data/reviews";
import { hostConfig, platformOrigin } from "../src/lib/domain-config";
import { productionConfigProblems } from "../src/lib/deployment";
import { classifyHost, reservedReason } from "../src/lib/hostname";
import { hashReviewToken, newReviewToken, reviewLinkExpiry, reviewLinkUrl, REVIEW_TOKEN_PATTERN } from "../src/lib/review-link";
import { parseReviewSubmission, requestNumber } from "../src/lib/review-rules";
import { safeNextPath } from "../src/lib/safe-path";
import { jsonLd, landingStructuredData, providerStructuredData } from "../src/lib/structured-data";
import { SRC, posix, walk } from "./import-graph";

const read = (path: string) => readFileSync(path, "utf8");
const sources = walk(SRC).filter((file) => !posix(file).includes("/node_modules/"));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

/* ───────────────────────────── where a login may send someone ───────────────────────────── */

test.describe("the return address after Log in", () => {
  test("only a plain path on this site is kept", () => {
    for (const good of ["/customers", "/jobs/JB-204", "/reviews?tab=awaiting", "/website/builder", "/overview", "/a/b/c?x=1&y=2"]) expect(safeNextPath(good), good).toBe(good);
    for (const bad of [
      undefined,
      null,
      "",
      "customers",
      "https://evil.example/",
      "http://evil.example",
      "//evil.example/steal",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "/login",
      "/signup",
      "/api/auth/sign-out",
      "/api/branding",
      "/x".repeat(200),
      "/ok\n/evil",
      "/ok\u0000",
      "/ok\r\nLocation: https://evil.example",
    ]) {
      expect(safeNextPath(bad as string | null | undefined), JSON.stringify(bad)).toBeUndefined();
    }
  });

  test("the console is never a return address: the ordinary sign-in grants and routes nothing there", () => {
    for (const path of ["/platform-admin", "/platform-admin/", "/platform-admin/system", "/platform-admin/users?q=x", "/platform-admin?x=1"]) expect(safeNextPath(path), path).toBeUndefined();
    // ... but a page that merely starts with the same letters is an ordinary page.
    expect(safeNextPath("/platform-adminx")).toBe("/platform-adminx");
  });
});

/* ───────────────────────────── a deployment's own names ───────────────────────────── */

test.describe("a deployment at a single host such as climvia.duckdns.org", () => {
  const env = { BETTER_AUTH_URL: "https://climvia.duckdns.org" };
  const config = hostConfig(env);

  test("the host of BETTER_AUTH_URL is the platform's own; nothing else is configured and no name is in the code", () => {
    expect(config.appHosts).toEqual(["climvia.duckdns.org"]);
    expect(platformOrigin(env)).toBe("https://climvia.duckdns.org");
    expect(platformOrigin({ BETTER_AUTH_URL: "https://climvia.duckdns.org:8443/" })).toBe("https://climvia.duckdns.org:8443");
    expect(platformOrigin({})).toBeNull();
    expect(platformOrigin({ BETTER_AUTH_URL: "not a url" })).toBeNull();
    // The name of a free DNS provider is an example in a test and a document, never a decision in the application.
    const offenders = sources.filter((file) => /duckdns/i.test(read(file))).map(posix);
    expect(offenders).toEqual([]);
  });

  test("the platform's host serves the platform; a neighbour under the same provider is a customer's candidate, and the platform's own name cannot be claimed", () => {
    for (const host of ["climvia.duckdns.org", "climvia.duckdns.org:443", "CLIMVIA.DUCKDNS.ORG", "climvia.duckdns.org.", "localhost", "localhost:3460", "127.0.0.1:3460", "[::1]:3460"]) expect(classifyHost(host, config), host).toBe("platform");
    for (const host of ["other.duckdns.org", "climvia.duckdns.org.evil.example", "xclimvia.duckdns.org", "duckdns.org", "customer.example.com"]) expect(classifyHost(host, config), host).toBe("custom");
    for (const host of ["", " ", "a..b", "exa mple.com", "http://climvia.duckdns.org", "climvia.duckdns.org/x"]) expect(classifyHost(host, config), host).toBe("refuse");
    expect(reservedReason("climvia.duckdns.org", config)).toBe("platform");
    expect(reservedReason("www.climvia.duckdns.org", config)).toBe("platform");
    expect(reservedReason("other.duckdns.org", config)).toBeNull();
  });

  test("a second name is added by configuration alone (APP_HOSTS), and a different host for the application later changes nothing else", () => {
    const later = hostConfig({ BETTER_AUTH_URL: "https://app.climvia.example", APP_HOSTS: "climvia.duckdns.org, www.climvia.example" });
    expect([...later.appHosts].sort()).toEqual(["app.climvia.example", "climvia.duckdns.org", "www.climvia.example"]);
    for (const host of ["app.climvia.example", "climvia.duckdns.org", "www.climvia.example", "anything.climvia.com"]) expect(classifyHost(host, later), host).toBe("platform");
    expect(classifyHost("customer.example.com", later)).toBe("custom");
  });

  test("the production rules accept it: an https origin on a domain name, and a customer-DNS target that is a different name", () => {
    const good = {
      CLIMVIA_ENV: "production",
      NODE_ENV: "production",
      DATABASE_URL: "postgres://climvia_app:Zk3pQ9vLw2XnR7sTb4Yc@db:5432/climvia",
      BETTER_AUTH_SECRET: "k9Fh2Lw7QxPz4VnR8sTb3YcJd6MeUa1G",
      BETTER_AUTH_URL: "https://climvia.duckdns.org",
      AUTH_TRUSTED_PROXIES: "172.30.0.0/24",
      CUSTOM_DOMAIN_TARGET: "sites.climvia.duckdns.org",
      TLS_ASK_TOKEN: "Qm7Vx2Lp9Rk4Zt6Wc1Hb8NsDf3Ya5JgE",
      ASSET_STORAGE_DRIVER: "local",
      ASSET_LOCAL_DIR: "/data/assets",
    };
    expect(productionConfigProblems(good)).toEqual([]);
    // It cannot be the application's own address, and an address with a path or no https is not an origin.
    expect(productionConfigProblems({ ...good, CUSTOM_DOMAIN_TARGET: "climvia.duckdns.org" }).some((problem) => problem.startsWith("CUSTOM_DOMAIN_TARGET"))).toBe(true);
    expect(productionConfigProblems({ ...good, BETTER_AUTH_URL: "http://climvia.duckdns.org" }).some((problem) => problem.startsWith("BETTER_AUTH_URL"))).toBe(true);
    expect(productionConfigProblems({ ...good, BETTER_AUTH_URL: "https://climvia.duckdns.org/app" }).some((problem) => problem.startsWith("BETTER_AUTH_URL"))).toBe(true);
  });

  test("a review link is built from that configured address, never from the request that asks for it", () => {
    const token = newReviewToken();
    const before = process.env.BETTER_AUTH_URL;
    try {
      process.env.BETTER_AUTH_URL = "https://climvia.duckdns.org";
      expect(reviewLinkUrl(token)).toBe(`https://climvia.duckdns.org/review/${token}`);
      delete process.env.BETTER_AUTH_URL;
      expect(reviewLinkUrl(token)).toBe(`/review/${token}`);
    } finally {
      if (before === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = before;
    }
  });
});

/* ───────────────────────────── structured data ───────────────────────────── */

test.describe("structured data says only what is true and public", () => {
  test("the landing names Climvia and its search, from the configured origin, and nothing without one", () => {
    expect(landingStructuredData(null)).toBeNull();
    const data = landingStructuredData("https://climvia.duckdns.org");
    expect(JSON.stringify(data)).toContain("https://climvia.duckdns.org/marketplace?q={search_term_string}");
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|review|price|telephone|address|openingHours/i);
  });

  test("a provider carries what its profile shows, and a rating only when it has reviews a visitor can see", () => {
    const input = { slug: "acme-air", name: "Acme Air", description: "Repairs.", phone: null, address: null, rating: null };
    const bare = providerStructuredData("https://x.example", input)!;
    expect(bare).toMatchObject({ "@type": "HVACBusiness", name: "Acme Air", url: "https://x.example/listings/acme-air" });
    for (const key of ["telephone", "address", "aggregateRating", "openingHours", "priceRange", "areaServed", "review"]) expect(bare, key).not.toHaveProperty(key);
    expect(providerStructuredData("https://x.example", { ...input, rating: { average: 4.5, count: 0 } })).not.toHaveProperty("aggregateRating");
    const rated = providerStructuredData("https://x.example", { ...input, rating: { average: 4.5, count: 2 }, phone: "555-0100", address: { street: "1 Main St", city: "Austin", state: "TX", postalCode: "78704" } })!;
    expect(rated).toMatchObject({ telephone: "555-0100", aggregateRating: { ratingValue: 4.5, reviewCount: 2, bestRating: 5, worstRating: 1 }, address: { streetAddress: "1 Main St", addressLocality: "Austin", addressRegion: "TX", postalCode: "78704" } });
    expect(providerStructuredData(null, input)).toBeNull();
    // An address with nothing in it is no address.
    expect(providerStructuredData("https://x.example", { ...input, address: { street: null, city: null, state: null, postalCode: null } })).not.toHaveProperty("address");
  });

  test("the script text can never close its own tag, and survives a business name made to", () => {
    const hostile = providerStructuredData("https://x.example", { slug: "a", name: "</script><script>alert(1)</script>", description: "a b c", phone: null, address: null, rating: null })!;
    const text = jsonLd(hostile);
    expect(text).not.toContain("</script");
    expect(text).not.toContain("<");
    expect(text).not.toContain(String.fromCharCode(0x2028));
    expect(text).not.toContain(String.fromCharCode(0x2029));
    // It is still the same data once read back.
    expect(JSON.parse(text).name).toBe("</script><script>alert(1)</script>");
    expect(JSON.parse(text).description).toBe("a b c");
  });
});

/* ───────────────────────────── the review link and the form ───────────────────────────── */

test.describe("the review link's secret", () => {
  test("is 256 random bits as 43 URL-safe characters, and only its SHA-256 is ever the stored form", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const token = newReviewToken();
      expect(token).toMatch(REVIEW_TOKEN_PATTERN);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      expect(hashReviewToken(token)).toMatch(/^[0-9a-f]{64}$/);
      expect(hashReviewToken(token)).not.toContain(token);
      seen.add(token);
    }
    expect(seen.size).toBe(500);
    expect(hashReviewToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("a link lasts the days the product says, and the pattern refuses everything that is not a link", () => {
    const from = new Date("2030-01-01T00:00:00Z").getTime();
    expect(reviewLinkExpiry(from).getTime() - from).toBe(REVIEW_LINK_DAYS * 24 * 3600 * 1000);
    expect(REVIEW_LINK_DAYS).toBe(30);
    for (const bad of ["", "x", `${newReviewToken()}=`, `${newReviewToken()} `, newReviewToken().slice(0, 42), `${newReviewToken()}a`, "../../etc/passwd".padEnd(43, "a"), "a".repeat(43).replace(/a$/, "+"), "a".repeat(43).replace(/a$/, "/")]) {
      expect(REVIEW_TOKEN_PATTERN.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  test("a request is named by its place in the list, and nothing else names one", () => {
    expect(requestNumber("req-1")).toBe(1);
    expect(requestNumber("req-12")).toBe(12);
    for (const bad of [undefined, null, 1, "", "req-0", "req-", "req-01", "req--1", "req-1x", "REQ-1", " req-1", "req-1234567", "rev-sarah-mitchell", "../req-1"]) expect(requestNumber(bad), JSON.stringify(bad)).toBeUndefined();
  });
});

test.describe("what the review form may send", () => {
  const ok = { rating: "5", text: "They fixed it the same day.", showPublicly: "yes" };

  test("a whole-number rating of one to five, words of one to two thousand characters, and a consent that is yes only for yes", () => {
    expect(parseReviewSubmission(ok)).toEqual({ ok: true, value: { rating: 5, text: "They fixed it the same day.", showPublicly: true } });
    expect(parseReviewSubmission({ ...ok, text: `  ${"x".repeat(REVIEW_TEXT_MAX)}  ` })).toMatchObject({ ok: true });
    for (const bad of ["0", "6", "4.5", "-1", "five", "", "٣", " 5", "5 ", "05", 5, null, undefined, true, ["5"]]) expect(parseReviewSubmission({ ...ok, rating: bad }), JSON.stringify(bad)).toMatchObject({ ok: false });
    for (const bad of ["", "   ", "x".repeat(REVIEW_TEXT_MAX + 1), 5, null, undefined, {}]) expect(parseReviewSubmission({ ...ok, text: bad }), JSON.stringify(bad)).toMatchObject({ ok: false });
    expect((parseReviewSubmission({ ...ok, rating: "9" }) as { fields?: Record<string, string> }).fields).toHaveProperty("rating");
    expect((parseReviewSubmission({ ...ok, text: "" }) as { fields?: Record<string, string> }).fields).toHaveProperty("text");
  });

  test("public display needs an explicit yes: no, nothing, a boolean, an array or a near miss are all private", () => {
    for (const consent of ["no", "", undefined, null, true, false, 1, "true", "YES", "Yes", "yes ", " yes", ["yes"], { yes: true }, "on", "1"]) {
      const parsed = parseReviewSubmission({ ...ok, showPublicly: consent });
      expect(parsed, JSON.stringify(consent)).toMatchObject({ ok: true, value: { showPublicly: false } });
    }
    expect(parseReviewSubmission({ ...ok, showPublicly: "yes" })).toMatchObject({ ok: true, value: { showPublicly: true } });
  });
});

/* ───────────────────────────── the source, on the front door ───────────────────────────── */

test.describe("the front door in the source", () => {
  test("the landing makes no claim the product cannot back", () => {
    const text = stripComments(read(join(SRC, "components", "landing", "Landing.tsx")));
    for (const claim of [/verified/i, /licensed/i, /guarantee/i, /best price/i, /nationwide/i, /\bAI\b/, /same[- ]day/i, /24\/7/, /top[- ]rated/i, /trusted by/i, /thousands/i, /testimonial/i, /\d[\d,]+\+? (businesses|customers|homeowners|providers)/i]) {
      expect(text, String(claim)).not.toMatch(claim);
    }
    // It reads no data: no query, no session, no cookie.
    expect(text).not.toMatch(/@\/db|@\/server|cookies\(|headers\(|getSessionUser|fetch\(/);
  });

  test("`/` reads the session only through the entry module, and the entry module answers about the verified user alone", () => {
    const page = stripComments(read(join(SRC, "app", "(entry)", "page.tsx")));
    expect(page).toContain("entryDestination()");
    expect(page).not.toMatch(/getSessionUser|withUser|withTenant|cookies\(|headers\(/);
    const entry = stripComments(read(join(SRC, "server", "entry.ts")));
    expect(entry).toContain("getSessionUser()");
    expect(entry).not.toMatch(/searchParams|formData|cookies\(|headers\(|organizationId/);
    // The destinations are the three the product defines, and the landing's own check never redirects a platform administrator to /onboarding.
    expect(entry).toMatch(/to: "\/overview"/);
    expect(entry).toMatch(/to: "\/onboarding"/);
    expect(entry.indexOf("isPlatformAdmin(user.id)")).toBeLessThan(entry.indexOf('to: "/onboarding"'));
  });

  test("the proxy treats `/`, the review page and the session answer as public on the platform's names, and on a customer's name they are rewritten like any other path", () => {
    const proxy = stripComments(read(join(SRC, "proxy.ts")));
    for (const prefix of ['"/review"', '"/api/session-state"']) expect(proxy, prefix).toContain(prefix);
    expect(proxy).toMatch(/if \(pathname === "\/"\) return NextResponse\.next\(\)/);
    // The customer's-name branch comes first and takes every path (the root included) to the one route that serves a customer's site.
    expect(proxy.indexOf('host === "custom"')).toBeLessThan(proxy.indexOf('pathname === "/"'));
    expect(proxy).toMatch(/target\.pathname = `\$\{CUSTOM_SITE\}\$\{pathname === "\/" \? "" : pathname\}`/);
    // The proxy classifies by the Host header alone.
    expect(proxy).not.toMatch(/x-forwarded-host|x-original-host|forwarded"/i);
  });

  test("the public header never links the console to anyone: only the session island does, once the database has said the person is an administrator", () => {
    for (const file of ["PublicHeader.tsx", "PublicFooter.tsx"]) expect(read(join(SRC, "components", "public", file)), file).not.toMatch(/platform-admin|Platform console/);
    const island = read(join(SRC, "components", "public", "PublicSessionNav.tsx"));
    expect(island).toMatch(/state\?\.platformAdmin/);
    expect(island).toContain("/api/session-state");
    // A page of the public group names no console either.
    for (const file of walk(join(SRC, "app", "(public)"))) expect(read(file), posix(file)).not.toMatch(/platform-admin/);
  });
});
