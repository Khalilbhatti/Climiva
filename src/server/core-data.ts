import "server-only";
import { cache } from "react";
import type { Customer, CustomerBook, Equipment, Property } from "@/data/customers";
import type { CoreSnapshot } from "@/data/directory";
import { loadCustomerBook, loadCustomerDetail, loadServices, loadTeamData } from "@/db/core-queries";
import { loadReportingAdjustments } from "@/db/adjustments";
import { loadFinancials } from "@/db/fin-queries";
import { loadMarketing } from "@/db/marketing-queries";
import { loadMarketplace } from "@/db/marketplace-queries";
import { loadMaintenance } from "@/db/maint-queries";
import { loadOperations } from "@/db/ops-queries";
import { loadReviews } from "@/db/review-queries";
import { loadPrimaryWebsite } from "@/db/site-queries";
import { getPeriodReport } from "@/db/reporting-queries";
import { withTenant } from "@/db/tenant";
import { monthTotalsOf, presetRange } from "@/lib/analytics-rules";
import { hostConfig } from "@/lib/domain-config";
import { can } from "@/lib/policy";
import { requireWorkspaceContext, resolveWorkspace } from "./workspace";

/**
 * Reading the core business data (customers, Services, Team) for the ACTIVE organization.
 *
 * Every reader resolves the workspace itself (a verified session, a verified active membership) and runs inside the tenant
 * transaction, so PostgreSQL's Row Level Security applies on top of the explicit organization predicates in
 * src/db/core-queries. Pages call these next to the data they show; none takes an organization from its arguments.
 *
 * `cache()` memoises within ONE request (a layout and a page that both ask pay for one query); React's cache is scoped to
 * the request and is never shared between people or businesses.
 */

/**
 * What the browser's providers hold for the active workspace: its Services, Team, customer book, operations (Bookings,
 * Jobs and blocked time, from which the Schedule is derived), financials (Quotes, Invoices and Payments), maintenance plans (with their visits) and
 * reviews (with their replies and requests), marketing campaigns, the primary Site's website state, the Marketplace listing, and what it needs of the reporting layer (the imported adjustments
 * to the Plans and Reviews totals, and this month's headline totals). The modules show names and addresses from the book, so it goes
 * with them. All of it is the ACTIVE organization's, read inside one tenant transaction; none of it is compiled into the
 * client bundle. At this scale the lists are sent whole; windowing them by date is the next step (docs/saas-architecture.md).
 * Null when nobody is signed in to a workspace.
 */
export const getCoreSnapshot = cache(async (): Promise<CoreSnapshot | null> => {
  const state = await resolveWorkspace();
  if (state.status !== "ready") return null;
  const { userId, organizationId, organization, snapshot, role } = state.context;
  return withTenant({ userId, organizationId }, async (tx) => {
    const services = await loadServices(tx, organizationId);
    const team = await loadTeamData(tx, organizationId);
    const book = await loadCustomerBook(tx, organizationId);
    const operations = await loadOperations(tx, organizationId, organization.timezone);
    const financials = await loadFinancials(tx, organizationId, organization.timezone);
    const maintenance = await loadMaintenance(tx, organizationId);
    const reviews = await loadReviews(tx, organizationId, organization.timezone);
    const marketing = await loadMarketing(tx, organizationId, organization.timezone);
    // A domain's verification record goes only to the people who may manage the website.
    const website = await loadPrimaryWebsite(tx, organizationId, { reveal: can(role, "website:manage"), routingTarget: hostConfig().customDomainTarget });
    const marketplace = await loadMarketplace(tx, organizationId, services, organization.timezone);
    const adjustments = await loadReportingAdjustments(tx, organizationId);
    const month = monthTotalsOf(await getPeriodReport(tx, organizationId, presetRange("this-month", snapshot.clock.today)));
    return { services, team, book, operations, financials, maintenance, reviews, marketing, website, marketplace, reporting: { adjustments, month } };
  });
});

/** The customers of the active business: for the Customers page. Redirects to Log in / set-up when there is no workspace. */
export const getCustomerBook = cache(async (): Promise<CustomerBook> => {
  const { userId, organizationId } = await requireWorkspaceContext();
  return withTenant({ userId, organizationId }, (tx) => loadCustomerBook(tx, organizationId));
});

export type CustomerDetail = { customer: Customer; properties: readonly Property[]; equipment: readonly Equipment[] };

/**
 * One customer of the active business, or null. A customer of another business and a customer that never existed are
 * indistinguishable: both are null.
 */
export const getCustomerDetail = cache(async (slug: string): Promise<CustomerDetail | null> => {
  const { userId, organizationId } = await requireWorkspaceContext();
  return withTenant({ userId, organizationId }, (tx) => loadCustomerDetail(tx, organizationId, slug));
});

/** The Services of the active business (for pages that must decide before rendering, such as a Service that does not exist). */
export const getServices = cache(async () => {
  const { userId, organizationId } = await requireWorkspaceContext();
  return withTenant({ userId, organizationId }, (tx) => loadServices(tx, organizationId));
});

/** The Team of the active business. */
export const getTeam = cache(async () => {
  const { userId, organizationId } = await requireWorkspaceContext();
  return withTenant({ userId, organizationId }, (tx) => loadTeamData(tx, organizationId));
});
