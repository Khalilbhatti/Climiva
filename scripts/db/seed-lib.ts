/**
 * Development and test seed data. Local tooling only: nothing here ships in the app and the app never falls back to it.
 *
 * Two businesses, deliberately unlike each other so that any leak between them is visible:
 *
 *   Apex Climate Heating & Air   the approved canonical record (taken from seed-data/apex, not retyped), Austin,
 *                                America/Chicago, 12-hour times, flagged with the sample dataset that the not-yet-migrated
 *                                modules (Customers, Jobs, Payments …) still show.
 *   Northstar Heating & Cooling  invented test data: Denver, America/Denver, ISO dates, 24-hour times, NO sample dataset.
 *
 * Users (all use SEED_PASSWORD; the addresses end in .test, a reserved domain that can never receive mail):
 *   alex.morgan@apex.test        Apex owner ("Operations Lead")                      -> Apex only        (User A)
 *   jamie.rivera@apex.test       Apex member ("Scheduling Coordinator")              -> Apex only, cannot edit settings
 *   taylor.brooks@northstar.test Northstar owner                                     -> Northstar only   (User B)
 *   casey.nguyen@climvia.test    admin in BOTH                                       -> Apex + Northstar (User C)
 *
 * Each business also gets its core data: customers with their properties and equipment, Services, the team with its roles,
 * its operations (bookings, jobs, blocked time) and its financials (quotes, invoices, payments). Apex has the full approved set
 * (scripts/db/seed-data); Northstar has a few clearly different records (two bookings, one job, two quotes, two invoices and two
 * payments of its own). The records are written through the SAME functions the application uses (src/db/core-queries.ts,
 * src/db/ops-queries.ts, src/db/fin-queries.ts), with stable ids.
 *
 * Every function is idempotent: running the seed twice changes nothing the second time.
 */
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { business, businessHoursByWeekday, currentUser, BUSINESS_TIME_ZONE } from "./seed-data/apex";
import { PROTOTYPE_TODAY } from "../../src/lib/prototype-clock";
import type { WeeklyHours } from "../../src/data/settings";
import type { Database } from "../../src/db";
import {
  hoursRowsFromWeekly,
  DEFAULT_COUNTRY,
} from "../../src/db/settings-mappers";
import * as schema from "../../src/db/schema";
import type { CustomerBook } from "../../src/data/customers";
import type { FinancialData } from "../../src/data/financials";
import type { OperationsData } from "../../src/data/operations";
import type { ReviewsData } from "../../src/data/reviews";
import type { Service } from "../../src/data/services";
import { EMPTY_TEAM, type TeamData } from "../../src/data/team";
import { clearCoreData, insertCustomerBook, insertServices, persistTeamData } from "../../src/db/core-queries";
import { clearFinancials, insertFinancials, loadFinRefs } from "../../src/db/fin-queries";
import { clearMaintenance, insertMaintenance, type SeedPlans } from "../../src/db/maint-queries";
import { clearMarketing, insertMarketing, type SeedMarketing } from "../../src/db/marketing-queries";
import { clearMarketplace, insertSeedListing } from "../../src/db/marketplace-queries";
import { clearSiteContent, insertSeedSite } from "../../src/db/site-queries";
import { clearOperations, insertOperations, loadRefs, type SeedNumbers } from "../../src/db/ops-queries";
import { clearReviews, insertReviews } from "../../src/db/review-queries";
import { createAuth, type Auth } from "../../src/lib/auth";
import { adminDb, adminUrl, appUrl, requireEnv } from "./lib";
import { clearReporting, reconcileReporting } from "./reporting-seed";
import { ensureSampleLogo, restoreSampleBranding } from "./seed-assets";
import { CUSTOMERS, EQUIPMENT, PROPERTIES } from "./seed-data/customers";
import { FINANCIALS } from "./seed-data/financials";
import { MAINTENANCE } from "./seed-data/maintenance";
import { MARKETING } from "./seed-data/marketing";
import { APEX_WEBSITE, NORTHSTAR_WEBSITE, type WebsiteSeed } from "./seed-data/website";
import { OPERATIONS } from "./seed-data/operations";
import { REVIEWS_DATA } from "./seed-data/reviews";
import { APEX_APPROVED, NORTHSTAR_APPROVED, type ApprovedReporting } from "./seed-data/reporting";
import {
  NORTHSTAR_CUSTOMERS,
  NORTHSTAR_EQUIPMENT,
  NORTHSTAR_FINANCIALS,
  NORTHSTAR_MAINTENANCE,
  NORTHSTAR_MARKETING,
  NORTHSTAR_OPERATIONS,
  NORTHSTAR_PROPERTIES,
  NORTHSTAR_REVIEWS,
  NORTHSTAR_ROLES,
  NORTHSTAR_SERVICES,
  NORTHSTAR_TEAM,
} from "./seed-data/northstar";
import { SERVICES } from "./seed-data/services";
import { ROLES, TEAM } from "./seed-data/team";

