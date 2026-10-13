/**
 * Looking up a domain's DNS, behind one narrow interface.
 *
 * The domain model needs exactly one thing from DNS: the TXT records at a name. Nothing else here knows how they are fetched, and nothing
 * is tied to a DNS provider: Climvia only READS what the business has put in their own DNS, it never writes a record anywhere (no Route 53
 * or other provider API is called, and no credentials are involved).
 *
 *   systemResolver   Node's DNS client against the machine's resolvers, with a bounded wait (the default).
 *   fixtureResolver  answers from a directory of JSON files, one per DNS name, for the automated tests only (see `resolverFromEnv`).
 *
 * An answer is one of three things, never an exception: records, "there is no such record", or "DNS could not be asked just now". The
 * difference matters: only the second says anything about the domain, and the third must never change a claim.
 *
 * No `server-only` import on purpose: the specs inject their own resolver.
 */
import { readFileSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { join } from "node:path";

export type DnsAnswer =
  /** Each entry is one TXT record, as the list of chunks it is stored in (a record longer than 255 bytes is split). */
  | { kind: "records"; records: string[][] }
  | { kind: "none" }
  | { kind: "unavailable" };

export interface DnsResolver {
  /** Which kind of resolver this is: "system" in production, "fixture" under the tests, anything for a stand-in a spec supplies. */
  readonly kind: string;
  resolveTxt(name: string): Promise<DnsAnswer>;
}

/** The longest a lookup may take before the answer is "unavailable". */
export const DNS_TIMEOUT_MS = 4000;

/** DNS error codes that mean "this name has no such record", as opposed to "could not ask". */
const NO_RECORD = new Set(["ENOTFOUND", "ENODATA"]);

export function systemResolver(timeoutMs: number = DNS_TIMEOUT_MS, servers?: readonly string[]): DnsResolver {
  return {
    kind: "system",
    async resolveTxt(name) {
      const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
      // The machine's resolvers, unless a caller names others (the specs point it at an address that never answers).
      if (servers) resolver.setServers([...servers]);
      // Resolver's own timeout is per attempt; this stops the whole lookup.
      const timer = setTimeout(() => resolver.cancel(), timeoutMs + 500);
      try {
        const records = await resolver.resolveTxt(name);
        return records.length > 0 ? { kind: "records", records } : { kind: "none" };
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
        return NO_RECORD.has(code) ? { kind: "none" } : { kind: "unavailable" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * A resolver that answers from files: the answer for `<name>` is in `<directory>/<name>.json`, as `[["chunk", "chunk"], ["another record"]]`
 * (a list of TXT records, each a list of chunks), or the string "timeout" or "error" to make that name unavailable. A name with no file has no
 * record. A file per name (not one shared file) is what lets parallel tests each set their own answers without overwriting one another. The
 * file is read on every lookup so a test can change it between clicks. For the tests only.
 */
export function fixtureResolver(directory: string): DnsResolver {
  return {
    kind: "fixture",
    async resolveTxt(name) {
      const key = name.toLowerCase();
      // A DNS name has only these characters; anything else could name a path, and has no answer.
      if (!/^[a-z0-9._-]{1,253}$/.test(key) || key.startsWith(".")) return { kind: "none" };
      let entry: unknown;
      try {
        entry = JSON.parse(readFileSync(join(directory, `${key}.json`), "utf8"));
      } catch {
        return { kind: "none" };
      }
      if (entry === "timeout" || entry === "error") return { kind: "unavailable" };
      if (!Array.isArray(entry) || entry.length === 0) return { kind: "none" };
      const records = entry.filter((record): record is string[] => Array.isArray(record) && record.every((chunk) => typeof chunk === "string"));
      return records.length > 0 ? { kind: "records", records } : { kind: "none" };
    },
  };
}

/**
 * The resolver the application uses: the system's, unless BOTH `DOMAIN_DNS_RESOLVER=fixture` and `DOMAIN_DNS_FIXTURE_DIR` are set. The
 * fixture is how the browser tests supply DNS answers to a running server; nothing in .env.example or the Dockerfile sets it, and a spec
 * checks that.
 */
export function resolverFromEnv(env: Record<string, string | undefined> = process.env): DnsResolver {
  if (env.DOMAIN_DNS_RESOLVER === "fixture" && env.DOMAIN_DNS_FIXTURE_DIR) return fixtureResolver(env.DOMAIN_DNS_FIXTURE_DIR);
  return systemResolver();
}
