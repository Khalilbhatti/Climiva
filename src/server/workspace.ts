import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { initialSettings, type SettingsData } from "@/data/settings";
import { businessFromOrganization, preferencesFromOrganization, weeklyHoursFromRows } from "@/db/settings-mappers";
import { organizationBusinessHours, organizationMemberships, organizations, profiles, type OrganizationRow } from "@/db/schema";
import { withTenant, withUser } from "@/db/tenant";
import { can, capabilitiesOf } from "@/lib/policy";
import { ROLE_LABEL, SAMPLE_DATA_SET, type OrganizationRole, type WorkspaceSnapshot } from "@/lib/workspace-types";
import { getSessionUser, type SessionUser } from "./session";

/**
 * The active organization.
 *
 * It is remembered in an httpOnly cookie holding the organization's id. That cookie is only a PREFERENCE, never
 * authority: on every request the id is checked against the signed-in user's active memberships, and if it is missing, stale
 * or someone else's, the request falls back to the user's own first workspace. Tampering with the cookie can therefore
 * only ever select a workspace the user already belongs to. The database enforces the same rule again through Row Level
 * Security (see src/db/tenant.ts).
 */
export const ACTIVE_ORGANIZATION_COOKIE = "climvia_org";

export type WorkspaceContext = {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
  organization: OrganizationRow;
  snapshot: WorkspaceSnapshot;
};

export type WorkspaceState =
  | { status: "anonymous" }
  | { status: "no-organization"; user: SessionUser }
  | { status: "ready"; context: WorkspaceContext };

async function loadProfile(userId: string, fallbackName: string) {
  return withUser(userId, async (tx) => {
    const existing = await tx.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (existing[0]) return existing[0];
    // The profile is created at signup; this covers an account whose creation hook failed.
    await tx.insert(profiles).values({ userId, fullName: fallbackName.trim().slice(0, 80) || "New user" }).onConflictDoNothing();
    const created = await tx.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    return created[0];
  });
}

/**
 * Everything a request needs to know about its tenant, resolved from verified records, once per request.
 * Fails loudly (throws) if the database is unreachable: a broken lookup is never answered with someone's sample data.
 */
export const resolveWorkspace = cache(async (): Promise<WorkspaceState> => {
  const user = await getSessionUser();
  if (!user) return { status: "anonymous" };

  const memberships = await withUser(user.id, (tx) =>
    tx
      .select({ organization: organizations, role: organizationMemberships.role, jobTitle: organizationMemberships.jobTitle })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(and(eq(organizationMemberships.userId, user.id), eq(organizationMemberships.status, "active")))
      .orderBy(asc(organizationMemberships.createdAt), asc(organizations.name)),
  );
  if (memberships.length === 0) return { status: "no-organization", user };

  const preferred = (await cookies()).get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const active = memberships.find((membership) => membership.organization.id === preferred) ?? memberships[0];
  const role = active.role as OrganizationRole;

  const [profile, hours] = await Promise.all([
    loadProfile(user.id, user.name),
    withTenant({ userId: user.id, organizationId: active.organization.id }, (tx) =>
      tx.select().from(organizationBusinessHours).where(eq(organizationBusinessHours.organizationId, active.organization.id)),
    ),
  ]);

  const hasSampleData = active.organization.fixtureSet === SAMPLE_DATA_SET;
  const settings: SettingsData = {
    business: businessFromOrganization(active.organization),
    hours: weeklyHoursFromRows(hours),
    // Branding is not stored yet (it needs file storage). The sample workspace keeps its reference crest; others start plain.
    branding: hasSampleData ? initialSettings.branding : { logo: null, accent: null },
    preferences: preferencesFromOrganization(active.organization),
    profile: { name: profile.fullName, role: active.jobTitle ?? ROLE_LABEL[role], photo: profile.avatarUrl ?? undefined },
  };

  return {
    status: "ready",
    context: {
      userId: user.id,
      organizationId: active.organization.id,
      role,
      organization: active.organization,
      snapshot: {
        user: { id: user.id, email: user.email, name: profile.fullName },
        organization: { id: active.organization.id, name: active.organization.name, slug: active.organization.slug, role, jobTitle: active.jobTitle },
        organizations: memberships.map((membership) => ({
          id: membership.organization.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
          role: membership.role as OrganizationRole,
        })),
        hasSampleData,
        canEditSettings: can(role, "settings:manage"),
        capabilities: capabilitiesOf(role),
        settings,
      },
    },
  };
});

/** For pages and layouts: the verified workspace, or a redirect to log in / to set one up. */
export async function requireWorkspaceContext(): Promise<WorkspaceContext> {
  const state = await resolveWorkspace();
  if (state.status === "anonymous") redirect("/login");
  if (state.status === "no-organization") redirect("/onboarding");
  return state.context;
}
