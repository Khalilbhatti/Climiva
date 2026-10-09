"use server";

import { eq } from "drizzle-orm";
import type { BusinessInfo, Preferences, WeeklyHours } from "@/data/settings";
import { hoursRowsFromWeekly, organizationValuesFromBusiness, organizationValuesFromPreferences } from "@/db/settings-mappers";
import { organizationBusinessHours, organizations, profiles } from "@/db/schema";
import { withTenant, withUser } from "@/db/tenant";
import { NOT_ALLOWED, SIGNED_OUT, failure, ok, type ActionResult } from "@/lib/action-result";
import { can } from "@/lib/policy";
import { parseBusiness, parseHours, parsePreferences, parseProfileName } from "@/lib/validation";
import { resolveWorkspace, type WorkspaceContext } from "../workspace";

/**
 * Settings writes. Each action:
 *   1. resolves the caller from the session cookie and a verified membership (never from the arguments),
 *   2. requires an owner or admin of the ACTIVE organization (Profile needs only a signed-in user),
 *   3. validates the input again on the server,
 *   4. writes inside a tenant transaction, so Row Level Security checks the same rules a second time.
 * The organization written is always the caller's active one; no argument names an organization.
 */
async function manager(): Promise<{ context: WorkspaceContext } | { error: ActionResult<never> }> {
  const state = await resolveWorkspace();
  if (state.status !== "ready") return { error: failure(SIGNED_OUT) };
  if (!can(state.context.role, "settings:manage")) return { error: failure(NOT_ALLOWED) };
  return { context: state.context };
}

export async function saveBusinessAction(input: unknown): Promise<ActionResult<BusinessInfo>> {
  const caller = await manager();
  if ("error" in caller) return caller.error;
  const parsed = parseBusiness(input);
  if (!parsed.ok) return parsed;
  const { userId, organizationId } = caller.context;
  const updated = await withTenant({ userId, organizationId }, (tx) =>
    tx.update(organizations).set(organizationValuesFromBusiness(parsed.value)).where(eq(organizations.id, organizationId)).returning({ id: organizations.id }),
  );
  if (updated.length === 0) return failure(NOT_ALLOWED);
  return ok(parsed.value);
}

export async function saveHoursAction(input: unknown): Promise<ActionResult<WeeklyHours>> {
  const caller = await manager();
  if ("error" in caller) return caller.error;
  const parsed = parseHours(input);
  if (!parsed.ok) return parsed;
  const { userId, organizationId } = caller.context;
  try {
    await withTenant({ userId, organizationId }, async (tx) => {
      // The seven rows are replaced together or not at all.
      await tx.delete(organizationBusinessHours).where(eq(organizationBusinessHours.organizationId, organizationId));
      await tx.insert(organizationBusinessHours).values(hoursRowsFromWeekly(organizationId, parsed.value));
    });
  } catch {
    return failure("The business hours could not be saved. Try again.");
  }
  return ok(parsed.value);
}

export async function savePreferencesAction(input: unknown): Promise<ActionResult<Preferences>> {
  const caller = await manager();
  if ("error" in caller) return caller.error;
  const parsed = parsePreferences(input);
  if (!parsed.ok) return parsed;
  const { userId, organizationId } = caller.context;
  const updated = await withTenant({ userId, organizationId }, (tx) =>
    tx.update(organizations).set(organizationValuesFromPreferences(parsed.value)).where(eq(organizations.id, organizationId)).returning({ id: organizations.id }),
  );
  if (updated.length === 0) return failure(NOT_ALLOWED);
  return ok(parsed.value);
}

/** The person's own display name. Anyone signed in may change their own; it is not a workspace setting and not a role. */
export async function saveProfileAction(input: unknown): Promise<ActionResult<{ name: string }>> {
  const state = await resolveWorkspace();
  if (state.status !== "ready") return failure(SIGNED_OUT);
  const parsed = parseProfileName(input);
  if (!parsed.ok) return parsed;
  const { userId } = state.context;
  const updated = await withUser(userId, (tx) =>
    tx.update(profiles).set({ fullName: parsed.value }).where(eq(profiles.userId, userId)).returning({ userId: profiles.userId }),
  );
  if (updated.length === 0) return failure("Your profile could not be saved. Try again.");
  return ok({ name: parsed.value });
}
