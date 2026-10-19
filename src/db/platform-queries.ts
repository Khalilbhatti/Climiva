/**
 * The platform console's door to the database: nothing but calls to the `app_platform_*` SQL functions (migration 0023) and `app_is_platform_admin()`.
 *
 *   app_is_platform_admin()                         is the CURRENT user a platform administrator?
 *   app_platform_overview() / _system()             aggregate counts and diagnostics
 *   app_platform_organizations() / _organization()  businesses across the platform, and one in detail
 *   app_platform_users()                            accounts (identity facts and memberships; never a credential)
 *   app_platform_listings()                         Marketplace listings with the platform's moderation decision
 *   app_platform_reviews()                          reviews across businesses (read-only)
 *   app_platform_audit_recent()                     the latest entries of the audit trail
 *   app_platform_set_listing_moderation()           suspend or allow a listing (the one write; audited in the same transaction)
 *
 * Every call runs as the verified user (`withUser` sets the transaction-local `app.user_id`), and every function refuses unless the database says that
 * user is an administrator: this module does not decide who may call, it only calls, and the server layer (src/server/platform-admin.ts) asks first.
 * No table is named here (the runtime role has no privilege on the platform tables), so a test can hold the file to "functions only".
 *
 * No `server-only` import on purpose (tests call these directly); nothing under src/ that is a Client Component may import this file.
 */
import { sql } from "drizzle-orm";
import { isUuid, withUser } from "./tenant";

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const maybeText = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0);
const flag = (value: unknown): boolean => value === true;

export const PAGE_SIZE = 25;

export type Page<T> = { total: number; rows: T[] };
export type ModerationDecision = { state: "allowed" | "suspended"; reason: string | null; decidedAt: string | null };

async function ask(administratorId: string, query: ReturnType<typeof sql>): Promise<unknown> {
  return withUser(administratorId, async (tx) => (await tx.execute<{ data: unknown }>(query)).rows[0]?.data);
}

/** A page past the end of a list (an old bookmark, a list that shrank) is the last page, not an empty one. */
async function lastPageWhenPast<T>(read: (page: number) => Promise<Page<T>>, page: number): Promise<Page<T>> {
  const first = await read(page);
  return first.rows.length > 0 || first.total === 0 || page <= 1 ? first : read(Math.ceil(first.total / PAGE_SIZE));
}

const decision = (value: unknown): ModerationDecision => {
  const raw = record(value);
  return { state: raw.state === "suspended" ? "suspended" : "allowed", reason: maybeText(raw.reason), decidedAt: maybeText(raw.decidedAt) };
};

