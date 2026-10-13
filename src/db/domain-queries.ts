/**
 * Custom domains: the data access, inside an open tenant transaction.
 *
 *   Organization -> Site -> Domains      a claim belongs to a Site, found INSIDE the verified organization
 *
 *   claimDomain             a name, normalized and checked, becomes a PENDING claim with a new random token
 *   beginOwnershipCheck     stamp the check (this is also the cooldown) and hand back what the DNS lookup needs
 *   markVerified            the TXT record was found: pending -> verified
 *   activateDomain          verified (or disabled) -> active; the first active domain of a Site becomes its main one
 *   disableDomain           active -> disabled; the claim is kept
 *   removeDomain            any -> removed; the name is free again, and a new claim of it gets a NEW token
 *   setMainDomain           make one active domain the Site's main one, or stop any domain being main
 *
 * Every write that changes a Site's domains first locks the SITE row (`FOR UPDATE`), the same lock every other write to that Site takes, so
 * two requests for one Site queue up: two activations leave exactly one main domain. A claim is then locked and checked against the
 * REVISION the person's screen showed, so a screen that is behind can never activate a disabled claim or restore a removed one. The
 * database enforces the same rules again (migrations 0019 and 0020), so none of this is the only check.
 *
 * The DNS lookup is not here and never happens while a transaction is open: it is a network wait, and it is done between two short ones
 * (src/db/domain-verification).
 *
 * No `server-only` import on purpose (shared with the specs); nothing under src/ that is a Client Component may import this file.
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { DomainRecord, DomainState } from "@/data/website";
import {
  DNS_CHECK_COOLDOWN_SECONDS,
  DOMAIN_LIMIT,
  DOMAIN_MISSING,
  DOMAIN_NEEDS_VERIFICATION,
  DOMAIN_STALE,
  MAX_DOMAINS_PER_SITE,
  verificationRecordName,
  verificationRecordValue,
} from "@/lib/domain-rules";
import { HOSTNAME_PROBLEM_TEXT, RESERVED_DOMAIN_TEXT, normalizeHostname, reservedReason, type HostConfig } from "@/lib/hostname";
import { refuse } from "@/lib/refusal";
import type { Tx } from "./index";
import { siteDomains, sites, type SiteDomainRow } from "./schema";

export type DomainContext = { tx: Tx; organizationId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 32 random bytes, base64url: 43 characters. From the operating system's strong random source and from nothing about the claim. */
export const newVerificationToken = (): string => randomBytes(32).toString("base64url");

/* ───────────────────────── reading ───────────────────────── */

function recordOf(row: SiteDomainRow, reveal: boolean): DomainRecord {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status as DomainRecord["status"],
    isPrimary: row.isPrimary,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    // The token goes only to people who may manage the website, and only while the record it belongs to is still needed.
    verification:
      reveal && row.status === "pending_verification"
        ? { recordName: verificationRecordName(row.hostname), recordValue: verificationRecordValue(row.verificationToken) }
        : null,
  };
}

/** A Site's claims that have not been removed, oldest first. `reveal` says whether the caller may see the verification record. */
export async function loadDomainState(tx: Tx, organizationId: string, siteId: string, reveal: boolean, routingTarget: string | null): Promise<DomainState> {
  const rows = await tx
    .select()
    .from(siteDomains)
    .where(and(eq(siteDomains.organizationId, organizationId), eq(siteDomains.siteId, siteId), ne(siteDomains.status, "removed")))
    .orderBy(asc(siteDomains.createdAt), asc(siteDomains.id));
  return { domains: rows.map((row) => recordOf(row, reveal)), routingTarget };
}

/* ───────────────────────── helpers ───────────────────────── */

async function lockSiteRow(ctx: DomainContext, siteId: string): Promise<void> {
  const rows = await ctx.tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, siteId)))
    .limit(1)
    .for("update");
  if (!rows[0]) return refuse("That website no longer exists. Reload the page and try again.");
}

function checkedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return refuse(DOMAIN_STALE);
  return value;
}

