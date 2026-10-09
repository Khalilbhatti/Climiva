import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { BusinessInfo, Preferences, WeeklyHours } from "@/data/settings";
import { hoursRowsFromWeekly, organizationValuesFromBusiness, organizationValuesFromPreferences } from "@/db/settings-mappers";
import { organizationBusinessHours, organizationMemberships, organizations, sites } from "@/db/schema";
import { selectOrganization, withUser } from "@/db/tenant";
import { slugCandidates, slugify } from "@/lib/validation";

export type NewOrganizationInput = { business: BusinessInfo; preferences: Preferences; hours: WeeklyHours };

/** A pg unique violation, whether pg's error or Drizzle's wrapper around it. */
function uniqueViolationOf(error: unknown): string | undefined {
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    const candidate = current as { code?: string; constraint?: string };
    if (candidate.code === "23505") return candidate.constraint ?? "";
  }
  return undefined;
}

/**
 * Create a business workspace for `userId`, atomically.
 *
 * In ONE transaction: the organization (with a unique slug), the creator's owner membership, the seven opening-hours
 * rows and a first (draft) site. If any step fails, none of it is kept. It creates no customers, services, jobs, bookings
 * or financial records. Returns the new organization's id; the caller makes it the active one.
 */
export async function createOrganizationForUser(userId: string, input: NewOrganizationInput): Promise<{ organizationId: string; slug: string }> {
  const organizationId = randomUUID();
  const candidates = slugCandidates(slugify(input.business.name), () => randomBytes(3).toString("hex"));

  return withUser(userId, async (tx) => {
    let slug: string | undefined;
    for (const candidate of candidates) {
      try {
        // A nested transaction is a SAVEPOINT: a taken slug fails this one insert without poisoning the outer transaction.
        // No RETURNING: the creator cannot read the row back until their membership exists, a few lines below.
        await tx.transaction((attempt) =>
          attempt.insert(organizations).values({
            id: organizationId,
            slug: candidate,
            ...organizationValuesFromBusiness(input.business),
            ...organizationValuesFromPreferences(input.preferences),
            onboardingCompletedAt: sql`now()`,
          }),
        );
        slug = candidate;
        break;
      } catch (error) {
        if (uniqueViolationOf(error) === "organizations_slug_unique") continue;
        throw error;
      }
    }
    if (!slug) throw new Error("Could not find a free workspace address.");

    await tx.insert(organizationMemberships).values({ organizationId, userId, role: "owner", status: "active" });
    await selectOrganization(tx, organizationId);
    await tx.insert(organizationBusinessHours).values(hoursRowsFromWeekly(organizationId, input.hours));
    await tx.insert(sites).values({ organizationId, name: input.business.name, slug: "main", status: "draft" });
    return { organizationId, slug };
  });
}

/** True only for an ACTIVE membership of this user in this organization. */
export async function isActiveMember(userId: string, organizationId: string): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, "active")))
      .limit(1),
  );
  return rows.length > 0;
}
