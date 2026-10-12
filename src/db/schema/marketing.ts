/**
 * Marketing: lightweight email and text-message campaigns to a business's existing customers. A campaign is a name, a channel, an
 * audience, a message and a status (Draft, Scheduled or Sent). Nothing is delivered anywhere: provider delivery (an email or SMS
 * service) is not built, so "sent" is a recorded state and the delivery figures of a sent campaign are recorded data, not the result
 * of a send made from here.
 *
 * Every table carries its own `organization_id` and reaches its parents through composite (organization_id, id) foreign keys, so an
 * Apex campaign cannot name a Northstar customer or team member, a recipient cannot belong to another business's campaign, and a
 * chosen customer cannot be another business's, whoever writes the row. Row Level Security (0011) lets members of the ACTIVE
 * organization read and owners and admins write; nothing is ever deleted except a campaign's own pending recipient snapshot.
 *
 *   marketing_campaigns                   the campaign; a Draft stores only its audience CONFIGURATION
 *   marketing_campaign_selected_customers the customers a Draft (or Scheduled) campaign chose one by one
 *   marketing_campaign_recipients         the recipient SNAPSHOT: taken when a campaign is scheduled or sent, so a later edit of a
 *                                         customer never rewrites who a campaign was for or what their contact details were
 *
 * Times: `scheduled_for` and `sent_at` are instants (timestamptz). A scheduled time is chosen as the business's local wall-clock
 * time and converted with the business's time zone (lib/business-time), so "Oct 30 2024 9:00 AM" in America/Chicago is the same
 * instant for every browser and server. A campaign sent before the system kept the time of day has only `sent_on`, a calendar date.
 */
import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { organizations } from "./organizations";
import { teamMembers } from "./team";

export const CAMPAIGN_CHANNEL_VALUES = ["email", "sms"] as const;
export const CAMPAIGN_STATUS_VALUES = ["draft", "scheduled", "sent"] as const;
export const CAMPAIGN_AUDIENCE_VALUES = ["all-customers", "due-for-maintenance", "maintenance-customers", "active-plans", "selected"] as const;
/** `pending`: in the snapshot, with no delivery result recorded. */
export const RECIPIENT_STATUS_VALUES = ["pending", "delivered", "not-delivered"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/* ───────────────────────── campaigns ───────────────────────── */

export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The reference the screens and addresses use ("cmp-fall-maintenance-reminder"), unique within the organization. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** The short line under the name in the list. */
    summary: text("summary"),
    channel: text("channel").notNull(),
    audienceId: text("audience_id").notNull(),
    /** Email only. */
    subject: text("subject"),
    message: text("message"),
    status: text("status").notNull(),
    /** The instant a Scheduled campaign goes out (chosen in the business's local time). */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    /** The instant a Sent campaign went out, where the time is recorded. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** The business's calendar day a Sent campaign went out. */
    sentOn: date("sent_on", { mode: "string" }),
    /** When this campaign's schedule was last cancelled (the campaign went back to Draft). History; never cleared. */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /**
     * How many people the campaign is for (a Draft: the audience size when it was last saved; Scheduled and Sent: the number the
     * snapshot was taken for). It can exceed the snapshot's rows: the sample business's audiences describe a full customer base
     * the detailed customer records do not carry, the imported contacts of its baseline.
     */
    recipientCount: integer("recipient_count"),
    /** A Sent campaign's recorded delivery result. Both or neither; they add up to the recipient count. */
    deliveredCount: integer("delivered_count"),
    notDeliveredCount: integer("not_delivered_count"),
    /** The Team member who created it, when the person has a Team record. */
    createdBy: uuid("created_by"),
    /** The order campaigns are listed in. */
    position: integer("position").generatedAlwaysAsIdentity(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "campaigns_created_by_fk", columns: [table.organizationId, table.createdBy], foreignColumns: [teamMembers.organizationId, teamMembers.id] }),
    unique("campaigns_org_id_unique").on(table.organizationId, table.id),
    unique("campaigns_org_slug_unique").on(table.organizationId, table.slug),
    index("campaigns_org_status_idx").on(table.organizationId, table.status, table.position),
    index("campaigns_org_sent_idx").on(table.organizationId, table.sentOn),
    check("campaigns_slug", sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]{0,119}$'`),
    check("campaigns_name", sql`char_length(btrim(${table.name})) between 1 and 120`),
    check("campaigns_channel", sql`${table.channel} in (${list(CAMPAIGN_CHANNEL_VALUES)})`),
    check("campaigns_status", sql`${table.status} in (${list(CAMPAIGN_STATUS_VALUES)})`),
    check("campaigns_audience", sql`${table.audienceId} in (${list(CAMPAIGN_AUDIENCE_VALUES)})`),
    // A text message is short; a text message has no subject.
    check("campaigns_message", sql`${table.message} is null or (char_length(${table.message}) <= 5000 and (${table.channel} = 'email' or char_length(${table.message}) <= 160))`),
    check("campaigns_subject", sql`${table.subject} is null or (${table.channel} = 'email' and char_length(${table.subject}) <= 200)`),
    // The status says what happened: Scheduled has its time, Sent has its day, a Draft has neither, and only a Sent campaign has a result.
    check("campaigns_scheduled", sql`(${table.status} = 'scheduled') = (${table.scheduledFor} is not null)`),
    check("campaigns_sent", sql`(${table.status} = 'sent') = (${table.sentOn} is not null) and (${table.sentAt} is null or ${table.status} = 'sent')`),
    check("campaigns_recipient_count", sql`${table.recipientCount} is null or ${table.recipientCount} >= 0`),
    check("campaigns_scheduled_count", sql`${table.status} = 'draft' or ${table.recipientCount} is not null`),
    // Delivered + not delivered = sent, where the result is recorded.
    check("campaigns_delivery", sql`(${table.deliveredCount} is null) = (${table.notDeliveredCount} is null) and (${table.deliveredCount} is null or (${table.status} = 'sent' and ${table.deliveredCount} >= 0 and ${table.notDeliveredCount} >= 0 and ${table.deliveredCount} + ${table.notDeliveredCount} = ${table.recipientCount}))`),
  ],
).enableRLS();

