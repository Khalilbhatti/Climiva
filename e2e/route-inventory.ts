/**
 * The route inventory, derived from the app folder rather than written down: every page file becomes a URL pattern,
 * and each dynamic segment is filled from the real data modules. A new page that this cannot expand fails the
 * inventory test, so a route can never be added without being crawled.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { FINANCIALS } from "../src/data/financials";
import { JOBS } from "../src/data/operations";
import { PLANS } from "../src/data/maintenance-plans";
import { CAMPAIGNS } from "../src/data/marketing";
import { REVIEWS_DATA } from "../src/data/reviews";
import { WEBSITE_PAGES } from "../src/data/website";
import { CUSTOMERS, ROLES, SERVICES, TEAM } from "./apex-data";

export type InventoryRoute = {
  /** The URL that is visited. */
  url: string;
  /** The page file's route pattern, e.g. "/customers/[customerId]". */
  pattern: string;
  /** Pages in the (site) group are customer-facing and have no workspace shell. */
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
  pageId: WEBSITE_PAGES.map((page) => page.id),
  reviewId: REVIEWS_DATA.reviews.map((review) => review.id),
  campaignId: CAMPAIGNS.map((campaign) => campaign.id),
};

function expand(pattern: string): string[] {
  const match = /\[([A-Za-z]+)\]/.exec(pattern);
  if (!match) return [pattern];
  const values = PARAMS[match[1]];
  if (!values || values.length === 0) throw new Error(`No data to fill ${match[0]} in ${pattern}`);
  return values.flatMap((value) => expand(pattern.replace(match[0], value)));
}

/** The Log in, Sign up and set-up pages are covered by auth.spec.ts and onboarding.spec.ts: they have no workspace shell to hold to this standard. */
export const AUTH_PAGES = ["/login", "/signup", "/onboarding"];

export function pagePatterns(): { pattern: string; shell: boolean }[] {
  return pageFiles(APP_DIR)
    .filter((file) => !relative(APP_DIR, file).split(sep).includes("(auth)"))
    .map((file) => {
      const parts = relative(APP_DIR, file).split(sep).slice(0, -1);
      const shell = !parts.includes("(site)");
      const segments = parts.filter((part) => !/^\(.*\)$/.test(part));
      return { pattern: "/" + segments.join("/"), shell };
    })
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
