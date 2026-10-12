import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { BusinessInfo, Preferences, WeeklyHours } from "@/data/settings";
import { EMPTY_TEAM, SYSTEM_ROLES, weeklyFromBusinessHours, type TeamMember } from "@/data/team";
import { persistTeamData } from "@/db/core-queries";
import { DEFAULT_TEMPLATE_KEY } from "@/db/default-template";
import { createDraftFromTemplate, createSite } from "@/db/site-queries";
import { hoursRowsFromWeekly, organizationValuesFromBusiness, organizationValuesFromPreferences } from "@/db/settings-mappers";
import { organizationBusinessHours, organizationMemberships, organizations } from "@/db/schema";
import { selectOrganization, withUser } from "@/db/tenant";
import { slugCandidates, slugify } from "@/lib/validation";
import { constraintOf, uniqueViolationOf } from "./db-errors";

export type NewOrganizationInput = { business: BusinessInfo; preferences: Preferences; hours: WeeklyHours };

/**
 * Create a business workspace for `userId`, atomically.
 *
 * In ONE transaction: the organization (with a unique slug), the creator's owner membership, the seven opening-hours
 * rows, a first site (the primary one) with its Draft built from the default website template, the business's six system Team roles
 * and the creator as its first team member (the owner, linked to their login). If any step fails, none of it is kept. It creates no customers, no Services (a new business
 * starts with none; a starter-template step may offer presets later), no jobs, bookings or financial records.
 * Returns the new organization's id; the caller makes it the active one.
 */
export async function createOrganizationForUser(userId: string, input: NewOrganizationInput, ownerName: string): Promise<{ organizationId: string; slug: string }> {
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
    // The first site is the primary one. Its public address starts from the organization's own (which is unique among organizations);
    // another business that already has it (or a name the platform keeps for itself) makes a numbered one instead. The Draft is the
    // default template: five pages in neutral words that speak of the business through its own record. Nothing of another business.
    let siteId: string | undefined;
    for (let attempt = 1; attempt <= 20 && !siteId; attempt += 1) {
      const platformSlug = attempt === 1 ? slug : `${slug.slice(0, 58).replace(/-+$/, "")}-${attempt}`;
      try {
        siteId = await tx.transaction((created) => createSite(created, organizationId, { name: input.business.name, slug: "main", platformSlug, isPrimary: true }));
      } catch (error) {
        const constraint = constraintOf(error);
        if (uniqueViolationOf(error) === "sites_platform_slug_unique" || constraint === "sites_platform_slug_format") continue;
        throw error;
      }
    }
    if (!siteId) throw new Error("Could not find a free website address.");
    await createDraftFromTemplate({ tx, organizationId }, siteId, DEFAULT_TEMPLATE_KEY);

    // The Team: the six system roles and the person who created the business, as its owner. A team member is a worker of
    // the business, not a login; this one happens to have one, so it is linked.
    const ownerSlug = slugify(ownerName, "owner").slice(0, 70).replace(/-+$/g, "") || "owner";
    const owner: TeamMember = {
      id: ownerSlug,
      name: ownerName.trim().slice(0, 80) || "Owner",
      role: "Owner",
      roleId: "owner",
      status: "active",
      fieldAssignable: true,
      availability: { mode: "business-hours", weekly: weeklyFromBusinessHours(input.hours), unavailable: [] },
      serviceMode: "all",
      serviceIds: [],
      activity: [],
    };
    await persistTeamData(tx, organizationId, EMPTY_TEAM, { roles: SYSTEM_ROLES, members: [owner] }, { userIds: { [ownerSlug]: userId } });
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
