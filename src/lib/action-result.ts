/** What a server action hands back to the form that called it. Errors are values, never thrown text, so a form can show them. */
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; fields?: Record<string, string> };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const failure = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

export const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
export const NOT_ALLOWED = "Only an owner or admin can change this workspace's settings.";
export const NO_ACCESS = "You don't have access to that workspace.";