const { authUser, marketplaceListings, organizationBusinessHours, organizationMemberships, organizations, profiles, services, siteVersions, sites, teamMembers } = schema;

type AdminDb = ReturnType<typeof adminDb>["db"];

export type OrganizationSpec = {
  name: string;
  slug: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  stateRegion: string;
  postalCode: string;
  timezone: string;
  dateFormat: "mdy-short" | "mdy-numeric" | "dmy-numeric" | "ymd-iso";
  timeFormat: "12h" | "24h";
  hours: WeeklyHours;
  fixtureSet: string | null;
  /** `platformSlug` is the site's public identity (globally unique). Left out, the database makes one from the organization's address. */
  sites: { name: string; slug: string; platformSlug?: string; isPrimary?: boolean }[];
  /** The site content and Marketplace listing written for the business. None: its sites stay empty and it has no listing. */
  website?: WebsiteSeed;
};

/** The approved canonical business record, read from seed-data/apex. */
export const APEX: OrganizationSpec = {
  name: business.name,
  slug: "apex-climate-heating-air",
  phone: business.phone,
  email: business.email,
  addressLine1: business.address.street,
  city: business.address.city,
  stateRegion: business.address.state,
  postalCode: business.address.postalCode,
  timezone: BUSINESS_TIME_ZONE,
  dateFormat: "mdy-short",
  timeFormat: "12h",
  hours: businessHoursByWeekday,
  fixtureSet: "apex-demo",
  sites: [
    { name: business.name, slug: "main", platformSlug: "apexclimate", isPrimary: true },
    { name: `${business.name} Commercial`, slug: "commercial", platformSlug: "apexclimate-commercial", isPrimary: false },
  ],
  website: APEX_WEBSITE,
};

/** Invented, and unlike Apex in every setting the app shows. */
export const NORTHSTAR: OrganizationSpec = {
  name: "Northstar Heating & Cooling",
  slug: "northstar-heating-cooling",
  phone: "(555) 410-7788",
  email: "office@northstar-hvac.test",
  addressLine1: "918 Blue Spruce Way",
  city: "Denver",
  stateRegion: "CO",
  postalCode: "80203",
  timezone: "America/Denver",
  dateFormat: "ymd-iso",
  timeFormat: "24h",
  hours: {
    0: null,
    1: { open: "08:00", close: "17:00" },
    2: { open: "08:00", close: "17:00" },
    3: { open: "08:00", close: "17:00" },
    4: { open: "08:00", close: "17:00" },
    5: { open: "08:00", close: "17:00" },
    6: { open: "09:00", close: "13:00" },
  },
  fixtureSet: null,
  sites: [{ name: "Northstar Heating & Cooling", slug: "main", platformSlug: "northstar", isPrimary: true }],
  website: NORTHSTAR_WEBSITE,
};

