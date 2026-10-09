"use server";

import { headers } from "next/headers";
import { NO_ACCESS, SIGNED_OUT, failure, ok, type ActionResult } from "@/lib/action-result";
import { getAuth } from "@/lib/auth";
import { isUuid } from "@/db/tenant";
import { parseNewOrganization } from "@/lib/validation";
import { createOrganizationForUser, isActiveMember } from "../organizations";
import { getSessionUser } from "../session";
import { forgetActiveOrganization, rememberActiveOrganization } from "../workspace-cookie";

/** Make another of the caller's workspaces the active one. Only a workspace they are an active member of can be chosen. */
export async function switchOrganizationAction(organizationId: unknown): Promise<ActionResult<null>> {
  const user = await getSessionUser();
  if (!user) return failure(SIGNED_OUT);
  if (!isUuid(organizationId) || !(await isActiveMember(user.id, organizationId))) return failure(NO_ACCESS);
  await rememberActiveOrganization(organizationId);
  return ok(null);
}

/** Set up a new business workspace for the signed-in person, make it active, and report its address. */
export async function createOrganizationAction(input: unknown): Promise<ActionResult<{ slug: string }>> {
  const user = await getSessionUser();
  if (!user) return failure(SIGNED_OUT);
  const parsed = parseNewOrganization(input);
  if (!parsed.ok) return parsed;
  try {
    const created = await createOrganizationForUser(user.id, parsed.value);
    await rememberActiveOrganization(created.organizationId);
    return ok({ slug: created.slug });
  } catch (error) {
    console.error("[workspace] could not create a workspace:", error instanceof Error ? error.message : error);
    return failure("We couldn't set up your workspace. Nothing was created. Try again.");
  }
}

/** End the session in the database, clear its cookie, and forget the active workspace. */
export async function signOutAction(): Promise<ActionResult<null>> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // Already signed out, or the session row is gone: either way the aim (no session) is met.
  }
  await forgetActiveOrganization();
  return ok(null);
}