/** A claim of this Site, locked. A malformed id, another business's claim and a removed one are all "not found". */
async function lockDomain(ctx: DomainContext, siteId: string, domainId: unknown, expectedRevision: unknown): Promise<SiteDomainRow> {
  if (typeof domainId !== "string" || !UUID.test(domainId)) return refuse(DOMAIN_MISSING);
  const revision = checkedRevision(expectedRevision);
  const rows = await ctx.tx
    .select()
    .from(siteDomains)
    .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.siteId, siteId), eq(siteDomains.id, domainId)))
    .limit(1)
    .for("update");
  const row = rows[0];
  if (!row || row.status === "removed") return refuse(DOMAIN_MISSING);
  if (row.revision !== revision) return refuse(DOMAIN_STALE);
  return row;
}

/* ───────────────────────── claiming ───────────────────────── */

/**
 * Claim a name for a Site: normalize it, refuse what is reserved or already in use anywhere, and store a PENDING claim with a new token.
 * Nothing about a name that is already claimed is revealed: the unique index refuses it and the caller shows one generic sentence.
 */
export async function claimDomain(ctx: DomainContext, siteId: string, input: unknown, userId: string, config: HostConfig): Promise<DomainRecord["id"]> {
  const normalized = normalizeHostname(input);
  if (!normalized.ok) return refuse(HOSTNAME_PROBLEM_TEXT[normalized.problem], { domain: HOSTNAME_PROBLEM_TEXT[normalized.problem] });
  if (reservedReason(normalized.hostname, config)) return refuse(RESERVED_DOMAIN_TEXT, { domain: RESERVED_DOMAIN_TEXT });

  await lockSiteRow(ctx, siteId);
  const held = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(siteDomains)
    .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.siteId, siteId), ne(siteDomains.status, "removed")));
  if ((held[0]?.n ?? 0) >= MAX_DOMAINS_PER_SITE) return refuse(DOMAIN_LIMIT, { domain: DOMAIN_LIMIT });

  const [row] = await ctx.tx
    .insert(siteDomains)
    .values({ organizationId: ctx.organizationId, siteId, hostname: normalized.hostname, verificationToken: newVerificationToken(), createdByUserId: userId })
    .returning({ id: siteDomains.id });
  return row.id;
}

/* ───────────────────────── proving ownership ───────────────────────── */

export type OwnershipCheck =
  /** Not verified yet: look up `recordName` and compare with `recordValue`. */
  | { kind: "pending"; id: string; hostname: string; token: string; revision: number }
  /** Already verified (or beyond): nothing to look up, and nothing to change. */
  | { kind: "settled" }
  /** Checked a moment ago. */
  | { kind: "too-soon" };

/**
 * The first half of a check, in its own short transaction. It stamps `last_checked_at` in ONE conditional statement, so the cooldown holds
 * across requests and processes, and two clicks at once cannot both go on to ask DNS.
 */
export async function beginOwnershipCheck(ctx: DomainContext, siteId: string, domainId: unknown, expectedRevision: unknown): Promise<OwnershipCheck> {
  if (typeof domainId !== "string" || !UUID.test(domainId)) return refuse(DOMAIN_MISSING);
  const revision = checkedRevision(expectedRevision);
  const rows = await ctx.tx
    .select()
    .from(siteDomains)
    .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.siteId, siteId), eq(siteDomains.id, domainId)))
    .limit(1);
  const row = rows[0];
  if (!row || row.status === "removed") return refuse(DOMAIN_MISSING);
  if (row.revision !== revision) return refuse(DOMAIN_STALE);
  if (row.status !== "pending_verification") return { kind: "settled" };

  const stamped = await ctx.tx
    .update(siteDomains)
    .set({ lastCheckedAt: sql`now()` })
    .where(
      and(
        eq(siteDomains.organizationId, ctx.organizationId),
        eq(siteDomains.siteId, siteId),
        eq(siteDomains.id, domainId),
        eq(siteDomains.status, "pending_verification"),
        sql`(${siteDomains.lastCheckedAt} is null or ${siteDomains.lastCheckedAt} <= now() - make_interval(secs => ${DNS_CHECK_COOLDOWN_SECONDS}))`,
      ),
    )
    .returning({ revision: siteDomains.revision });
  if (stamped.length === 0) return { kind: "too-soon" };
  return { kind: "pending", id: row.id, hostname: row.hostname, token: row.verificationToken, revision: stamped[0].revision };
}

/**
 * The second half: the record was found, so the claim is verified. It only applies to the SAME pending claim the check started on (the
 * token is part of the match), and if the claim was verified in the meantime that is not a failure. Repeating it changes nothing.
 */