/** A business's core records: what the Customers, Services, Team, Bookings, Jobs and Schedule modules show. */
export type CoreDataset = {
  book: CustomerBook;
  services: readonly Service[];
  team: TeamData;
  /** Bookings, jobs and blocked time. They point at the customers, Services and team above by their public references. */
  operations: OperationsData;
  /** Where the booking and job counters start when that is not simply above the seeded numbers. */
  startAt?: SeedNumbers;
  /** Quotes, invoices and payments. They point at the customers, Services, jobs, bookings and team above by their public references. */
  financials: FinancialData;
  /** Maintenance plans with their coverage and visits. They point at the customers and properties above, and a visit at a booking. */
  maintenance: SeedPlans;
  /** Reviews with their replies, and review requests. They point at the customers above and at jobs by their public references. */
  reviews: ReviewsData;
  /** Marketing campaigns with the recipient snapshots and delivery results of the sent ones. They point at the customers above. */
  marketing: SeedMarketing;
  /**
   * The approved reporting figures the business's reports open on. They are written as imported adjustments (approved figure minus
   * what the detailed records above contribute), after everything above exists. None for a business that reports its rows alone.
   */
  reporting?: ApprovedReporting;
  /** The business's today when the reporting adjustments are worked out (the sample business keeps the product's fixed day). */
  today?: string;
  /** Team members (by slug) who have a Climvia login in the seed, by seed user key. */
  logins: Readonly<Record<string, keyof typeof SEED_USERS>>;
};

/** The approved canonical Apex records. Alex Morgan's team record is linked to Alex's login; the other two have none. */
export const APEX_CORE: CoreDataset = {
  book: { customers: CUSTOMERS, properties: PROPERTIES, equipment: EQUIPMENT },
  services: SERVICES,
  team: { members: TEAM, roles: ROLES },
  operations: OPERATIONS,
  // The approved Create booking flow makes #BK-1043. Sarah's scheduled maintenance visit is already stored as BK-1048, which the
  // counter walks past (it is skipped, never reused).
  startAt: { booking: 1043 },
  financials: FINANCIALS,
  maintenance: MAINTENANCE,
  reviews: REVIEWS_DATA,
  marketing: MARKETING,
  reporting: APEX_APPROVED,
  today: PROTOTYPE_TODAY,
  logins: { "alex-morgan": "alex" },
};

export const NORTHSTAR_CORE: CoreDataset = {
  book: { customers: NORTHSTAR_CUSTOMERS, properties: NORTHSTAR_PROPERTIES, equipment: NORTHSTAR_EQUIPMENT },
  services: NORTHSTAR_SERVICES,
  team: { members: NORTHSTAR_TEAM, roles: NORTHSTAR_ROLES },
  operations: NORTHSTAR_OPERATIONS,
  financials: NORTHSTAR_FINANCIALS,
  maintenance: NORTHSTAR_MAINTENANCE,
  reviews: NORTHSTAR_REVIEWS,
  marketing: NORTHSTAR_MARKETING,
  reporting: NORTHSTAR_APPROVED,
  logins: { "taylor-brooks": "taylor" },
};

export const SEED_USERS = {
  alex: { email: "alex.morgan@apex.test", name: currentUser.name },
  jamie: { email: "jamie.rivera@apex.test", name: "Jamie Rivera" },
  taylor: { email: "taylor.brooks@northstar.test", name: "Taylor Brooks" },
  casey: { email: "casey.nguyen@climvia.test", name: "Casey Nguyen" },
} as const;

/** An Auth instance for scripts: the runtime role's connection (as the app has), and no request to set cookies on. */
export function seedAuth(database?: string): { auth: Auth; close: () => Promise<void> } {
  const pool = new Pool({ connectionString: appUrl(database), max: 2, application_name: "climvia-seed" });
  const db = drizzle(pool, { schema }) as unknown as Database;
  const auth = createAuth({
    db,
    secret: requireEnv("BETTER_AUTH_SECRET"),
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    nextCookies: false,
  });
  return { auth, close: () => pool.end() };
}

/** Create the user through Better Auth (so the password is hashed by Better Auth, not here) unless they exist. */
export async function ensureUser(auth: Auth, admin: AdminDb, user: { email: string; name: string }, password: string): Promise<string> {
  const existing = await admin.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, user.email)).limit(1);
  if (existing[0]) return existing[0].id;
  const created = await auth.api.signUpEmail({ body: { email: user.email, name: user.name, password } });
  return created.user.id;
}

