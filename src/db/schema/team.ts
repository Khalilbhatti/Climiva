/**
 * Team: the people who work in the business, their access roles and their availability.
 *
 * THIS IS NOT `organization_memberships`. A membership says who may sign in to Climvia and what they may do to the
 * workspace (owner / admin / member): SaaS authorization, enforced by Row Level Security. A team member is a WORKER of the
 * business (a technician, a scheduler, the owner who also works the field). The two overlap but neither implies the other:
 *
 *  - a team member may have a Climvia login (`user_id` set) or none at all (most technicians never sign in);
 *  - an organization member (say, a bookkeeper with read access) need not be a team member;
 *  - deactivating a team member changes the team record only; it never removes the person's membership or login.
 *
 * `team_roles` are the business's own access roles shown on the Roles screen (Owner, Technician, Bookkeeper …) with a
 * permission matrix. They are product configuration, NOT the security boundary: nothing in the database or the server
 * reads them to decide who may write. The SaaS role in `organization_memberships` is the only authority.
 *
 * Every table carries `organization_id` and reaches its parents through composite (organization_id, id) foreign keys,
 * so a member can only be given a role, a Service or a time off period that belong to the SAME organization.
 *
 * JSONB contracts
 *   team_roles.permissions / team_members.permission_override:
 *     { overview, bookings, schedule, jobs, customers, services, team, "quotes-invoices", payments,
 *       "maintenance-plans", website, marketplace, reviews, marketing, analytics, settings }
 *     each one of "none" | "view" | "manage".
 *
 * Wall-clock values (activity times) are text "YYYY-MM-DDTHH:mm" in the business's own time zone and are never
 * converted, like the business hours.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, smallint, text, time, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUser } from "./auth";
import { organizations } from "./organizations";
import { services } from "./services";

export const teamRoles = pgTable(
  "team_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    position: integer("position").generatedAlwaysAsIdentity(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull().default("custom"),
    /** The Owner role cannot be edited. */
    isProtected: boolean("is_protected").notNull().default(false),
    permissions: jsonb("permissions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("team_roles_org_id_unique").on(table.organizationId, table.id),
    unique("team_roles_org_slug_unique").on(table.organizationId, table.slug),
    uniqueIndex("team_roles_org_name_unique").on(table.organizationId, sql`lower(${table.name})`),
    check("team_roles_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 80`),
    check("team_roles_name_length", sql`char_length(btrim(${table.name})) between 1 and 60`),
    check("team_roles_kind", sql`${table.kind} in ('system', 'custom')`),
    check("team_roles_permissions_shape", sql`jsonb_typeof(${table.permissions}) = 'object'`),
  ],
).enableRLS();

export type TeamRoleRow = typeof teamRoles.$inferSelect;

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    position: integer("position").generatedAlwaysAsIdentity(),
    slug: text("slug").notNull(),
    /** The Climvia login of this person, when they have one. Most technicians do not. */
    userId: text("user_id").references(() => authUser.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    /** Job title shown across Schedule, Jobs and Bookings ("Operations Lead", "Technician"). */
    jobTitle: text("job_title").notNull(),
    /** A longer title where the Team list shows one under the name. */
    title: text("title"),
    roleId: uuid("role_id"),
    email: text("email"),
    phone: text("phone"),
    status: text("status").notNull().default("active"),
    /** Can be assigned to Jobs and appears on the Schedule. */
    fieldAssignable: boolean("field_assignable").notNull().default(false),
    /** "March 2023", only where it is known. */
    memberSince: text("member_since"),
    notes: text("notes"),
    /** "all" = every active service, now and later. "selected" = only the rows in team_member_services. */
    serviceMode: text("service_mode").notNull().default("all"),
    /** Member-specific permissions; null = inherit the role. */
    permissionOverride: jsonb("permission_override"),
    availabilityMode: text("availability_mode").notNull().default("business-hours"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "team_members_role_fk", columns: [table.organizationId, table.roleId], foreignColumns: [teamRoles.organizationId, teamRoles.id] }),
    unique("team_members_org_id_unique").on(table.organizationId, table.id),
    unique("team_members_org_slug_unique").on(table.organizationId, table.slug),
    // One login is at most one team member in a given business.
    uniqueIndex("team_members_org_user_unique").on(table.organizationId, table.userId).where(sql`${table.userId} is not null`),
    index("team_members_org_status_idx").on(table.organizationId, table.status),
    index("team_members_role_idx").on(table.organizationId, table.roleId),
    check("team_members_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 80`),
    check("team_members_name_length", sql`char_length(btrim(${table.name})) between 1 and 80`),
    check("team_members_status", sql`${table.status} in ('active', 'invited', 'inactive')`),
    check("team_members_service_mode", sql`${table.serviceMode} in ('all', 'selected')`),
    check("team_members_availability_mode", sql`${table.availabilityMode} in ('business-hours', 'custom', 'not-set')`),
    check("team_members_override_shape", sql`${table.permissionOverride} is null or jsonb_typeof(${table.permissionOverride}) = 'object'`),
  ],
).enableRLS();

