/**
 * Phase 18B: the pure rules of custom domains. No database, no browser, no network: how a name is normalized (the ONE normalizer), which
 * names are reserved, how a request's Host is read and classified, the state machine, the verification record and how an answer from DNS is
 * judged, and what the person is told about routing. The database holds the same rules again (domains-database.spec.ts).
 */
import { expect, test } from "playwright/test";
import { DOMAIN_STATUS_VALUES } from "../src/db/schema";
import {
  DNS_CHECK_COOLDOWN_SECONDS,
  DOMAIN_STATUSES,
  DOMAIN_STATUS_LABEL,
  DOMAIN_TRANSITIONS,
  HOLDING_STATUSES,
  VERIFICATION_TOKEN,
  canMoveDomain,
  looksLikeRootDomain,
  routingAdvice,
  txtRecordsMatch,
  verificationRecordName,
  verificationRecordValue,
} from "../src/lib/domain-rules";
import { MAX_HOSTNAME_LENGTH, classifyHost, normalizeHostname, readRequestHost, reservedReason, type HostConfig } from "../src/lib/hostname";
import { newVerificationToken } from "../src/db/domain-queries";
import { fixtureResolver, resolverFromEnv, systemResolver } from "../src/lib/dns-resolver";
import { canonicalScheme, hostConfig } from "../src/lib/domain-config";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const normalize = (input: unknown) => {
  const result = normalizeHostname(input);
  return result.ok ? result.hostname : `rejected:${result.problem}`;
};

const CONFIG: HostConfig = { appHosts: ["climvia.com", "app.example.io"], customDomainTarget: "sites.example.io" };

