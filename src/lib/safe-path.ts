/**
 * The page to return to after logging in, taken from `?next=`.
 *
 * Only a path on this site is ever followed. A full URL, a protocol-relative `//host`, a backslash trick or anything
 * that is not a plain absolute path is dropped, so a crafted login link cannot send a person to another site after they
 * type their password (an open redirect).
 */
export function safeNextPath(value: string | null | undefined): string | undefined {
  if (!value || value.length > 300) return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  if (/[\u0000-\u001f]/.test(value)) return undefined;
  if (value === "/login" || value === "/signup" || value.startsWith("/api/")) return undefined;
  // The platform console has its own sign-in page and is never a place the ordinary one sends someone: signing in here proves who a person is and
  // grants nothing, and a link cannot make it look as if it did.
  if (value === "/platform-admin" || value.startsWith("/platform-admin/") || value.startsWith("/platform-admin?")) return undefined;
  return value;
}
