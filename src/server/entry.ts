import "server-only";
import { and, eq } from "drizzle-orm";
import { isPlatformAdmin } from "@/db/platform-queries";
import { organizationMemberships } from "@/db/schema";
import { withUser } from "@/db/tenant";
import { getSessionUser } from "./session";

/**
 * Where the front door sends a visitor.
 *
 * `/` is Climvia's public landing for everyone who is not a business member. This file decides, from verified records, which of three things happens:
 *
 *   landing    nobody is signed in, or a signed-in platform administrator with no business of their own (they need no Organization to be here)
 *   /overview  a member of a business's workspace: their dashboard is their home
 *   /onboarding  signed in with no business and not a platform administrator: finish setting one up
 *
 * It answers nothing about WHICH business, which role or what the person may do: that is the workspace's job (src/server/workspace.ts), once they get
 * there. Nothing here is rendered into the landing: the landing's HTML is the same for everyone who stays on it. A request with no session pays for no
 * database lookup at all.
 */
export type EntryDestination = { kind: "landing" } | { kind: "redirect"; to: "/overview" | "/onboarding" };

/** Does this person belong to at least one business, as an active member? Never about anyone but the verified user. */
export async function hasActiveWorkspace(userId: string): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")))
      .limit(1),
  );
  return rows.length > 0;
}

export async function entryDestination(): Promise<EntryDestination> {
  const user = await getSessionUser();
  if (!user) return { kind: "landing" };
  if (await hasActiveWorkspace(user.id)) return { kind: "redirect", to: "/overview" };
  // No business: a platform administrator is not made to create one. Anyone else is helped to set one up.
  if (await isPlatformAdmin(user.id)) return { kind: "landing" };
  return { kind: "redirect", to: "/onboarding" };
}

/** What the public pages' header may know about the person looking at them. Booleans about the caller only: no name, no email, no business. */
export type SessionState = { signedIn: boolean; workspace: boolean; platformAdmin: boolean };

/** What a visitor, and anyone whose state could not be read, is told. */
export const SIGNED_OUT_STATE: SessionState = { signedIn: false, workspace: false, platformAdmin: false };

export async function sessionState(): Promise<SessionState> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT_STATE;
  const [workspace, platformAdmin] = await Promise.all([hasActiveWorkspace(user.id), isPlatformAdmin(user.id)]);
  return { signedIn: true, workspace, platformAdmin };
}