/** Insert the organization, its seven hours rows and its sites. Returns the id of the new or existing organization. */
export async function ensureOrganization(admin: AdminDb, spec: OrganizationSpec): Promise<string> {
  const existing = await admin.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, spec.slug)).limit(1);
  if (existing[0]) return existing[0].id;
  return admin.transaction(async (tx) => {
    const [row] = await tx
      .insert(organizations)
      .values({
        name: spec.name,
        slug: spec.slug,
        phone: spec.phone,
        email: spec.email,
        addressLine1: spec.addressLine1,
        city: spec.city,
        stateRegion: spec.stateRegion,
        postalCode: spec.postalCode,
        country: DEFAULT_COUNTRY,
        timezone: spec.timezone,
        currency: "USD",
        dateFormat: spec.dateFormat,
        timeFormat: spec.timeFormat,
        fixtureSet: spec.fixtureSet,
        onboardingCompletedAt: new Date(),
      })
      .returning({ id: organizations.id });
    await tx.insert(organizationBusinessHours).values(hoursRowsFromWeekly(row.id, spec.hours));
    for (const [index, site] of spec.sites.entries()) {
      await tx.insert(sites).values({
        organizationId: row.id,
        name: site.name,
        slug: site.slug,
        // Left out, the database names it from the organization's address (migration 0013): the column is NOT NULL, but a trigger fills it.
        platformSlug: site.platformSlug as string,
        isPrimary: site.isPrimary ?? index === 0,
        status: "draft",
      });
    }
    return row.id;
  });
}

export async function ensureMembership(
  admin: AdminDb,
  membership: { organizationId: string; userId: string; role: "owner" | "admin" | "member"; jobTitle?: string },
): Promise<void> {
  await admin
    .insert(organizationMemberships)
    .values({ ...membership, jobTitle: membership.jobTitle ?? null, status: "active" })
    .onConflictDoNothing({ target: [organizationMemberships.organizationId, organizationMemberships.userId] });
}

export async function setProfileName(admin: AdminDb, userId: string, fullName: string): Promise<void> {
  await admin.update(profiles).set({ fullName }).where(eq(profiles.userId, userId));
}

type AdminTx = Parameters<Parameters<AdminDb["transaction"]>[0]>[0];

/**
 * Write a business's core records inside a transaction. `userIds` links team members (by slug) to logins. The operations are
 * written next (they point at the customers, Services and team members just written, and their times are read in `timeZone`) and
 * the financials next (they point at the jobs and bookings as well), then the maintenance plans (a visit can point at a booking), the
 * reviews (a review names a job) and the Marketing campaigns (a recipient can be a customer). The reporting adjustments come last:
 * each is the approved figure minus what the records written above contribute to it, so everything it reconciles must exist.
 */
export async function writeCoreData(
  tx: AdminTx,
  organizationId: string,
  timeZone: string,
  core: CoreDataset,
  userIds: Readonly<Record<string, string>> = {},
): Promise<void> {
  // The database layer is typed against the application's transaction; the owner connection runs the same statements.
  const db = tx as never;
  await insertServices(db, organizationId, core.services, { stableIds: true });
  await insertCustomerBook(db, organizationId, core.book, { stableIds: true });
  await persistTeamData(db, organizationId, EMPTY_TEAM, core.team, { stableIds: true, userIds });
  await insertOperations(db, organizationId, timeZone, core.operations, await loadRefs(db, organizationId), { stableIds: true, startAt: core.startAt });
  await insertFinancials(db, organizationId, timeZone, core.financials, await loadFinRefs(db, organizationId), { stableIds: true });
  const refs = await loadRefs(db, organizationId);
  await insertMaintenance(db, organizationId, core.maintenance, refs, { stableIds: true });
  await insertReviews(db, organizationId, timeZone, core.reviews, refs, { stableIds: true });
  await insertMarketing(db, organizationId, timeZone, core.marketing, refs, { stableIds: true });
  if (core.reporting) await reconcileReporting(db, organizationId, timeZone, core.reporting, core.today);
}

/** Give a business its core records unless it already has them. Returns true when it wrote them. */
export async function ensureCoreData(
  db: AdminDb,
  organizationId: string,
  timeZone: string,
  core: CoreDataset,
  userIds: Readonly<Record<string, string>> = {},
): Promise<boolean> {
  const existing = await db.select({ id: services.id }).from(services).where(eq(services.organizationId, organizationId)).limit(1);
  const members = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.organizationId, organizationId)).limit(1);
  if (existing.length > 0 || members.length > 0) return false;
  await db.transaction((tx) => writeCoreData(tx, organizationId, timeZone, core, userIds));
  return true;
}

