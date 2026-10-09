"use server";

import { customerHref } from "@/config/routes";
import { searchCustomers } from "@/db/core-queries";
import { withTenant } from "@/db/tenant";
import { ok, type ActionResult } from "@/lib/action-result";
import { MIN_QUERY, PER_GROUP, type SearchResult } from "@/lib/global-search";
import { requireMember } from "../authorize";

/**
 * The top-bar search's Customers group for a business that is not on the sample operations data: its customers, found in
 * PostgreSQL. Any signed-in member of the workspace may search; the organization searched is the verified active one and
 * the request names none. Another business's customers are not findable, whatever is typed.
 */
export async function searchCustomersAction(query: unknown): Promise<ActionResult<SearchResult[]>> {
  const auth = await requireMember();
  if (!auth.ok) return auth.result;
  const text = typeof query === "string" ? query.trim() : "";
  if (text.length < MIN_QUERY || text.length > 80) return ok([]);
  const { userId, organizationId } = auth.context;
  const hits = await withTenant({ userId, organizationId }, (tx) => searchCustomers(tx, organizationId, text, PER_GROUP));
  return ok(
    hits.map(({ customer, property }): SearchResult => ({
      id: customer.id,
      group: "Customers",
      title: customer.name,
      detail: [property?.street, customer.phone].filter(Boolean).join(" · "),
      href: customerHref(customer.id),
    })),
  );
}