/** Whether this verified user is a platform administrator right now. False for everyone who is not, and for an id that is not a user. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  if (typeof userId !== "string" || userId.length === 0 || userId.length > 128) return false;
  return (await ask(userId, sql`select app_is_platform_admin() as data`)) === true;
}

export type PlatformOverview = Record<"organizations" | "users" | "activeMemberships" | "sites" | "publishedSites" | "listings" | "publishedListings" | "suspendedListings" | "bookings" | "reviews", number>;

export async function platformOverview(administratorId: string): Promise<PlatformOverview> {
  const raw = record(await ask(administratorId, sql`select app_platform_overview() as data`));
  return {
    organizations: count(raw.organizations),
    users: count(raw.users),
    activeMemberships: count(raw.activeMemberships),
    sites: count(raw.sites),
    publishedSites: count(raw.publishedSites),
    listings: count(raw.listings),
    publishedListings: count(raw.publishedListings),
    suspendedListings: count(raw.suspendedListings),
    bookings: count(raw.bookings),
    reviews: count(raw.reviews),
  };
}

export type PlatformOrganizationRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberships: number;
  owners: number;
  services: number;
  sites: number;
  publishedSites: number;
  listingStatus: string | null;
  listingModeration: "allowed" | "suspended" | null;
};

async function readOrganizations(administratorId: string, search: string, page: number): Promise<Page<PlatformOrganizationRow>> {
  const raw = record(await ask(administratorId, sql`select app_platform_organizations(${search}, ${PAGE_SIZE}, ${(Math.max(page, 1) - 1) * PAGE_SIZE}) as data`));
  return {
    total: count(raw.total),
    rows: list(raw.rows).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      slug: text(row.slug),
      createdAt: text(row.createdAt),
      memberships: count(row.memberships),
      owners: count(row.owners),
      services: count(row.services),
      sites: count(row.sites),
      publishedSites: count(row.publishedSites),
      listingStatus: maybeText(row.listingStatus),
      listingModeration: row.listingModeration === "suspended" ? "suspended" : row.listingModeration === "allowed" ? "allowed" : null,
    })),
  };
}

export const platformOrganizations = (administratorId: string, search: string, page: number) => lastPageWhenPast((current) => readOrganizations(administratorId, search, current), page);

export type PlatformOrganizationDetail = {
  profile: Record<"id" | "name" | "slug" | "timezone" | "currency" | "createdAt", string> & Record<"phone" | "email" | "addressLine1" | "addressLine2" | "city" | "stateRegion" | "postalCode" | "country" | "onboardingCompletedAt", string | null>;
  memberships: { userId: string; name: string; email: string; role: string; status: string; since: string }[];
  services: { id: string; name: string; isActive: boolean; visibility: string; bookingMethod: string }[];
  sites: { id: string; name: string; platformSlug: string; isPrimary: boolean; status: string; published: boolean }[];
  listing: { id: string; publicSlug: string; status: string; publishedAt: string | null; selectedServices: number; moderation: ModerationDecision } | null;
  counts: Record<"customers" | "bookings" | "jobs" | "quotes" | "invoices" | "payments" | "reviews" | "domains", number>;
};

export async function platformOrganization(administratorId: string, organizationId: string): Promise<PlatformOrganizationDetail | null> {
  if (!isUuid(organizationId)) return null;
  const raw = await ask(administratorId, sql`select app_platform_organization(${organizationId}::uuid) as data`);
  if (raw === null || raw === undefined) return null;
  const detail = record(raw);
  const profile = record(detail.profile);
  const listing = record(detail.listing);
  const counts = record(detail.counts);
  return {
    profile: {
      id: text(profile.id),
      name: text(profile.name),
      slug: text(profile.slug),
      timezone: text(profile.timezone),
      currency: text(profile.currency),
      createdAt: text(profile.createdAt),
      phone: maybeText(profile.phone),
      email: maybeText(profile.email),
      addressLine1: maybeText(profile.addressLine1),
      addressLine2: maybeText(profile.addressLine2),
      city: maybeText(profile.city),
      stateRegion: maybeText(profile.stateRegion),
      postalCode: maybeText(profile.postalCode),
      country: maybeText(profile.country),
      onboardingCompletedAt: maybeText(profile.onboardingCompletedAt),
    },
    memberships: list(detail.memberships).map((row) => ({ userId: text(row.userId), name: text(row.name), email: text(row.email), role: text(row.role), status: text(row.status), since: text(row.since) })),
    services: list(detail.services).map((row) => ({ id: text(row.id), name: text(row.name), isActive: flag(row.isActive), visibility: text(row.visibility), bookingMethod: text(row.bookingMethod) })),
    sites: list(detail.sites).map((row) => ({ id: text(row.id), name: text(row.name), platformSlug: text(row.platformSlug), isPrimary: flag(row.isPrimary), status: text(row.status), published: flag(row.published) })),
    listing: typeof listing.id === "string" ? { id: text(listing.id), publicSlug: text(listing.publicSlug), status: text(listing.status), publishedAt: maybeText(listing.publishedAt), selectedServices: count(listing.selectedServices), moderation: decision(listing.moderation) } : null,
    counts: {
      customers: count(counts.customers),
      bookings: count(counts.bookings),
      jobs: count(counts.jobs),
      quotes: count(counts.quotes),
      invoices: count(counts.invoices),
      payments: count(counts.payments),
      reviews: count(counts.reviews),
      domains: count(counts.domains),
    },
  };
}

export type PlatformUserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  memberships: { organizationId: string; organizationName: string; role: string; status: string }[];
  isPlatformAdmin: boolean;
};

async function readUsers(administratorId: string, search: string, page: number): Promise<Page<PlatformUserRow>> {
  const raw = record(await ask(administratorId, sql`select app_platform_users(${search}, ${PAGE_SIZE}, ${(Math.max(page, 1) - 1) * PAGE_SIZE}) as data`));
  return {
    total: count(raw.total),
    rows: list(raw.rows).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      email: text(row.email),
      emailVerified: flag(row.emailVerified),
      createdAt: text(row.createdAt),
      memberships: list(row.memberships).map((membership) => ({ organizationId: text(membership.organizationId), organizationName: text(membership.organizationName), role: text(membership.role), status: text(membership.status) })),
      isPlatformAdmin: flag(row.isPlatformAdmin),
    })),
  };
}

export const platformUsers = (administratorId: string, search: string, page: number) => lastPageWhenPast((current) => readUsers(administratorId, search, current), page);

export type PlatformListingRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  publicSlug: string;
  status: string;
  publishedAt: string | null;
  selectedServices: number;
  /** The names of the Services the listing shows, in its order. */
  serviceNames: string[];
  /** The places the business listed as service areas, as a visitor reads them. */
  serviceAreas: string[];
  site: { platformSlug: string; status: string; published: boolean } | null;
  moderation: ModerationDecision;
  /** Published by the business AND not suspended: a visitor can open the profile. */
  publiclyAvailable: boolean;
  /** ... and the Marketplace lists it (it also shows at least one active public Service). */
  discoverable: boolean;
};

