import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { isPlatformAdmin } from "@/db/platform-queries";
import { getSessionUser } from "./session";

export type PlatformAdmin = { id: string; email: string; name: string };

/**
 * Who is operating the platform, or the right refusal. Platform authority is NOT workspace authority: it does not look at an active organization,
 * a membership or a role, and an owner of every business on the platform has none of it. It comes from one place, the database's own answer
 * (`app_is_platform_admin()`) about the user whose session Better Auth just verified. Nothing a request carries (a cookie, a query string, a header,
 * a form field, an organization id) can supply it.
 *
 *   no session            -> the platform sign-in page
 *   a session, not an administrator -> "not found" (the same page as any address that does not exist; nothing says an administrator exists)
 *   an administrator      -> their name and address, for the console to show
 *
 * Every page, layout and Server Action of the console calls this first, and the database functions check again, so hiding a link is never the
 * protection. Memoised per request: a layout and its page ask once.
 */
export const requirePlatformAdmin = cache(async (): Promise<PlatformAdmin> => {
  const user = await getSessionUser();
  if (!user) redirect("/platform-admin/login");
  if (!(await isPlatformAdmin(user.id))) notFound();
  return { id: user.id, email: user.email, name: user.name };
});

/** `?q=` for a list: trimmed, at most 100 characters. */
export function searchTerm(value: string | string[] | undefined): string {
  return (typeof value === "string" ? value : "").trim().slice(0, 100);
}

/** `?page=` for a list: a whole number from 1. */
export function pageNumber(value: string | string[] | undefined): number {
  const parsed = typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : 1;
  return Math.max(parsed, 1);
}
