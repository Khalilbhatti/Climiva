/**
 * A person's Climvia profile, one row per authenticated user.
 *
 * It holds only what Climvia shows about someone: their name and, later, a picture. It does not duplicate the
 * sign-in email (that is identity, in `auth_user`) and carries no role: authority is per organization, in
 * `organization_memberships`.
 *
 * Deleting the user deletes the profile.
 */
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { authUser } from "./auth";

export const profiles = pgTable(
  "profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => authUser.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    /** A reference to a stored image. Nothing is uploaded yet, so this is empty until object storage exists. */
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("profiles_full_name_length", sql`char_length(btrim(${table.fullName})) between 1 and 80`)],
).enableRLS();

export type ProfileRow = typeof profiles.$inferSelect;
