/**
 * Authentication identity, owned by Better Auth (email + password sessions).
 *
 * These four tables are deliberately kept apart from everything Climvia knows about a business. They hold who a
 * person is and how they proved it; nothing about workspaces, roles or business data. Climvia's own tables
 * reference `auth_user.id` and never copy anything from here except that id.
 *
 * The shape follows Better Auth's core schema. The JavaScript keys (`emailVerified`, `userId` …) are the model field
 * names Better Auth looks for; the column names are snake_case like the rest of the database.
 *
 * No Row Level Security here: Better Auth reads and writes these tables before anyone is signed in, so there is no
 * user to scope them to. They contain no tenant data.
 */
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [index("auth_session_user_id_idx").on(table.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** The scrypt hash Better Auth makes for email + password sign-in. Climvia never computes or reads it. */
    password: text("password"),
    ...timestamps,
  },
  (table) => [index("auth_account_user_id_idx").on(table.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);