export type MarketingCampaignRow = typeof marketingCampaigns.$inferSelect;

/* ───────────────────────── chosen customers ───────────────────────── */

/** The customers a campaign with the "Selected customers" audience chose one by one. A configuration, not a snapshot. */
export const marketingCampaignSelectedCustomers = pgTable(
  "marketing_campaign_selected_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    position: integer("position").generatedAlwaysAsIdentity(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "campaign_selected_campaign_fk", columns: [table.organizationId, table.campaignId], foreignColumns: [marketingCampaigns.organizationId, marketingCampaigns.id] }).onDelete("cascade"),
    foreignKey({ name: "campaign_selected_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    unique("campaign_selected_unique").on(table.organizationId, table.campaignId, table.customerId),
    index("campaign_selected_campaign_idx").on(table.organizationId, table.campaignId),
  ],
).enableRLS();

/* ───────────────────────── recipients ───────────────────────── */

/**
 * One person a Scheduled or Sent campaign is for. A snapshot: the name and the contact details are copied when the campaign is
 * scheduled or sent, and are never rewritten by a later edit of the customer. `customer_id` links the person to the Customers
 * record where there is one, but is not required to last (a recipient with no Customers record is just a name and a contact).
 */
export const marketingCampaignRecipients = pgTable(
  "marketing_campaign_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull(),
    customerId: uuid("customer_id"),
    recipientName: text("recipient_name").notNull(),
    recipientEmail: text("recipient_email"),
    recipientPhone: text("recipient_phone"),
    status: text("status").notNull(),
    /** When the delivery result was recorded. */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    position: integer("position").generatedAlwaysAsIdentity(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "campaign_recipients_campaign_fk", columns: [table.organizationId, table.campaignId], foreignColumns: [marketingCampaigns.organizationId, marketingCampaigns.id] }).onDelete("cascade"),
    foreignKey({ name: "campaign_recipients_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    // A customer is in a campaign's snapshot once.
    uniqueIndex("campaign_recipients_customer_unique").on(table.organizationId, table.campaignId, table.customerId).where(sql`${table.customerId} is not null`),
    index("campaign_recipients_campaign_idx").on(table.organizationId, table.campaignId, table.position),
    index("campaign_recipients_customer_idx").on(table.organizationId, table.customerId),
    check("campaign_recipients_name", sql`char_length(btrim(${table.recipientName})) between 1 and 200`),
    check("campaign_recipients_status", sql`${table.status} in (${list(RECIPIENT_STATUS_VALUES)})`),
    // A result has a time; a reason only goes with "not delivered".
    check("campaign_recipients_result", sql`(${table.status} = 'pending') = (${table.deliveredAt} is null) and (${table.failureReason} is null or ${table.status} = 'not-delivered')`),
  ],
).enableRLS();

export type MarketingCampaignRecipientRow = typeof marketingCampaignRecipients.$inferSelect;
