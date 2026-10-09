import "server-only";
import { cookies } from "next/headers";
import { ACTIVE_ORGANIZATION_COOKIE } from "./workspace";

/** Remember which of the person's workspaces is active. A preference only: every request re-verifies it (see workspace.ts). */
export async function rememberActiveOrganization(organizationId: string): Promise<void> {
  (await cookies()).set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function forgetActiveOrganization(): Promise<void> {
  (await cookies()).delete(ACTIVE_ORGANIZATION_COOKIE);
}
