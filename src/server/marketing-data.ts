import "server-only";
import { cache } from "react";
import { loadAudienceSizes, loadCampaignRecipients } from "@/db/marketing-queries";
import { withTenant } from "@/db/tenant";
import { requireWorkspaceContext } from "./workspace";

/**
 * Reading Marketing data that is NOT part of the workspace snapshot, for the ACTIVE organization only.
 *
 * Every reader resolves the workspace itself (a verified session, a verified active membership) and runs inside the tenant
 * transaction, so PostgreSQL's Row Level Security applies on top of the explicit organization predicates in
 * src/db/marketing-queries. None takes an organization from its arguments.
 *
 * The campaigns themselves travel with the snapshot (src/server/core-data). What is read here is what a page asks for on demand:
 * how many people each audience reaches (for the campaign builder) and one campaign's recipient snapshot (for its detail page),
 * so the contact details of a business's customers are sent to the browser only on the page that shows them.
 */

/** How many people each audience reaches for each channel, from the business's own customers (and its imported contacts, if any). */
export const getAudienceSizes = cache(async () => {
  const { userId, organizationId, snapshot } = await requireWorkspaceContext();
  return withTenant({ userId, organizationId }, (tx) => loadAudienceSizes(tx, organizationId, snapshot.clock.today));
});

/** One campaign of the active business with its recipient snapshot, or null. A campaign of another business is null too. */
export const getCampaignWithRecipients = cache(async (slug: string) => {
  const { userId, organizationId, organization } = await requireWorkspaceContext();
  return withTenant({ userId, organizationId }, (tx) => loadCampaignRecipients(tx, organizationId, organization.timezone, slug));
});