/** Write a business's sites (with their draft and published versions) and its Marketplace listing, as the owner connection. */
export async function writeWebsite(tx: AdminTx, organizationId: string, website: WebsiteSeed): Promise<void> {
  const db = tx as never;
  const [organization] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, organizationId));
  for (const site of website.sites) await insertSeedSite(db, organizationId, site);
  if (website.listing) await insertSeedListing(db, organizationId, organization.slug, website.listing);
}

/** Give a business its website and listing unless it already has site content. Returns true when it wrote them. */
export async function ensureWebsite(db: AdminDb, organizationId: string, website: WebsiteSeed | undefined): Promise<boolean> {
  if (!website) return false;
  const existing = await db.select({ id: siteVersions.id }).from(siteVersions).where(eq(siteVersions.organizationId, organizationId)).limit(1);
  const listing = await db.select({ id: marketplaceListings.id }).from(marketplaceListings).where(eq(marketplaceListings.organizationId, organizationId)).limit(1);
  if (existing.length > 0 || listing.length > 0) return false;
  await db.transaction((tx) => writeWebsite(tx, organizationId, website));
  return true;
}

/** Remove a business's site content and listing (and, when `keepSites` is given, any site not named in it), so they can be written again. */
export async function clearWebsite(tx: AdminTx, organizationId: string, keepSites?: readonly string[]): Promise<void> {
  await clearMarketplace(tx as never, organizationId);
  await clearSiteContent(tx as never, organizationId, keepSites);
}

export type SeedResult = { apexId: string; northstarId: string; users: Record<keyof typeof SEED_USERS, string> };

/** The standing development data: two businesses and four people. */
export async function seedDevelopmentData(database?: string): Promise<SeedResult> {
  const password = requireEnv("SEED_PASSWORD");
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "1") {
    throw new Error("Refusing to seed development data when NODE_ENV=production.");
  }
  const { pool, db } = adminDb(database ? adminUrl(database) : undefined);
  const { auth, close } = seedAuth(database);
  try {
    const users = {} as Record<keyof typeof SEED_USERS, string>;
    for (const [key, user] of Object.entries(SEED_USERS) as [keyof typeof SEED_USERS, (typeof SEED_USERS)[keyof typeof SEED_USERS]][]) {
      users[key] = await ensureUser(auth, db, user, password);
    }
    const apexId = await ensureOrganization(db, APEX);
    const northstarId = await ensureOrganization(db, NORTHSTAR);

    await ensureMembership(db, { organizationId: apexId, userId: users.alex, role: "owner", jobTitle: "Operations Lead" });
    await ensureMembership(db, { organizationId: apexId, userId: users.jamie, role: "member", jobTitle: "Scheduling Coordinator" });
    await ensureMembership(db, { organizationId: apexId, userId: users.casey, role: "admin" });
    await ensureMembership(db, { organizationId: northstarId, userId: users.taylor, role: "owner" });
    await ensureMembership(db, { organizationId: northstarId, userId: users.casey, role: "admin" });

    const loginIds = (core: CoreDataset) => Object.fromEntries(Object.entries(core.logins).map(([member, key]) => [member, users[key]]));
    await ensureCoreData(db, apexId, APEX.timezone, APEX_CORE, loginIds(APEX_CORE));
    await ensureCoreData(db, northstarId, NORTHSTAR.timezone, NORTHSTAR_CORE, loginIds(NORTHSTAR_CORE));
    await ensureWebsite(db, apexId, APEX.website);
    await ensureWebsite(db, northstarId, NORTHSTAR.website);
    // The sample business shows a real logo (an Asset: a row and a stored file). Northstar has none, like a business that has set none.
    await ensureSampleLogo(db, apexId);
    return { apexId, northstarId, users };
  } finally {
    await close();
    await pool.end();
  }
}

/* ───────────────────────── per-worker test tenants ───────────────────────── */

/** The Apex values a test tenant is restored to before every test. */
export const APEX_BASELINE = APEX;

/**
 * A private copy of the Apex workspace for one test worker: its own user, its own organization. The Playwright
 * suite runs tests in parallel and Settings is now stored, so each worker needs a business of its own to edit; the
 * name, address, hours and preferences are the canonical Apex ones so the existing expectations hold.
 */
