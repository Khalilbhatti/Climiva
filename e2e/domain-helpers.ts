/**
 * Shared by the custom-domain specs: names no other test uses, DNS answers for the test server, and the platform's own names as the test
 * server sees them. (Not a spec: a helper exported from a `*.spec.ts` would register that file's tests again where it is imported.)
 *
 * Nothing here touches the internet. `.example.test` is reserved for testing and never resolves; DNS answers are files in a directory the
 * test server reads (DOMAIN_DNS_FIXTURE_DIR, set by playwright.config.ts), one per DNS name, so parallel tests cannot overwrite each other.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join, resolve } from "node:path";
import type { Pool } from "pg";
import { verificationRecordName, verificationRecordValue } from "../src/lib/domain-rules";
import type { HostConfig } from "../src/lib/hostname";
import { fixtureResolver } from "../src/lib/dns-resolver";

/** The platform's names as the test server is configured (playwright.config.ts sets CUSTOM_DOMAIN_TARGET). */
// A deployment that answers on a domain of its own (APP_HOSTS) and has a name for customers to point at; the tests use the product's own as examples.
export const TEST_HOST_CONFIG: HostConfig = { appHosts: ["climvia.com"], customDomainTarget: "sites.climvia.com" };

/** A name nobody else is using, so parallel workers and repeated runs never collide on the global uniqueness of a hostname. */
export const uniqueHost = (tag = "site"): string => `${tag}-${randomBytes(4).toString("hex")}.example.test`;

export const DNS_DIR = resolve(process.env.DOMAIN_DNS_FIXTURE_DIR ?? join(".data", "dns-test"));

/** Give the test server's resolver an answer for a DNS name: records (each a list of chunks), "timeout" or "error". */
export function setDns(name: string, answer: string[][] | "timeout" | "error"): void {
  mkdirSync(DNS_DIR, { recursive: true });
  writeFileSync(join(DNS_DIR, `${name.toLowerCase()}.json`), JSON.stringify(answer));
}

/** Put the verification record for a claim in place, the way the person would in their DNS provider. */
export function publishTxt(hostname: string, token: string): void {
  setDns(verificationRecordName(hostname), [[verificationRecordValue(token)]]);
}

/** The same resolver the test server uses, for the specs that call the verification service in the test process. */
export const testResolver = () => fixtureResolver(DNS_DIR);

export type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

/**
 * One HTTP request with whatever Host header the test wants. `fetch` and the browser decide the Host for themselves; a custom domain is
 * "a request whose Host is that name", and no real DNS is needed to send one straight to the test server.
 */
export function rawRequest(origin: string, path: string, options: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<RawResponse> {
  const target = new URL(origin);
  return new Promise((resolveResponse, reject) => {
    const req = request(
      { hostname: target.hostname, port: target.port, path, method: options.method ?? "GET", headers: { ...(options.host ? { host: options.host } : {}), ...options.headers } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolveResponse({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

/** Give a site of an organization an ACTIVE claim on a name directly (as the owner role), to set up what the routing tests then request. Returns its token. */
export async function insertActiveClaim(admin: Pool, organizationId: string, hostname: string, options: { siteSlug?: string; primary?: boolean } = {}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const inserted = await admin.query(
    `insert into site_domains (organization_id, site_id, hostname, status, verification_token, verified_at, activated_at, is_primary)
     select organization_id, id, $3, 'active', $4, now(), now(), $5 from sites where organization_id = $1 and slug = $2 returning id`,
    [organizationId, options.siteSlug ?? "main", hostname, token, options.primary ?? true],
  );
  if (inserted.rowCount !== 1) throw new Error(`No site ${options.siteSlug ?? "main"} to claim ${hostname} for.`);
  return token;
}
