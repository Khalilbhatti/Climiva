/**
 * Who may do what to a workspace: the ONE place the answer lives.
 *
 * This is the SaaS authorization of Phase 9 (the role in `organization_memberships`: owner, admin or member), not the Team
 * module's roles. A Team role is a label and a permission matrix the business shows on a screen; it never decides what the
 * server allows. Every server action asks `can(...)`, the pages read the same answers from the workspace snapshot to
 * disable what the person may not use, and PostgreSQL's Row Level Security enforces the owner/admin rule a third time.
 *
 * Today owners and admins change the business's settings, Services, Team, operations (bookings, jobs, assignments),
 * financials (invoices, payments, quotes), maintenance plans (create a plan, schedule a visit), reviews (reply, request a
 * review) and marketing (campaigns); members read everything they can see.
 * (Customers have no editing flow yet; when one ships it gets a capability here and a matching database policy.)
 */
import type { OrganizationRole } from "./workspace-types";

export type Capability =
  | "settings:manage"
  | "services:manage"
  | "team:manage"
  | "operations:manage"
  | "financials:manage"
  | "maintenance:manage"
  | "reviews:manage"
  | "marketing:manage";

const GRANTS: Record<Capability, readonly OrganizationRole[]> = {
  "settings:manage": ["owner", "admin"],
  "services:manage": ["owner", "admin"],
  "team:manage": ["owner", "admin"],
  // Bookings, Jobs, assignments and the Schedule. Members read them.
  "operations:manage": ["owner", "admin"],
  // Quotes, Invoices and Payments (the money a business receives from its customers). Members read them.
  "financials:manage": ["owner", "admin"],
  // Maintenance Plans: creating a plan and scheduling its included visits. Members read them.
  "maintenance:manage": ["owner", "admin"],
  // Reviews: replying to a review and recording a request for one. Members read them.
  "reviews:manage": ["owner", "admin"],
  // Marketing: creating, scheduling, sending (recording), cancelling and duplicating campaigns. Members read them.
  "marketing:manage": ["owner", "admin"],
};

export const CAPABILITIES = Object.keys(GRANTS) as Capability[];

export function can(role: OrganizationRole, capability: Capability): boolean {
  return GRANTS[capability].includes(role);
}

/** Every capability a role has, for handing to the browser. */
export function capabilitiesOf(role: OrganizationRole): Capability[] {
  return CAPABILITIES.filter((capability) => can(role, capability));
}