export async function ensureTestTenant(
  index: number,
  database?: string,
): Promise<{ userId: string; organizationId: string; email: string; password: string; platformSlug: string; listingSlug: string }> {
  const password = requireEnv("SEED_PASSWORD");
  const email = `e2e-worker-${index}@apex.test`;
  const { pool, db } = adminDb(database ? adminUrl(database) : undefined);
  const { auth, close } = seedAuth(database);
  try {
    const userId = await ensureUser(auth, db, { email, name: currentUser.name }, password);
    // A copy's sites need public identities of their own: they are unique across all sites.
    const sitesOfCopy = APEX.sites.map((site) => ({ ...site, platformSlug: `${site.platformSlug}-e2e-${index}` }));
    const organizationId = await ensureOrganization(db, { ...APEX, slug: `apex-e2e-${index}`, sites: sitesOfCopy });
    await ensureMembership(db, { organizationId, userId, role: "owner", jobTitle: currentUser.role });
    await ensureCoreData(db, organizationId, APEX.timezone, APEX_CORE, { "alex-morgan": userId });
    await ensureWebsite(db, organizationId, APEX.website);
    await ensureSampleLogo(db, organizationId);
    // The copy's public addresses: its primary site's, and its Marketplace listing's (the organization's own address).
    return { userId, organizationId, email, password, platformSlug: sitesOfCopy[0].platformSlug!, listingSlug: `apex-e2e-${index}` };
  } finally {
    await close();
    await pool.end();
  }
}

/**
 * A cheap fingerprint of a business's core records: how many there are and when the newest of each was changed. Every write
 * the application makes to Services, the Team or the operations changes one of these (an update moves `updated_at`, an addition
 * changes a count or a number counter, and every Team write adds an activity entry), and so does an edit made directly to a
 * customer, property or piece of equipment, so an unchanged fingerprint means the records are as they were seeded.
 */
export async function coreFingerprint(db: AdminDb, organizationId: string): Promise<string> {
  const result = await db.execute<{ fingerprint: string }>(sql`
    select concat_ws('|',
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from customers where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from customer_properties where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from equipment where organization_id = ${organizationId}),
      (select count(*) from customer_notes where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from services where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from team_members where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from team_roles where organization_id = ${organizationId}),
      (select count(*) from team_activity where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from bookings where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from jobs where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(string_agg(ref || visibility, ',' order by ref), '') from job_files where organization_id = ${organizationId}),
      (select count(*) from schedule_blocks where organization_id = ${organizationId}),
      (select coalesce(string_agg(kind || next_value, ',' order by kind), '') from organization_sequences where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from quotes where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from invoices where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') || ':' || count(*) filter (where status = 'voided') from payments where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from maintenance_plans where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') || ':' || coalesce(string_agg(status, '' order by ref), '') from maintenance_plan_visits where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from review_replies where organization_id = ${organizationId}),
      (select count(*) from review_requests where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') || ':' || coalesce(string_agg(status || coalesce(recipient_count, -1), '' order by slug), '') from marketing_campaigns where organization_id = ${organizationId}),
      (select count(*) from marketing_campaign_recipients where organization_id = ${organizationId}),
      (select count(*) from marketing_campaign_selected_customers where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(sum(coalesce(integer_value, money_cents)), 0) from analytics_imported_baselines where organization_id = ${organizationId})
    ) as fingerprint`);
  return result.rows[0].fingerprint;
}

/**
 * The same for the website and the Marketplace listing: how many rows there are and when the newest of each was changed, plus each
 * site's state (published pointer) and its custom-domain claims. Kept apart from the core fingerprint so that a test that only edits the website puts back
 * only the website, which is far cheaper than rewriting every customer, booking and invoice.
 */
export async function websiteFingerprint(db: AdminDb, organizationId: string): Promise<string> {
  const result = await db.execute<{ fingerprint: string }>(sql`
    select concat_ws('|',
      (select coalesce(string_agg(slug || ':' || status || ':' || coalesce(published_version_id::text, '') || ':' || updated_at::text, ',' order by slug), '') from sites where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') || ':' || coalesce(string_agg(status, '' order by id), '') from site_domains where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from site_versions where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from site_pages where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') from site_sections where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(max(updated_at)::text, '') || ':' || coalesce(string_agg(status, ''), '') from marketplace_listings where organization_id = ${organizationId}),
      (select count(*) || ':' || coalesce(sum(sort_order), 0) from marketplace_listing_services where organization_id = ${organizationId})
    ) as fingerprint`);
  return result.rows[0].fingerprint;
}

