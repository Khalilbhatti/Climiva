/**
 * Development and test seed data. Local tooling only: nothing here ships in the app and the app never falls back to it.
 *
 * Two businesses, deliberately unlike each other so that any leak between them is visible:
 *
 *   Apex Climate Heating & Air   the approved canonical record (taken from src/data/fixtures, not retyped), Austin,
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
 * Every function is idempotent: running the seed twice changes nothing the second time.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { business, businessHoursByWeekday, currentUser, BUSINESS_TIME_ZONE } from "../../src/data/fixtures";
import type { WeeklyHours } from "../../src/data/settings";
import type { Database } from "../../src/db";
import {
  hoursRowsFromWeekly,
  DEFAULT_COUNTRY,
} from "../../src/db/settings-mappers";
import * as schema from "../../src/db/schema";
import { createAuth, type Auth } from "../../src/lib/auth";
import { adminDb, adminUrl, appUrl, requireEnv } from "./lib";

const { authUser, organizationBusinessHours, organizationMemberships, organizations, profiles, sites } = schema;

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
  sites: { name: string; slug: string }[];
};

/** The approved canonical business record, read from the existing fixtures. */
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
    { name: business.name, slug: "main" },
    { name: `${business.name} Commercial`, slug: "commercial" },
  ],
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
  sites: [{ name: "Northstar Heating & Cooling", slug: "main" }],
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
    for (const site of spec.sites) {
      await tx.insert(sites).values({ organizationId: row.id, name: site.name, slug: site.slug, status: "draft" });
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
): Promise<{ userId: string; organizationId: string; email: string; password: string }> {
  const password = requireEnv("SEED_PASSWORD");
  const email = `e2e-worker-${index}@apex.test`;
  const { pool, db } = adminDb(database ? adminUrl(database) : undefined);
  const { auth, close } = seedAuth(database);
  try {
    const userId = await ensureUser(auth, db, { email, name: currentUser.name }, password);
    const organizationId = await ensureOrganization(db, { ...APEX, slug: `apex-e2e-${index}` });
    await ensureMembership(db, { organizationId, userId, role: "owner", jobTitle: currentUser.role });
    return { userId, organizationId, email, password };
  } finally {
    await close();
    await pool.end();
  }
}

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
}
