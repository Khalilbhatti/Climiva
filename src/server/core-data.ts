import "server-only";
import { cache } from "react";
import type { Customer, CustomerBook, Equipment, Property } from "@/data/customers";
import { EMPTY_CUSTOMER_BOOK } from "@/data/customers";
import type { CoreSnapshot } from "@/data/directory";
import { loadCustomerBook, loadCustomerDetail, loadServices, loadTeamData } from "@/db/core-queries";
import { withTenant } from "@/db/tenant";
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
 * What the browser's providers hold for the active workspace: the Services and the Team always (they are small and the
 * Bookings, Schedule and Jobs pickers need them), and the customer book only while the sample operations data needs it.
 * Null when nobody is signed in to a workspace.
 */
export const getCoreSnapshot = cache(async (): Promise<CoreSnapshot | null> => {
  const state = await resolveWorkspace();
  if (state.status !== "ready") return null;
  const { userId, organizationId, snapshot } = state.context;
  return withTenant({ userId, organizationId }, async (tx) => {
    const services = await loadServices(tx, organizationId);
    const team = await loadTeamData(tx, organizationId);
    const book = snapshot.hasSampleData ? await loadCustomerBook(tx, organizationId) : EMPTY_CUSTOMER_BOOK;
    return { services, team, book };
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