const seededFingerprints = new Map<string, string>();
const seededWebsiteFingerprints = new Map<string, string>();

/** Put a test tenant back to the canonical Apex record: settings, hours, profile and the owner membership. */
export async function resetTestTenant(db: AdminDb, tenant: { userId: string; organizationId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(organizations)
      .set({
        name: APEX.name,
        phone: APEX.phone,
        email: APEX.email,
        addressLine1: APEX.addressLine1,
        addressLine2: null,
        city: APEX.city,
        stateRegion: APEX.stateRegion,
        postalCode: APEX.postalCode,
        country: DEFAULT_COUNTRY,
        timezone: APEX.timezone,
        currency: "USD",
        dateFormat: APEX.dateFormat,
        timeFormat: APEX.timeFormat,
        fixtureSet: APEX.fixtureSet,
      })
      .where(eq(organizations.id, tenant.organizationId));
    await tx.delete(organizationBusinessHours).where(eq(organizationBusinessHours.organizationId, tenant.organizationId));
    await tx.insert(organizationBusinessHours).values(hoursRowsFromWeekly(tenant.organizationId, APEX.hours));
    await tx.update(profiles).set({ fullName: currentUser.name, avatarUrl: null }).where(eq(profiles.userId, tenant.userId));
    await tx
      .update(organizationMemberships)
      .set({ role: "owner", status: "active", jobTitle: currentUser.role })
      .where(and(eq(organizationMemberships.organizationId, tenant.organizationId), eq(organizationMemberships.userId, tenant.userId)));
  });

  // The Branding too: a test may have uploaded or removed a logo. The sample logo itself was stored by ensureTestTenant and is never changed.
  await restoreSampleBranding(db, tenant.organizationId);

  // Services, the team and the operations are stored too now. Put them back only when a test changed them. The first reset in a
  // worker always writes them: a worker that was replaced after a failing test finds the previous one's changes, and must not take
  // them as the baseline.
  const seeded = seededFingerprints.get(tenant.organizationId);
  if (seeded === undefined || seeded !== (await coreFingerprint(db, tenant.organizationId))) {
    await db.transaction(async (tx) => {
      // A listing selects Services, so the website and the listing go before them (and are written again after the core records).
      await clearWebsite(tx, tenant.organizationId, APEX.sites.map((site) => site.slug));
      // Documents, plans, reviews and campaigns point at jobs, bookings and customers, and those at Services and team members, so they go first.
      await clearReporting(tx as never, tenant.organizationId);
      await clearMarketing(tx as never, tenant.organizationId);
      await clearReviews(tx as never, tenant.organizationId);
      await clearMaintenance(tx as never, tenant.organizationId);
      await clearFinancials(tx as never, tenant.organizationId);
      await clearOperations(tx as never, tenant.organizationId);
      await clearCoreData(tx as never, tenant.organizationId);
      await writeCoreData(tx, tenant.organizationId, APEX.timezone, APEX_CORE, { "alex-morgan": tenant.userId });
      await writeWebsite(tx, tenant.organizationId, APEX.website!);
    });
    seededFingerprints.set(tenant.organizationId, await coreFingerprint(db, tenant.organizationId));
    seededWebsiteFingerprints.set(tenant.organizationId, await websiteFingerprint(db, tenant.organizationId));
  }

  // The website and the listing, when a test changed only them.
  const websiteSeeded = seededWebsiteFingerprints.get(tenant.organizationId);
  if (websiteSeeded === undefined || websiteSeeded !== (await websiteFingerprint(db, tenant.organizationId))) {
    await db.transaction(async (tx) => {
      await clearWebsite(tx, tenant.organizationId, APEX.sites.map((site) => site.slug));
      await writeWebsite(tx, tenant.organizationId, APEX.website!);
    });
    seededWebsiteFingerprints.set(tenant.organizationId, await websiteFingerprint(db, tenant.organizationId));
  }
}
