import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export type SessionUser = { id: string; email: string; name: string };

/**
 * Who is making this request, or null.
 *
 * Better Auth validates the signed session cookie AND looks the session up in the database, so a signed-out or expired
 * session is rejected here even if the browser still holds the cookie. Memoised per request (`cache`), so a page that
 * asks several times pays once; React's `cache` is scoped to a single request and never shared between users.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
});

/** For pages: the signed-in user, or a redirect to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
