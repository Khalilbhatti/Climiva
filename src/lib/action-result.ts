/** What a server action hands back to the form that called it. Errors are values, never thrown text, so a form can show them. */
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; fields?: Record<string, string> };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const failure = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

export const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
export const NOT_ALLOWED = "Only an owner or admin can change this workspace's settings.";
export const NOT_ALLOWED_SERVICES = "Only an owner or admin can change Services.";
export const NOT_ALLOWED_TEAM = "Only an owner or admin can change the team.";
export const NOT_ALLOWED_OPERATIONS = "Only an owner or admin can change bookings and jobs.";
export const NOT_ALLOWED_FINANCIALS = "Only an owner or admin can change quotes, invoices and payments.";
export const NOT_ALLOWED_MAINTENANCE = "Only an owner or admin can change maintenance plans.";
export const NOT_ALLOWED_REVIEWS = "Only an owner or admin can reply to reviews or request them.";
export const NOT_ALLOWED_MARKETING = "Only an owner or admin can create or change marketing campaigns.";
export const NOT_ALLOWED_WEBSITE = "Only an owner or admin can change the website.";
export const NOT_ALLOWED_MARKETPLACE = "Only an owner or admin can change the Marketplace listing.";
export const NOT_FOUND ="That record no longer exists. Reload the page and try again.";
export const NO_ACCESS = "You don't have access to that workspace.";