export type TeamMemberRow = typeof teamMembers.$inferSelect;

/** The Services a member is eligible for when `service_mode = 'selected'`. */
export const teamMemberServices = pgTable(
  "team_member_services",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull(),
    serviceId: uuid("service_id").notNull(),
  },
  (table) => [
    primaryKey({ name: "team_member_services_pk", columns: [table.memberId, table.serviceId] }),
    foreignKey({ name: "team_member_services_member_fk", columns: [table.organizationId, table.memberId], foreignColumns: [teamMembers.organizationId, teamMembers.id] }).onDelete("cascade"),
    foreignKey({ name: "team_member_services_service_fk", columns: [table.organizationId, table.serviceId], foreignColumns: [services.organizationId, services.id] }).onDelete("cascade"),
    index("team_member_services_service_idx").on(table.organizationId, table.serviceId),
  ],
).enableRLS();

/** A member's custom weekly schedule: one row per weekday (0 = Sunday), always seven. Used when `availability_mode = 'custom'`. */
export const teamMemberAvailability = pgTable(
  "team_member_availability",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull(),
    dayOfWeek: smallint("day_of_week").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakStart: time("break_start"),
    breakEnd: time("break_end"),
  },
  (table) => [
    primaryKey({ name: "team_member_availability_pk", columns: [table.memberId, table.dayOfWeek] }),
    foreignKey({ name: "team_member_availability_member_fk", columns: [table.organizationId, table.memberId], foreignColumns: [teamMembers.organizationId, teamMembers.id] }).onDelete("cascade"),
    check("team_member_availability_day", sql`${table.dayOfWeek} between 0 and 6`),
    check("team_member_availability_break", sql`(${table.breakStart} is null) = (${table.breakEnd} is null)`),
  ],
).enableRLS();

/** Time off, training and other periods a member cannot be scheduled. Not a second Schedule: the Schedule reads these. */
export const teamMemberUnavailablePeriods = pgTable(
  "team_member_unavailable_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull(),
    position: integer("position").generatedAlwaysAsIdentity(),
    /** The period's identifier in the member's availability ("off-mv-1"). Unique per member. */
    ref: text("ref").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    /** Set for part-day periods, e.g. a morning of training. */
    startTime: time("start_time"),
    endTime: time("end_time"),
  },
  (table) => [
    foreignKey({ name: "team_member_unavailable_member_fk", columns: [table.organizationId, table.memberId], foreignColumns: [teamMembers.organizationId, teamMembers.id] }).onDelete("cascade"),
    unique("team_member_unavailable_ref_unique").on(table.memberId, table.ref),
    index("team_member_unavailable_member_idx").on(table.organizationId, table.memberId),
    check("team_member_unavailable_dates", sql`${table.endDate} >= ${table.startDate}`),
    check("team_member_unavailable_times", sql`(${table.startTime} is null) = (${table.endTime} is null)`),
    check("team_member_unavailable_title", sql`char_length(btrim(${table.title})) between 1 and 120`),
  ],
).enableRLS();

/** What changed on a member's record, newest first. A plain list: no change history for compliance, no event stream. */
export const teamActivity = pgTable(
  "team_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull(),
    /** Insertion order; the newest entry has the highest position. */
    position: integer("position").generatedAlwaysAsIdentity(),
    /** The entry's identifier on the member ("act-mv-1"). Unique per member. */
    ref: text("ref").notNull(),
    /** "YYYY-MM-DDTHH:mm", business-local. */
    occurredAt: text("occurred_at").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    /** The team member who made the change, when known. */
    byMemberId: uuid("by_member_id"),
    /** A Job reference ("JB-204") until jobs are on the database. */
    jobRef: text("job_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "team_activity_member_fk", columns: [table.organizationId, table.memberId], foreignColumns: [teamMembers.organizationId, teamMembers.id] }).onDelete("cascade"),
    foreignKey({ name: "team_activity_by_fk", columns: [table.organizationId, table.byMemberId], foreignColumns: [teamMembers.organizationId, teamMembers.id] }),
    unique("team_activity_ref_unique").on(table.memberId, table.ref),
    index("team_activity_member_idx").on(table.organizationId, table.memberId, table.occurredAt),
    check("team_activity_occurred_at", sql`${table.occurredAt} ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$'`),
    check("team_activity_category", sql`${table.category} in ('access', 'availability', 'jobs', 'services')`),
    check("team_activity_title", sql`char_length(btrim(${table.title})) between 1 and 200`),
  ],
).enableRLS();

export type TeamActivityRow = typeof teamActivity.$inferSelect;