export async function markVerified(ctx: DomainContext, siteId: string, domainId: string, token: string): Promise<"verified" | "settled"> {
  const changed = await ctx.tx
    .update(siteDomains)
    .set({ status: "verified", verifiedAt: sql`now()` })
    .where(
      and(
        eq(siteDomains.organizationId, ctx.organizationId),
        eq(siteDomains.siteId, siteId),
        eq(siteDomains.id, domainId),
        eq(siteDomains.status, "pending_verification"),
        eq(siteDomains.verificationToken, token),
      ),
    )
    .returning({ id: siteDomains.id });
  if (changed.length > 0) return "verified";
  const rows = await ctx.tx
    .select({ status: siteDomains.status })
    .from(siteDomains)
    .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.siteId, siteId), eq(siteDomains.id, domainId)))
    .limit(1);
  const status = rows[0]?.status;
  if (status === "verified" || status === "active" || status === "disabled") return "settled";
  return refuse(DOMAIN_MISSING);
}

/* ───────────────────────── serving ───────────────────────── */

/**
 * Let this application serve the Site for requests whose Host is this name. Only a verified (or previously active, now disabled) claim can
 * be activated. The Site's first active domain becomes its main one.
 */
export async function activateDomain(ctx: DomainContext, siteId: string, domainId: unknown, expectedRevision: unknown): Promise<void> {
  await lockSiteRow(ctx, siteId);
  const row = await lockDomain(ctx, siteId, domainId, expectedRevision);
  if (row.status === "active") return;
  if (row.status === "pending_verification") return refuse(DOMAIN_NEEDS_VERIFICATION);
  const main = await ctx.tx
    .select({ id: siteDomains.id })
    .from(siteDomains)
    .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.siteId, siteId), eq(siteDomains.isPrimary, true)))
    .limit(1);
  await ctx.tx
    .update(siteDomains)
    .set({ status: "active", activatedAt: sql`now()`, disabledAt: null, isPrimary: main.length === 0 })
    .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.id, row.id)));
}

/** Stop serving the Site through this name. The claim is kept, and it is no longer the main domain. */
export async function disableDomain(ctx: DomainContext, siteId: string, domainId: unknown, expectedRevision: unknown): Promise<void> {
  await lockSiteRow(ctx, siteId);
  const row = await lockDomain(ctx, siteId, domainId, expectedRevision);
  if (row.status === "disabled") return;
  if (row.status !== "active") return refuse("Only an active domain can be disabled.");
  await ctx.tx
    .update(siteDomains)
    .set({ status: "disabled", disabledAt: sql`now()`, isPrimary: false })
    .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.id, row.id)));
}

/** Release the name. The claim stays as history; the name can be claimed again, with a new token. */
export async function removeDomain(ctx: DomainContext, siteId: string, domainId: unknown, expectedRevision: unknown): Promise<void> {
  await lockSiteRow(ctx, siteId);
  const row = await lockDomain(ctx, siteId, domainId, expectedRevision);
  await ctx.tx
    .update(siteDomains)
    .set({ status: "removed", removedAt: sql`now()`, isPrimary: false })
    .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.id, row.id)));
}

/**
 * Choose which address is the Site's main one. `main: true` makes this ACTIVE domain the main one (and any other stops being); `main: false`
 * stops it being main, which leaves the platform address as the main one (the domain keeps serving the Site).
 */
export async function setMainDomain(ctx: DomainContext, siteId: string, domainId: unknown, expectedRevision: unknown, main: boolean): Promise<void> {
  await lockSiteRow(ctx, siteId);
  const row = await lockDomain(ctx, siteId, domainId, expectedRevision);
  if (main) {
    if (row.status !== "active") return refuse("Only an active domain can be the main address.");
    if (row.isPrimary) return;
    await ctx.tx
      .update(siteDomains)
      .set({ isPrimary: false })
      .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.siteId, siteId), eq(siteDomains.isPrimary, true)));
  } else if (!row.isPrimary) {
    return;
  }
  await ctx.tx
    .update(siteDomains)
    .set({ isPrimary: main })
    .where(and(eq(siteDomains.organizationId, ctx.organizationId), eq(siteDomains.id, row.id)));
}
