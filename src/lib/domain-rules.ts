/**
 * Custom domains: what a claim on a hostname is, the states it moves through, and how its ownership is proved.
 *
 * Pure: no database, no network. The same rules are enforced again by PostgreSQL (migration 0020: the transition guard, the lifecycle
 * CHECK, the unique indexes), so a request that skips a step is refused twice.
 *
 *   Organization -> Site -> Domains         a domain belongs to a SITE, never straight to an organization
 *
 *   pending_verification   the claim exists; ownership is NOT proved
 *   verified               the TXT record was found: the person controls the domain
 *   active                 this application will serve the Site when a request arrives with this Host
 *   disabled               the application no longer serves the Site through it (the claim is kept)
 *   removed                released: history only, the hostname can be claimed again, with a NEW token
 *
 * "Active" is a fact about THIS APPLICATION. Whether a visitor can actually reach it also needs the domain's DNS to point at Climvia and a
 * certificate for the name, which are infrastructure and are not proved here.
 */

export const DOMAIN_STATUSES = ["pending_verification", "verified", "active", "disabled", "removed"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/** The moves a claim can make. Everything not listed is refused (a pending claim can never go straight to active). */
export const DOMAIN_TRANSITIONS: Record<DomainStatus, readonly DomainStatus[]> = {
  pending_verification: ["verified", "removed"],
  verified: ["active", "removed"],
  active: ["disabled", "removed"],
  disabled: ["active", "removed"],
  removed: [],
};

export const canMoveDomain = (from: DomainStatus, to: DomainStatus): boolean => from === to || DOMAIN_TRANSITIONS[from].includes(to);

/** Statuses that still hold the hostname (a removed claim does not). */
export const HOLDING_STATUSES: readonly DomainStatus[] = ["pending_verification", "verified", "active", "disabled"];

/** What the Domain Manager calls each state. Nothing says "live", "connected" or "secure": those are facts about DNS and certificates. */
export const DOMAIN_STATUS_LABEL: Record<DomainStatus, string> = {
  pending_verification: "Ownership not verified",
  verified: "Verified",
  active: "Active in Climvia",
  disabled: "Disabled",
  removed: "Removed",
};

/** One Site holds at most this many claims at a time (a claim is cheap to create, so the number is bounded). */
export const MAX_DOMAINS_PER_SITE = 10;

/** After a check, the next one for the same domain waits this long. Stored in the database (`last_checked_at`), so it holds across processes. */
export const DNS_CHECK_COOLDOWN_SECONDS = 10;

/* ───────────────────────── the verification record ───────────────────────── */

/** The same convention for a root domain and a subdomain: a TXT record on `_climvia-verification.<domain>`. */
export const VERIFICATION_LABEL = "_climvia-verification";
export const VERIFICATION_VALUE_PREFIX = "climvia-site-verification=";

/** 32 random bytes as base64url: 43 characters. */
export const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const verificationRecordName = (hostname: string): string => `${VERIFICATION_LABEL}.${hostname}`;
export const verificationRecordValue = (token: string): string => `${VERIFICATION_VALUE_PREFIX}${token}`;

/**
 * Does the DNS answer hold the expected value? `records` is what the resolver returns: one entry per TXT record, each a list of the
 * chunks it was stored in (a record longer than 255 bytes is split). A record's logical value is its chunks joined; it must EQUAL the
 * expected value. Nothing is searched for inside a record, so text around the value (or a record that merely contains it) does not count.
 */
export function txtRecordsMatch(records: readonly (readonly string[])[], expected: string): boolean {
  return records.some((chunks) => chunks.join("") === expected);
}

/* ───────────────────────── telling the person where to point DNS ───────────────────────── */

/** Second-level labels under which a two-letter country domain behaves like a registry of its own (`example.co.uk`). */
const REGISTRY_SECOND_LEVELS = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ltd", "plc", "sch"]);

/** Is this the domain itself (`example.com`, `example.co.uk`) rather than a name beneath it (`www.example.com`)? A guess, used only to choose which advice to show first. */
export function looksLikeRootDomain(hostname: string): boolean {
  const labels = hostname.split(".");
  if (labels.length <= 2) return true;
  const top = labels[labels.length - 1];
  return labels.length === 3 && top.length === 2 && REGISTRY_SECOND_LEVELS.has(labels[labels.length - 2]);
}

export type RoutingAdvice = {
  /** The name customers point DNS at, or null while the platform has not published one. */
  target: string | null;
  /** What to do for a name beneath a domain (`www.example.com`). */
  subdomain: string;
  /** What to do for the root of a domain (`example.com`): a CNAME there is not allowed by most DNS providers. */
  root: string;
  /** Which of the two applies to this name first. */
  emphasis: "subdomain" | "root";
};

export function routingAdvice(hostname: string, target: string | null): RoutingAdvice {
  const to = target ?? "the address Climvia gives you when production routing is set up";
  return {
    target,
    subdomain: `Create a CNAME record for ${hostname} that points to ${to}.`,
    root: `A root domain usually can't have a CNAME. Use your DNS provider's ALIAS, ANAME or CNAME-flattening record for ${hostname} pointing to ${to}, or the A and AAAA addresses Climvia publishes for production routing.`,
    emphasis: looksLikeRootDomain(hostname) ? "root" : "subdomain",
  };
}

/** The standing disclaimer: what "Active in Climvia" does and does not mean. */
export const ACTIVATION_NOTE =
  "Active in Climvia means Climvia will show your website for this domain when a request for it arrives. Your domain's DNS must also point to Climvia, and a security certificate must be in place, before visitors can open it.";

/* ───────────────────────── messages the screen shows ───────────────────────── */

export const DOMAIN_IN_USE = "This domain is already in use.";
export const DOMAIN_LIMIT = `A website can have up to ${MAX_DOMAINS_PER_SITE} domains. Remove one you don't need first.`;
export const DOMAIN_STALE = "This domain changed since you opened this page. Reload the page and try again.";
export const DOMAIN_MISSING = "That domain was not found.";
export const DNS_NOT_FOUND = "We couldn't find the verification record yet. DNS changes can take a while to appear. Check the record and try again.";
export const DNS_WRONG_VALUE = "A verification record was found, but its value isn't the one shown here. Check that you copied it exactly.";
export const DNS_UNAVAILABLE = "We couldn't reach DNS just now. Your domain is unchanged. Try again in a moment.";
export const DNS_TOO_SOON = "That domain was checked a moment ago. Wait a few seconds and try again.";
export const DOMAIN_NEEDS_VERIFICATION = "Verify ownership of this domain first.";

/** What an ownership check found (src/db/domain-verification). Only "verified" and "settled" change nothing the person must fix. */
export type OwnershipOutcome = "verified" | "settled" | "not-found" | "wrong-value" | "unavailable" | "too-soon";

/** The sentence for each outcome, or null when the claim is verified and the screen simply shows it. */
export const OWNERSHIP_OUTCOME_TEXT: Record<OwnershipOutcome, string | null> = {
  verified: null,
  settled: null,
  "not-found": DNS_NOT_FOUND,
  "wrong-value": DNS_WRONG_VALUE,
  unavailable: DNS_UNAVAILABLE,
  "too-soon": DNS_TOO_SOON,
};
