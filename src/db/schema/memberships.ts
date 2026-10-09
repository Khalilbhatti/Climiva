/**
 * Organization memberships: who may enter which workspace, and with what authority.
 *
 * `role` is SaaS authorization (owner / admin / member): what a person may do to the workspace itself. It is not
 * the Team module's job titles, assigned services or permission matrix, which describe the business's staff and
 * stay product data for now. `job_title` is only a display label ("Operations Lead") shown beside a person's name;
 * it grants nothing.
 *
 * A user may belong to many organizations and an organization has many users. One row per pair.
 *
 * Deletion: removing a user or an organization removes the membership row (access ends); nothing else cascades from
 * here. Rows are never updated or deleted by the runtime role directly: the SQL functions in the RLS migration do
 * it, so the last owner can never be removed or demoted.
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { authUser } from "./auth";
import { organizations } from "./organizations";

export const MEMBERSHIP_ROLES = ["owner", "admin", "member"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export const MEMBERSHIP_STATUSES = ["active", "invited"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    jobTitle: text("job_title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("organization_memberships_org_user_unique").on(table.organizationId, table.userId),
    index("organization_memberships_user_idx").on(table.userId),
    check("organization_memberships_role", sql`${table.role} in ('owner', 'admin', 'member')`),
    check("organization_memberships_status", sql`${table.status} in ('active', 'invited')`),
    check("organization_memberships_job_title", sql`${table.jobTitle} is null or char_length(btrim(${table.jobTitle})) between 1 and 60`),
  ],
).enableRLS();

export type MembershipRow = typeof organizationMemberships.$inferSelect;