/** The strings of a JSON array (anything else in it is dropped). */
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

async function readListings(administratorId: string, search: string, page: number): Promise<Page<PlatformListingRow>> {
  const raw = record(await ask(administratorId, sql`select app_platform_listings(${search}, ${PAGE_SIZE}, ${(Math.max(page, 1) - 1) * PAGE_SIZE}) as data`));
  return {
    total: count(raw.total),
    rows: list(raw.rows).map((row) => {
      const site = record(row.site);
      return {
        id: text(row.id),
        organizationId: text(row.organizationId),
        organizationName: text(row.organizationName),
        publicSlug: text(row.publicSlug),
        status: text(row.status),
        publishedAt: maybeText(row.publishedAt),
        selectedServices: count(row.selectedServices),
        serviceNames: strings(row.serviceNames),
        serviceAreas: strings(row.serviceAreas),
        site: typeof site.platformSlug === "string" ? { platformSlug: text(site.platformSlug), status: text(site.status), published: flag(site.published) } : null,
        moderation: decision(row.moderation),
        publiclyAvailable: flag(row.publiclyAvailable),
        discoverable: flag(row.discoverable),
      };
    }),
  };
}

export const platformListings = (administratorId: string, search: string, page: number) => lastPageWhenPast((current) => readListings(administratorId, search, current), page);

export type PlatformReviewRow = { id: string; organizationId: string; organizationName: string; reviewer: string; rating: number; text: string; submittedOn: string; source: string; replied: boolean; /** Shown on the business's public Marketplace profile, or kept private. */ public: boolean };

async function readReviews(administratorId: string, search: string, rating: number | null, page: number): Promise<Page<PlatformReviewRow>> {
  const raw = record(await ask(administratorId, sql`select app_platform_reviews(${search}, ${rating}::integer, ${PAGE_SIZE}, ${(Math.max(page, 1) - 1) * PAGE_SIZE}) as data`));
  return {
    total: count(raw.total),
    rows: list(raw.rows).map((row) => ({
      id: text(row.id),
      organizationId: text(row.organizationId),
      organizationName: text(row.organizationName),
      reviewer: text(row.reviewer),
      rating: count(row.rating),
      text: text(row.text),
      submittedOn: text(row.submittedOn),
      source: text(row.source),
      replied: flag(row.replied),
      public: row.visibility === "public",
    })),
  };
}

export const platformReviews = (administratorId: string, search: string, rating: number | null, page: number) => lastPageWhenPast((current) => readReviews(administratorId, search, rating, current), page);

export type PlatformSystem = { databaseVersion: string; migrationsApplied: number | null; counts: Record<string, number> };

export async function platformSystem(administratorId: string): Promise<PlatformSystem> {
  const raw = record(await ask(administratorId, sql`select app_platform_system() as data`));
  const counts = record(raw.counts);
  return {
    databaseVersion: text(raw.databaseVersion),
    migrationsApplied: raw.migrationsApplied === null || raw.migrationsApplied === undefined ? null : count(raw.migrationsApplied),
    counts: Object.fromEntries(Object.entries(counts).map(([name, value]) => [name, count(value)])),
  };
}

export type PlatformAuditEntry = { id: string; occurredAt: string; action: string; actorKind: string; actorLabel: string; targetKind: string; targetId: string; reason: string | null; metadata: Record<string, unknown> };

export async function platformAuditRecent(administratorId: string, limit = 20): Promise<PlatformAuditEntry[]> {
  const raw = await ask(administratorId, sql`select app_platform_audit_recent(${limit}::integer) as data`);
  return list(raw).map((row) => ({
    id: text(row.id),
    occurredAt: text(row.occurredAt),
    action: text(row.action),
    actorKind: text(row.actorKind),
    actorLabel: text(row.actorLabel),
    targetKind: text(row.targetKind),
    targetId: text(row.targetId),
    reason: maybeText(row.reason),
    metadata: record(row.metadata),
  }));
}

export type ModerationOutcome = { found: boolean; changed: boolean; state: "allowed" | "suspended" | null };

/** Suspend or allow a listing. The database refuses unless the user is an administrator and writes the decision and its audit event together. */
export async function setListingModeration(administratorId: string, listingId: string, state: "allowed" | "suspended", reason: string | null): Promise<ModerationOutcome> {
  if (!isUuid(listingId)) return { found: false, changed: false, state: null };
  const raw = record(await ask(administratorId, sql`select app_platform_set_listing_moderation(${listingId}::uuid, ${state}, ${reason}) as data`));
  return { found: flag(raw.found), changed: flag(raw.changed), state: raw.state === "suspended" ? "suspended" : raw.state === "allowed" ? "allowed" : null };
}