test.describe("one normalizer for every hostname", () => {
  test("upper case, a trailing dot and surrounding space are normalized to one spelling", () => {
    expect(normalize("WWW.Example.COM")).toBe("www.example.com");
    expect(normalize("  www.example.com  ")).toBe("www.example.com");
    expect(normalize("www.example.com.")).toBe("www.example.com");
    expect(normalize("WWW.EXAMPLE.COM.")).toBe("www.example.com");
    expect(normalize("example.com")).toBe("example.com");
    expect(normalize("heating.example.com")).toBe("heating.example.com");
  });

  test("a Unicode name becomes its ASCII form through the standard conversion, and equivalent spellings become the same name", () => {
    expect(normalize("bücher.example.com")).toBe("xn--bcher-kva.example.com");
    expect(normalize("BÜCHER.Example.com.")).toBe("xn--bcher-kva.example.com");
    // The same word written with a combining diaeresis is the same name.
    expect(normalize("bücher.example.com")).toBe("xn--bcher-kva.example.com");
    // Already ASCII: unchanged, so storing the converted form and converting it again is stable.
    expect(normalize("xn--bcher-kva.example.com")).toBe("xn--bcher-kva.example.com");
    // A full-width dot is the same separator.
    expect(normalize("www。example。com")).toBe("www.example.com");
    expect(normalize("münchen.de")).toBe("xn--mnchen-3ya.de");
  });

  test("a scheme, a path, a query, a fragment, user information, a port or a wildcard is not a domain name", () => {
    expect(normalize("https://example.com")).toBe("rejected:scheme");
    expect(normalize("http://example.com/")).toBe("rejected:scheme");
    expect(normalize("//example.com")).toBe("rejected:scheme");
    expect(normalize("example.com/path")).toBe("rejected:path");
    expect(normalize("example.com\\path")).toBe("rejected:path");
    expect(normalize("example.com?x=1")).toBe("rejected:query");
    expect(normalize("example.com#top")).toBe("rejected:fragment");
    expect(normalize("user@example.com")).toBe("rejected:credentials");
    expect(normalize("example.com:443")).toBe("rejected:port");
    expect(normalize("*.example.com")).toBe("rejected:wildcard");
    expect(normalize("w*w.example.com")).toBe("rejected:wildcard");
  });

  test("an IPv4 address in any spelling is not a domain name", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "8.8.8.8", "127.1", "0x7f.1", "2130706433", "0177.0.0.1", "1.2.3.4"]) expect(normalize(ip), ip).toBe("rejected:ip");
  });

  test("an IPv6 address is not a domain name", () => {
    for (const ip of ["[::1]", "[2001:db8::1]", "[::ffff:127.0.0.1]"]) expect(normalize(ip), ip).toBe("rejected:ip");
  });

  test("localhost and names with a single label are not domain names (and the reserved rule names them too)", () => {
    expect(normalize("localhost")).toBe("rejected:single-label");
    expect(normalize("intranet")).toBe("rejected:single-label");
    expect(normalize("localhost.")).toBe("rejected:single-label");
    expect(reservedReason("localhost", CONFIG)).toBe("internal");
    expect(reservedReason("app.localhost", CONFIG)).toBe("internal");
    expect(reservedReason("printer.local", CONFIG)).toBe("internal");
    expect(reservedReason("db.internal", CONFIG)).toBe("internal");
    expect(reservedReason("router.home.arpa", CONFIG)).toBe("internal");
  });

  test("Climvia's own names, the configured application names and the routing target can not be claimed, at any depth", () => {
    for (const reserved of ["climvia.com", "www.climvia.com", "app.climvia.com", "anything.else.climvia.com", "apexclimate.climvia.com"]) expect(reservedReason(reserved, CONFIG), reserved).toBe("platform");
    expect(reservedReason("app.example.io", CONFIG)).toBe("platform");
    expect(reservedReason("deep.app.example.io", CONFIG)).toBe("platform");
    expect(reservedReason("sites.example.io", CONFIG)).toBe("platform");
    // A name that merely CONTAINS the platform's is somebody else's.
    for (const free of ["notclimvia.com", "climvia.com.evil.test", "climvia.co", "example.io", "myapp.example.io.test"]) expect(reservedReason(free, CONFIG), free).toBeNull();
    expect(reservedReason("www.example.com", CONFIG)).toBeNull();
  });

  test("a name over the DNS limits is rejected: the whole name, and every label", () => {
    const label = "a".repeat(63);
    expect(normalize(`${label}.example.com`)).toBe(`${label}.example.com`);
    expect(normalize(`${label}a.example.com`)).toBe("rejected:length");
    const tooLong = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.example.com`;
    expect(tooLong.length).toBeGreaterThan(MAX_HOSTNAME_LENGTH);
    expect(normalize(tooLong)).toBe("rejected:length");
    expect(normalize("x".repeat(600))).toBe("rejected:length");
  });

  test("invalid labels are rejected: empty, a leading or trailing hyphen, an underscore, a numeric top-level label, a space or an escape", () => {
    for (const bad of ["a..b.com", ".example.com", "example..com", "example.com..", "-bad.example.com", "bad-.example.com", "under_score.example.com", "example.123", "has space.com", "tab\t.com", "exa%6dple.com", "exa mple.com", "", "   ", ".", "..", "example.-com"]) {
      expect(normalize(bad), JSON.stringify(bad)).toMatch(/^rejected:/);
    }
    expect(normalize(5)).toBe("rejected:invalid");
    expect(normalize(null)).toBe("rejected:invalid");
    expect(normalize(undefined)).toBe("rejected:invalid");
    expect(normalize({})).toBe("rejected:invalid");
  });

  test("a hyphen inside a label, digits and a punycode label are fine", () => {
    expect(normalize("my-heating-company.example.com")).toBe("my-heating-company.example.com");
    expect(normalize("24-7-service.example.com")).toBe("24-7-service.example.com");
    expect(normalize("example.co.uk")).toBe("example.co.uk");
    expect(normalize("example.xn--p1ai")).toBe("example.xn--p1ai");
  });
});

test.describe("reading and classifying a request's Host", () => {
  test("the port is dropped, case is folded, one trailing dot is dropped, and a Unicode name becomes ASCII", () => {
    expect(readRequestHost("Example.COM")).toEqual({ kind: "name", hostname: "example.com" });
    expect(readRequestHost("example.com:3460")).toEqual({ kind: "name", hostname: "example.com" });
    expect(readRequestHost("example.com.:443")).toEqual({ kind: "name", hostname: "example.com" });
    expect(readRequestHost("BÜCHER.example.com")).toEqual({ kind: "name", hostname: "xn--bcher-kva.example.com" });
  });

  test("an IP address, a one-label name and an unusable value are recognized as such", () => {
    expect(readRequestHost("127.0.0.1:3460")).toEqual({ kind: "ip" });
    expect(readRequestHost("[::1]:3000")).toEqual({ kind: "ip" });
    expect(readRequestHost("[::1]")).toEqual({ kind: "ip" });
    expect(readRequestHost("localhost:3460")).toEqual({ kind: "single-label" });
    for (const bad of [null, undefined, "", "   ", "example.com:abc", "exa mple.com", "[::1", "x".repeat(400), "a..b", "http://example.com"]) expect(readRequestHost(bad), JSON.stringify(bad)).toEqual({ kind: "invalid" });
  });

  test("the platform's names, every IP address and every one-label name are the platform's; any other name is a customer's; nonsense is refused", () => {
    for (const platform of ["localhost:3460", "localhost", "127.0.0.1:3460", "[::1]:3460", "10.1.2.3", "web", "climvia.com", "www.climvia.com", "app.climvia.com", "sites.climvia.com", "app.example.io", "app.example.io:8443", "sites.example.io", "API.CLIMVIA.COM"]) {
      expect(classifyHost(platform, CONFIG), platform).toBe("platform");
    }
    for (const custom of ["www.example.com", "apex.example.test:3460", "example.com", "xn--bcher-kva.example.com", "climvia.com.evil.test", "notclimvia.com", "example.io"]) {
      expect(classifyHost(custom, CONFIG), custom).toBe("custom");
    }
    for (const nothing of [null, undefined, "", "exa mple.com", "http://x.com", "a..b"]) expect(classifyHost(nothing, CONFIG), JSON.stringify(nothing)).toBe("refuse");
  });

  test("the environment supplies the configuration: APP_HOSTS, the host of BETTER_AUTH_URL and the routing target", () => {
    const config = hostConfig({ APP_HOSTS: "App.Example.io, staging.example.io ,not a host, ,single", BETTER_AUTH_URL: "https://app.example.org:8443", CUSTOM_DOMAIN_TARGET: "Sites.Example.io" });
    expect(config).toEqual({ appHosts: ["app.example.io", "staging.example.io", "app.example.org"], customDomainTarget: "sites.example.io" });
    // No product domain is assumed: nothing is the platform's but what the deployment names.
    expect(hostConfig({})).toEqual({ appHosts: [], customDomainTarget: null });
    expect(hostConfig({ BETTER_AUTH_URL: "not a url" }).appHosts).toEqual([]);
    expect(canonicalScheme({})).toBe("https");
    expect(canonicalScheme({ CUSTOM_DOMAIN_URL_SCHEME: "http" })).toBe("http");
    expect(canonicalScheme({ CUSTOM_DOMAIN_URL_SCHEME: "ftp" })).toBe("https");
  });
});

test.describe("the state machine", () => {
  test("a claim moves pending -> verified -> active <-> disabled, any state can be removed, and nothing leaves removed or skips a step", () => {
    const allowed: Record<string, string[]> = {
      pending_verification: ["verified", "removed"],
      verified: ["active", "removed"],
      active: ["disabled", "removed"],
      disabled: ["active", "removed"],
      removed: [],
    };
    for (const from of DOMAIN_STATUSES) {
      for (const to of DOMAIN_STATUSES) {
        const expected = from === to || allowed[from].includes(to);
        expect(canMoveDomain(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
    expect(canMoveDomain("pending_verification", "active")).toBe(false);
    expect(canMoveDomain("pending_verification", "disabled")).toBe(false);
    expect(canMoveDomain("verified", "pending_verification")).toBe(false);
    expect(canMoveDomain("removed", "pending_verification")).toBe(false);
    expect(DOMAIN_TRANSITIONS.removed).toEqual([]);
  });

  test("the statuses in the code are the statuses in the database schema, in the same order, each with a label that never says live, secure or connected", () => {
    expect([...DOMAIN_STATUSES]).toEqual([...DOMAIN_STATUS_VALUES]);
    expect(HOLDING_STATUSES).toEqual(["pending_verification", "verified", "active", "disabled"]);
    expect(DOMAIN_STATUS_LABEL).toEqual({ pending_verification: "Ownership not verified", verified: "Verified", active: "Active in Climvia", disabled: "Disabled", removed: "Removed" });
    for (const label of Object.values(DOMAIN_STATUS_LABEL)) expect(label).not.toMatch(/\b(live|ssl|secure|connected)\b/i);
  });
});

test.describe("proving ownership", () => {
  test("the record is the same for a root domain and a subdomain: a TXT record on _climvia-verification.<name>", () => {
    expect(verificationRecordName("www.example.com")).toBe("_climvia-verification.www.example.com");
    expect(verificationRecordName("example.com")).toBe("_climvia-verification.example.com");
    expect(verificationRecordValue("TOKEN")).toBe("climvia-site-verification=TOKEN");
    expect(DNS_CHECK_COOLDOWN_SECONDS).toBeGreaterThanOrEqual(5);
  });

  test("a token is 32 random bytes as base64url, different every time, and not derived from anything", () => {
    const tokens = Array.from({ length: 200 }, () => newVerificationToken());
    for (const token of tokens) expect(token).toMatch(VERIFICATION_TOKEN);
    expect(new Set(tokens).size).toBe(200);
    // 256 bits: every character position is used by many different characters.
    for (let position = 0; position < 4; position += 1) expect(new Set(tokens.map((token) => token[position])).size).toBeGreaterThan(20);
  });

  test("only an exact value counts: chunked records are joined, several records are all considered, and nothing is searched for inside one", () => {
    const value = verificationRecordValue("abc123");
    expect(txtRecordsMatch([[value]], value)).toBe(true);
    // A record longer than 255 bytes is stored in chunks and means their concatenation.
    expect(txtRecordsMatch([[value.slice(0, 10), value.slice(10, 20), value.slice(20)]], value)).toBe(true);
    // Several records at the name: it is enough that one is exact.
    expect(txtRecordsMatch([["v=spf1 -all"], ["something else"], [value]], value)).toBe(true);
    // Not exact: a longer value, a shorter one, other text around it, another case, another token, surrounding space.
    for (const wrong of [`${value}x`, value.slice(0, -1), `prefix ${value}`, `${value} suffix`, value.toUpperCase(), verificationRecordValue("other"), ` ${value}`, `${value} `, `"${value}"`, `a=b;${value}`]) {
      expect(txtRecordsMatch([[wrong]], value), wrong).toBe(false);
    }
    // Chunks that only form the value when joined with something between them are not the value.
    expect(txtRecordsMatch([[value.slice(0, 10), " ", value.slice(10)]], value)).toBe(false);
    expect(txtRecordsMatch([], value)).toBe(false);
    expect(txtRecordsMatch([[]], value)).toBe(false);
    expect(txtRecordsMatch([[value], [value + "!"]], value)).toBe(true);
  });

  test("the person is told how to point DNS: a name beneath a domain gets a CNAME, a root domain does not, and no address is invented", () => {
    expect(looksLikeRootDomain("example.com")).toBe(true);
    expect(looksLikeRootDomain("example.co.uk")).toBe(true);
    expect(looksLikeRootDomain("www.example.com")).toBe(false);
    expect(looksLikeRootDomain("heating.example.co.uk")).toBe(false);
    const sub = routingAdvice("www.example.com", "sites.climvia.com");
    expect(sub.emphasis).toBe("subdomain");
    expect(sub.subdomain).toBe("Create a CNAME record for www.example.com that points to sites.climvia.com.");
    const root = routingAdvice("example.com", "sites.climvia.com");
    expect(root.emphasis).toBe("root");
    expect(root.root).toMatch(/ALIAS, ANAME or CNAME-flattening/);
    expect(root.root).toContain("sites.climvia.com");
    expect(root.root).not.toMatch(/create a CNAME record for example\.com/i);
    // No target configured: nothing is made up, and no IP address appears.
    const none = routingAdvice("example.com", null);
    expect(none.target).toBeNull();
    expect(none.root).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(none.subdomain).toContain("when production routing is set up");
  });
});

test.describe("asking DNS", () => {
  test("the test resolver answers one name from one file, and anything it can not be sure of is no record", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dns-"));
    try {
      writeFileSync(join(directory, "_climvia-verification.a.example.test.json"), JSON.stringify([["part-one", "part-two"], ["other"]]));
      writeFileSync(join(directory, "_climvia-verification.slow.example.test.json"), JSON.stringify("timeout"));
      writeFileSync(join(directory, "_climvia-verification.broken.example.test.json"), "{not json");
      const resolver = fixtureResolver(directory);
      expect(await resolver.resolveTxt("_climvia-verification.a.example.test")).toEqual({ kind: "records", records: [["part-one", "part-two"], ["other"]] });
      expect(await resolver.resolveTxt("_CLIMVIA-verification.A.example.test")).toEqual({ kind: "records", records: [["part-one", "part-two"], ["other"]] });
      expect(await resolver.resolveTxt("_climvia-verification.slow.example.test")).toEqual({ kind: "unavailable" });
      expect(await resolver.resolveTxt("_climvia-verification.broken.example.test")).toEqual({ kind: "none" });
      expect(await resolver.resolveTxt("_climvia-verification.missing.example.test")).toEqual({ kind: "none" });
      // A name that could name a path never reads a file.
      for (const hostile of ["../etc/passwd", "..\\x", "a/b", "", ".hidden", "a b"]) expect(await resolver.resolveTxt(hostile), hostile).toEqual({ kind: "none" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the application uses the system's DNS unless a test fixture directory is set explicitly, and then only with both settings", () => {
    expect(resolverFromEnv({}).kind).toBe("system");
    expect(resolverFromEnv({ DOMAIN_DNS_RESOLVER: "fixture" }).kind).toBe("system");
    expect(resolverFromEnv({ DOMAIN_DNS_FIXTURE_DIR: "/x" }).kind).toBe("system");
    expect(resolverFromEnv({ DOMAIN_DNS_RESOLVER: "system", DOMAIN_DNS_FIXTURE_DIR: "/x" }).kind).toBe("system");
    expect(resolverFromEnv({ DOMAIN_DNS_RESOLVER: "fixture", DOMAIN_DNS_FIXTURE_DIR: "/x" }).kind).toBe("fixture");
  });

  test("a lookup that never answers gives up in a bounded time and says DNS was unavailable, not that the record is missing", async () => {
    // 192.0.2.0/24 is reserved for documentation and is never routed: a resolver pointed there can only time out (or find no route).
    const bounded = systemResolver(300, ["192.0.2.1"]);
    const started = Date.now();
    expect(await bounded.resolveTxt("_climvia-verification.example.test")).toEqual({ kind: "unavailable" });
    expect(Date.now() - started).toBeLessThan(6000);
  });
});
