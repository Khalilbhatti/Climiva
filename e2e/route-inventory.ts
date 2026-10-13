/**
 * The route inventory, derived from the app folder rather than written down: every page file becomes a URL pattern,
 * and each dynamic segment is filled from the real data modules. A new page that this cannot expand fails the
 * inventory test, so a route can never be added without being crawled.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { TEMPLATE_KEYS } from "../src/db/site-templates";
import { CUSTOMERS, FINANCIALS, JOBS, MARKETING, PLANS, REVIEWS_DATA, ROLES, SERVICES, TEAM } from "./apex-data";

export type InventoryRoute = {
  /** The URL that is visited. */
  url: string;
  /** The page file's route pattern, e.g. "/customers/[customerId]". */
  pattern: string;
  /** Pages in the (public) group (published Sites and listings) and the (preview) group (signed-in Draft previews) are customer-facing and have no workspace shell. */
  shell: boolean;
};

const APP_DIR = join(process.cwd(), "src", "app");

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return entry === "page.tsx" ? [path] : [];
  });
}

/** Values for each dynamic segment, keyed by the segment name. */
const PARAMS: Record<string, readonly string[]> = {
  customerId: CUSTOMERS.map((customer) => customer.id),
  serviceId: SERVICES.map((service) => service.id),
  jobId: JOBS.map((job) => job.id),
  memberId: TEAM.map((member) => member.id),
  roleId: ROLES.map((role) => role.id),
  quoteId: FINANCIALS.quotes.map((quote) => quote.id),
  invoiceId: FINANCIALS.invoices.map((invoice) => invoice.id),
  paymentId: FINANCIALS.payments.map((payment) => payment.id),
  planId: PLANS.map((plan) => plan.id),
  pageId: ["home", "services", "about", "contact", "booking"],
  // The application's website Templates, by key (the Template Gallery's previews).
  templateKey: [...TEMPLATE_KEYS],
  // The published sample sites and listings, by their public addresses (the standing sample business and Northstar).
  siteSlug: ["apexclimate"],
  listingSlug: ["apex-climate-heating-air"],
  reviewId: REVIEWS_DATA.reviews.map((review) => review.id),
  campaignId: MARKETING.campaigns.map((campaign) => campaign.id),
};

/** Values for a catch-all segment ([...slug]): the addresses under a website's home page, including each Service's booking journey. */
const CATCH_ALL: Record<string, readonly string[]> = {
  slug: ["services", "about", "contact", "booking", ...SERVICES.map((service) => `booking/${service.id}`)],
};

function expand(pattern: string): string[] {
  const match = /\[([A-Za-z]+)\]/.exec(pattern);
  if (!match) {
    const rest = /\[\.\.\.([A-Za-z]+)\]/.exec(pattern);
    if (!rest) return [pattern];
    const values = CATCH_ALL[rest[1]];
    if (!values) throw new Error(`No data to fill ${rest[0]} in ${pattern}`);
    return values.map((value) => pattern.replace(rest[0], value));
  }
  const values = PARAMS[match[1]];
  if (!values || values.length === 0) throw new Error(`No data to fill ${match[0]} in ${pattern}`);
  return values.flatMap((value) => expand(pattern.replace(match[0], value)));
}

/** The Log in, Sign up and set-up pages are covered by auth.spec.ts and onboarding.spec.ts: they have no workspace shell to hold to this standard. */
export const AUTH_PAGES = ["/login", "/signup", "/onboarding"];

/**
 * Pages that exist only to answer "not found" in the right place (the catch-all for an address that matches nothing, and the addresses under the public
 * prefixes that name no Site or listing page). They are checked on their own (states, route-inventory and public-boundary specs), not crawled for a 2xx.
 */
export const NOT_FOUND_ONLY_PATTERNS = ["/[...unknown]", "/sites", "/listings", "/listings/[listingSlug]/[...rest]"] as const;

export function pagePatterns(): { pattern: string; shell: boolean }[] {
  return pageFiles(APP_DIR)
    .filter((file) => !relative(APP_DIR, file).split(sep).includes("(auth)"))
    .map((file) => {
      const parts = relative(APP_DIR, file).split(sep).slice(0, -1);
      const shell = !parts.includes("(public)") && !parts.includes("(preview)");
      const segments = parts.filter((part) => !/^\(.*\)$/.test(part));
      return { pattern: "/" + segments.join("/"), shell };
    })
    .filter(({ pattern }) => !(NOT_FOUND_ONLY_PATTERNS as readonly string[]).includes(pattern))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

export const ROUTE_INVENTORY: InventoryRoute[] = pagePatterns().flatMap(({ pattern, shell }) =>
  expand(pattern).map((url) => ({ url, pattern, shell })),
);

/**
 * The same pages in their other states: each tab, each way a page can be opened by a link, and the approved empty
 * state that the pages with a first-time screen preview with ?state=empty (Team previews its solo state).
 */
export const STATE_ROUTES: string[] = [
  "/bookings?tab=requests",
  "/bookings?tab=upcoming",
  "/bookings?tab=past",
  "/bookings?tab=cancelled",
  "/bookings?new=1",
  "/bookings?tab=past&booking=BK-1042",
  "/schedule?view=day",
  "/schedule?view=day&date=2024-10-26",
  "/jobs?tab=upcoming",
  "/jobs?tab=completed",
  "/payments?record=1",
  "/maintenance-plans?new=1",
  "/marketplace/edit?setup=1",
  "/quotes-invoices?tab=invoices",
  "/reviews?tab=awaiting",
  "/reviews?tab=responded",
  "/analytics?tab=bookings-jobs",
  "/analytics?tab=financial",
  "/analytics?tab=plans",
  "/analytics?range=last-month",
  "/analytics?range=custom&from=2024-10-10&to=2024-10-20",
  ...["/jobs", "/payments", "/maintenance-plans", "/services", "/website", "/marketplace", "/reviews", "/marketing"].map((path) => `${path}?state=empty`),
  "/team?state=solo",
];

/** The sidebar item a URL belongs to: the module that owns its first path segment. */
export const moduleOf = (url: string) => {
  const path = url.split("?")[0];
  return path === "/" ? "/" : "/" + path.split("/")[1];
};
