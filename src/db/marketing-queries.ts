/**
 * Marketing: the queries and the rows <-> screens mapping.
 *
 * Like the other query modules, every function takes an open transaction (`tx`) and the organization it works for, and names that
 * organization in every statement's WHERE clause. They are meant to be called from `withTenant(...)`, where Row Level Security
 * enforces the same boundary again. The seed calls the same functions on the owner connection.
 *
 * A campaign moves Draft -> Scheduled -> Sent. Scheduling or sending resolves the audience from the business's OWN customers, takes
 * a SNAPSHOT of who is in it (name, email and phone as they are that moment), stores the recipient count and changes the status,
 * all in one transaction under a lock on the campaign row: two people scheduling the same campaign at once cannot both succeed,
 * and a campaign never ends up with two snapshots. Cancelling a schedule removes the pending snapshot and takes the campaign
 * back to Draft. A Sent campaign is final (the database refuses any change to it). Nothing is delivered anywhere.
 *
 * The UI types predate the database and stay as they are: a campaign's `id` is its reference ("cmp-fall-maintenance-reminder")
 * and a customer is named by its reference ("sarah-mitchell"). The database uuids never leave the server.
 *
 * No `server-only` import on purpose: scripts and tests use these too. Nothing under src/ that is a Client Component may import
 * this file (a test enforces it).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import {
  type AudienceId,
  type Campaign,
  type CampaignChannel,
  type CampaignRecipient,
  type CampaignStatus,
  type MarketingData,
} from "@/data/marketing";
import { KEY, adjustmentOf, type AdjustmentRow } from "@/lib/analytics-rules";
import { instantToLocal, localToInstant, type BusinessClock } from "@/lib/business-time";
import { GONE_CAMPAIGN, SENT_CAMPAIGN, STALE_CAMPAIGN, newCampaignRef, type CampaignContent } from "@/lib/marketing-rules";
import { refuse } from "@/lib/refusal";
import { loadAdjustments } from "./adjustments";
import type { Tx } from "./index";
import { loadRefs, type IdOptions, type Refs } from "./ops-queries";
import { customers, marketingCampaignRecipients, marketingCampaignSelectedCustomers, marketingCampaigns, teamMembers } from "./schema";
import { stableId } from "./stable-id";

const idFor = (options: IdOptions, organizationId: string, kind: string, reference: string) =>
  options.stableIds ? { id: stableId(organizationId, kind, reference) } : {};

type CampaignRow = typeof marketingCampaigns.$inferSelect;

/** The most people the application lists for one campaign at a time. The count it shows is always the campaign's own. */
export const RECIPIENT_LIST_LIMIT = 200;

/* ───────────────────────── reading ───────────────────────── */

function campaignFromRow(row: CampaignRow, selected: readonly string[], timeZone: string): Campaign {
  return {
    id: row.slug,
    name: row.name,
    summary: row.summary ?? undefined,
    channel: row.channel as CampaignChannel,
    audienceId: row.audienceId as AudienceId,
    selectedCustomerIds: row.audienceId === "selected" ? [...selected] : undefined,
    recipients: row.recipientCount ?? undefined,
    subject: row.subject ?? undefined,
    message: row.message ?? undefined,
    status: row.status as CampaignStatus,
    scheduledFor: row.scheduledFor ? instantToLocal(row.scheduledFor, timeZone) : undefined,
    sentAt: row.sentAt ? instantToLocal(row.sentAt, timeZone) : (row.sentOn ?? undefined),
    delivery: row.deliveredCount !== null && row.notDeliveredCount !== null ? { delivered: row.deliveredCount, notDelivered: row.notDeliveredCount } : undefined,
  };
}

/** Every campaign of one business, in the order they were made. The recipients are NOT here: they are asked for one campaign at a time. */
export async function loadMarketing(tx: Tx, organizationId: string, timeZone: string, refs?: Refs): Promise<MarketingData> {
  const resolved = refs ?? (await loadRefs(tx, organizationId));
  const rows = await tx.select().from(marketingCampaigns).where(eq(marketingCampaigns.organizationId, organizationId)).orderBy(asc(marketingCampaigns.position));
  const chosen = await tx
    .select()
    .from(marketingCampaignSelectedCustomers)
    .where(eq(marketingCampaignSelectedCustomers.organizationId, organizationId))
    .orderBy(asc(marketingCampaignSelectedCustomers.position));
  const byCampaign = new Map<string, string[]>();
  for (const item of chosen) {
    const slug = resolved.slugs.customers.get(item.customerId);
    if (slug) byCampaign.set(item.campaignId, [...(byCampaign.get(item.campaignId) ?? []), slug]);
  }
  return { campaigns: rows.map((row) => campaignFromRow(row, byCampaign.get(row.id) ?? [], timeZone)) };
}

/**
 * The recipient snapshot of one campaign: who it is for, with the contact details they had when it was scheduled or sent, in the
 * order they were taken. `total` is the campaign's own recipient count (it can exceed the rows: the sample business's audiences
 * include imported contacts that are counted but not listed). Null for a campaign that does not exist in this business.
 */
export async function loadCampaignRecipients(
  tx: Tx,
  organizationId: string,
  timeZone: string,
  slug: string,
): Promise<{ campaign: Campaign; recipients: CampaignRecipient[]; total: number } | null> {
  const [row] = await tx.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.organizationId, organizationId), eq(marketingCampaigns.slug, slug))).limit(1);
  if (!row) return null;
  const rows = await tx
    .select({ recipient: marketingCampaignRecipients, customerSlug: customers.slug })
    .from(marketingCampaignRecipients)
    .leftJoin(customers, and(eq(customers.organizationId, marketingCampaignRecipients.organizationId), eq(customers.id, marketingCampaignRecipients.customerId)))
    .where(and(eq(marketingCampaignRecipients.organizationId, organizationId), eq(marketingCampaignRecipients.campaignId, row.id)))
    .orderBy(asc(marketingCampaignRecipients.position))
    .limit(RECIPIENT_LIST_LIMIT);
  const chosen = row.audienceId === "selected" ? await selectedSlugs(tx, organizationId, row.id) : [];
  return {
    campaign: campaignFromRow(row, chosen, timeZone),
    total: row.recipientCount ?? rows.length,
    recipients: rows.map(({ recipient, customerSlug }, index) => ({
      id: String(index + 1),
      customerId: customerSlug ?? undefined,
      name: recipient.recipientName,
      email: recipient.recipientEmail ?? undefined,
      phone: recipient.recipientPhone ?? undefined,
      status: recipient.status as CampaignRecipient["status"],
      at: recipient.deliveredAt ? instantToLocal(recipient.deliveredAt, timeZone) : undefined,
      failureReason: recipient.failureReason ?? undefined,
    })),
  };
}

async function selectedSlugs(tx: Tx, organizationId: string, campaignId: string): Promise<string[]> {
  const rows = await tx
    .select({ slug: customers.slug })
    .from(marketingCampaignSelectedCustomers)
    .innerJoin(customers, and(eq(customers.organizationId, marketingCampaignSelectedCustomers.organizationId), eq(customers.id, marketingCampaignSelectedCustomers.customerId)))
    .where(and(eq(marketingCampaignSelectedCustomers.organizationId, organizationId), eq(marketingCampaignSelectedCustomers.campaignId, campaignId)))
    .orderBy(asc(marketingCampaignSelectedCustomers.position));
  return rows.map((row) => row.slug);
}

/* ───────────────────────── audiences ───────────────────────── */

export type AudienceContact = { id: string; slug: string; name: string; email: string | null; phone: string | null };
export type ResolvedAudience = {
  /** The customers who would be in a snapshot: this business's own, each with a destination for the channel. */
  contacts: AudienceContact[];
  /** How many people the audience reaches: the contacts, plus the sample business's imported contacts (counted, not listed). */
  total: number;
};

/**
 * Who an audience reaches, worked out from this business's own customers:
 *   all customers          everyone with an email address (email) or a phone number (SMS)
 *   due for maintenance    a completed Maintenance-category job, the latest more than six months before today
 *   maintenance customers  a completed Maintenance-category job, or any maintenance plan
 *   active plans           an active maintenance plan
 *   selected               exactly the customers chosen, if each is this business's own
 * A customer with no destination for the channel is left out (they could not receive it). The sample business's audiences also
 * include imported contacts its records do not list (an adjustment per channel and audience), which are counted in `total` only.
 */
export async function resolveAudience(
  tx: Tx,
  organizationId: string,
  today: string,
  channel: CampaignChannel,
  audienceId: AudienceId,
  selectedCustomerIds: readonly string[],
  adjustments?: readonly AdjustmentRow[],
): Promise<ResolvedAudience> {
  const destination = channel === "email" ? sql`nullif(btrim(c.email), '') is not null` : sql`nullif(btrim(c.phone), '') is not null`;
  const maintenanceJob = sql`exists (
    select 1 from jobs j join services s on s.organization_id = j.organization_id and s.id = j.service_id
     where j.organization_id = c.organization_id and j.customer_id = c.id and j.status = 'completed' and s.category = 'Maintenance')`;
  let filter = sql`true`;
  if (audienceId === "maintenance-customers") {
    filter = sql`(${maintenanceJob} or exists (select 1 from maintenance_plans p where p.organization_id = c.organization_id and p.customer_id = c.id))`;
  } else if (audienceId === "active-plans") {
    filter = sql`exists (select 1 from maintenance_plans p where p.organization_id = c.organization_id and p.customer_id = c.id and p.status = 'active')`;
  } else if (audienceId === "due-for-maintenance") {
    filter = sql`(select max(j.service_date) from jobs j join services s on s.organization_id = j.organization_id and s.id = j.service_id
                   where j.organization_id = c.organization_id and j.customer_id = c.id and j.status = 'completed' and s.category = 'Maintenance')
                 < (${today}::date - interval '6 months')::date`;
  } else if (audienceId === "selected") {
    if (selectedCustomerIds.length === 0) return { contacts: [], total: 0 };
    filter = sql`c.slug in (${sql.join(selectedCustomerIds.map((slug) => sql`${slug}`), sql`, `)})`;
  }
  const result = await tx.execute<{ id: string; slug: string; name: string; email: string | null; phone: string | null }>(sql`
    select c.id, c.slug, c.name, c.email, c.phone
      from customers c
     where c.organization_id = ${organizationId} and ${destination} and ${filter}
     order by c.position`);
  const contacts = result.rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, email: row.email, phone: row.phone }));
  if (audienceId === "selected") return { contacts, total: contacts.length };
  const rows = adjustments ?? (await loadAdjustments(tx, organizationId));
  const extra = adjustmentOf(rows, null, KEY.audienceExtra, `${channel}:${audienceId}`);
  return { contacts, total: Math.max(0, contacts.length + extra) };
}

/** How many people each audience reaches, per channel, for the builder. A chosen list is counted by the screen. */
export async function loadAudienceSizes(tx: Tx, organizationId: string, today: string): Promise<Record<CampaignChannel, Record<Exclude<AudienceId, "selected">, number>>> {
  const adjustments = await loadAdjustments(tx, organizationId);
  const sizes = { email: {}, sms: {} } as Record<CampaignChannel, Record<Exclude<AudienceId, "selected">, number>>;
  for (const channel of ["email", "sms"] as const) {
    for (const audience of ["all-customers", "due-for-maintenance", "maintenance-customers", "active-plans"] as const) {
      sizes[channel][audience] = (await resolveAudience(tx, organizationId, today, channel, audience, [], adjustments)).total;
    }
  }
  return sizes;
}

/* ───────────────────────── changing a campaign ───────────────────────── */

export type MarketingContext = {
  tx: Tx;
  organizationId: string;
  timeZone: string;
  refs: Refs;
  /** The business's own today and now ("2024-10-25", "2024-10-25T10:45"). */
  clock: BusinessClock;
  /** The instant a system event happening now is stamped with. */
  stamp: Date;
  /** The signed-in person: their Team record (if they have one) is who created a campaign. */
  actorUserId: string;
};

async function actorMember(ctx: Pick<MarketingContext, "tx" | "organizationId" | "actorUserId">): Promise<string | null> {
  const rows = await ctx.tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, ctx.organizationId), eq(teamMembers.userId, ctx.actorUserId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Campaign references are allocated under a transaction lock, so two campaigns made at the same moment never race for one name. */
async function lockReferences(ctx: Pick<MarketingContext, "tx" | "organizationId">): Promise<void> {
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.organizationId}:campaign-references`}, 0))`);
}

async function takenReferences(ctx: Pick<MarketingContext, "tx" | "organizationId">): Promise<Set<string>> {
  const rows = await ctx.tx.select({ slug: marketingCampaigns.slug }).from(marketingCampaigns).where(eq(marketingCampaigns.organizationId, ctx.organizationId));
  return new Set(rows.map((row) => row.slug));
}

/** The campaign, locked for this transaction (a second person changing it waits, then sees what the first did). */
async function lockCampaign(ctx: MarketingContext, slug: string, expected: CampaignStatus): Promise<CampaignRow> {
  const [row] = await ctx.tx
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.organizationId, ctx.organizationId), eq(marketingCampaigns.slug, slug)))
    .limit(1)
    .for("update");
  if (!row) return refuse(GONE_CAMPAIGN);
  if (row.status === "sent") return refuse(SENT_CAMPAIGN);
  if (row.status !== expected) return refuse(STALE_CAMPAIGN);
  return row;
}

/** The chosen customers must all be this business's own. */
async function chosenIds(ctx: MarketingContext, content: CampaignContent): Promise<string[]> {
  if (content.audienceId !== "selected") return [];
  const ids = content.selectedCustomerIds.map((slug) => ctx.refs.idBySlug.customers.get(slug));
  if (ids.some((id) => id === undefined)) return refuse("One of the chosen customers is not in your customers any more. Reload the page and choose again.");
  return ids as string[];
}

async function replaceChosen(ctx: MarketingContext, campaignId: string, customerIds: readonly string[]): Promise<void> {
  await ctx.tx.delete(marketingCampaignSelectedCustomers).where(and(eq(marketingCampaignSelectedCustomers.organizationId, ctx.organizationId), eq(marketingCampaignSelectedCustomers.campaignId, campaignId)));
  if (customerIds.length > 0) {
    await ctx.tx.insert(marketingCampaignSelectedCustomers).values(customerIds.map((customerId) => ({ organizationId: ctx.organizationId, campaignId, customerId })));
  }
}

async function removeSnapshot(ctx: MarketingContext, campaignId: string): Promise<void> {
  await ctx.tx.delete(marketingCampaignRecipients).where(and(eq(marketingCampaignRecipients.organizationId, ctx.organizationId), eq(marketingCampaignRecipients.campaignId, campaignId)));
}

async function takeSnapshot(ctx: MarketingContext, campaignId: string, contacts: readonly AudienceContact[]): Promise<void> {
  if (contacts.length === 0) return;
  await ctx.tx.insert(marketingCampaignRecipients).values(
    contacts.map((contact) => ({
      organizationId: ctx.organizationId,
      campaignId,
      customerId: contact.id,
      recipientName: contact.name,
      recipientEmail: contact.email,
      recipientPhone: contact.phone,
      status: "pending",
    })),
  );
}

const contentValues = (content: CampaignContent) => ({
  name: content.name,
  channel: content.channel,
  audienceId: content.audienceId,
  subject: content.channel === "email" ? content.subject : null,
  message: content.message,
});

/** A new Draft. Its recipient count is the audience size at this moment. Returns the campaign's row. */
async function insertDraft(ctx: MarketingContext, content: CampaignContent, extra: { summary?: string | null } = {}): Promise<CampaignRow> {
  await lockReferences(ctx);
  const slug = newCampaignRef(content.name, await takenReferences(ctx));
  const customerIds = await chosenIds(ctx, content);
  const audience = await resolveAudience(ctx.tx, ctx.organizationId, ctx.clock.today, content.channel, content.audienceId, content.selectedCustomerIds);
  const [row] = await ctx.tx
    .insert(marketingCampaigns)
    .values({
      organizationId: ctx.organizationId,
      slug,
      ...contentValues(content),
      summary: extra.summary ?? null,
      status: "draft",
      recipientCount: audience.total,
      createdBy: await actorMember(ctx),
    })
    .returning();
  await replaceChosen(ctx, row.id, customerIds);
  return row;
}

/**
 * Save a campaign as a Draft: a new one, or an existing Draft or Scheduled one (saving a Scheduled campaign as a draft cancels its
 * send). Returns the campaign's reference.
 */
export async function saveDraftTx(ctx: MarketingContext, target: { slug: string; expected: CampaignStatus } | undefined, content: CampaignContent): Promise<string> {
  if (!target) return (await insertDraft(ctx, content)).slug;
  const row = await lockCampaign(ctx, target.slug, target.expected);
  const customerIds = await chosenIds(ctx, content);
  const audience = await resolveAudience(ctx.tx, ctx.organizationId, ctx.clock.today, content.channel, content.audienceId, content.selectedCustomerIds);
  // The pending snapshot of a Scheduled campaign goes first (the database allows removing it only while the campaign is Scheduled).
  if (row.status === "scheduled") await removeSnapshot(ctx, row.id);
  await replaceChosen(ctx, row.id, customerIds);
  await ctx.tx
    .update(marketingCampaigns)
    .set({
      ...contentValues(content),
      status: "draft",
      scheduledFor: null,
      recipientCount: audience.total,
      ...(row.status === "scheduled" ? { cancelledAt: ctx.stamp } : {}),
    })
    .where(and(eq(marketingCampaigns.organizationId, ctx.organizationId), eq(marketingCampaigns.id, row.id)));
  return row.slug;
}

const NO_AUDIENCE = "No customers match this audience, so there is no one to send to.";

/**
 * Schedule a campaign (new, a Draft, or an already Scheduled one being rescheduled) for a business-local moment: resolve the
 * audience, replace the recipient snapshot and store the count, atomically. Returns the campaign's reference.
 */
export async function scheduleTx(
  ctx: MarketingContext,
  target: { slug: string; expected: CampaignStatus } | undefined,
  content: CampaignContent,
  when: string,
): Promise<string> {
  const row = target ? await lockCampaign(ctx, target.slug, target.expected) : await insertDraft(ctx, content);
  const customerIds = await chosenIds(ctx, content);
  const audience = await resolveAudience(ctx.tx, ctx.organizationId, ctx.clock.today, content.channel, content.audienceId, content.selectedCustomerIds);
  if (audience.total === 0) return refuse(NO_AUDIENCE);
  if (row.status === "scheduled") await removeSnapshot(ctx, row.id);
  await replaceChosen(ctx, row.id, customerIds);
  await ctx.tx
    .update(marketingCampaigns)
    .set({ ...contentValues(content), status: "scheduled", scheduledFor: localToInstant(when, ctx.timeZone), recipientCount: audience.total })
    .where(and(eq(marketingCampaigns.organizationId, ctx.organizationId), eq(marketingCampaigns.id, row.id)));
  await takeSnapshot(ctx, row.id, audience.contacts);
  return row.slug;
}

/**
 * Send a campaign now (new, a Draft, or a Scheduled one): record it as sent on the business's day, with a snapshot of who it went
 * to and their count. Nothing is delivered; no delivery result is recorded. Returns the campaign's reference.
 */
export async function sendTx(ctx: MarketingContext, target: { slug: string; expected: CampaignStatus } | undefined, content: CampaignContent): Promise<string> {
  const row = target ? await lockCampaign(ctx, target.slug, target.expected) : await insertDraft(ctx, content);
  const customerIds = await chosenIds(ctx, content);
  const audience = await resolveAudience(ctx.tx, ctx.organizationId, ctx.clock.today, content.channel, content.audienceId, content.selectedCustomerIds);
  if (audience.total === 0) return refuse(NO_AUDIENCE);
  if (row.status === "scheduled") await removeSnapshot(ctx, row.id);
  await replaceChosen(ctx, row.id, customerIds);
  await ctx.tx
    .update(marketingCampaigns)
    .set({ ...contentValues(content), status: "sent", scheduledFor: null, sentAt: ctx.stamp, sentOn: ctx.clock.today, recipientCount: audience.total })
    .where(and(eq(marketingCampaigns.organizationId, ctx.organizationId), eq(marketingCampaigns.id, row.id)));
  await takeSnapshot(ctx, row.id, audience.contacts);
  return row.slug;
}

/** Cancel a scheduled send: the campaign goes back to Draft, keeps its content, and its pending snapshot is removed. Never deletes it. */
export async function cancelScheduleTx(ctx: MarketingContext, slug: string): Promise<string> {
  const row = await lockCampaign(ctx, slug, "scheduled");
  await removeSnapshot(ctx, row.id);
  await ctx.tx
    .update(marketingCampaigns)
    .set({ status: "draft", scheduledFor: null, cancelledAt: ctx.stamp })
    .where(and(eq(marketingCampaigns.organizationId, ctx.organizationId), eq(marketingCampaigns.id, row.id)));
  return row.slug;
}

/**
 * A new Draft with the same channel, audience, subject and message. Whatever the original's status, the copy has no schedule, no
 * sent time, no delivery result and no recipient snapshot; the original is untouched. Returns the copy's reference.
 */
export async function duplicateTx(ctx: MarketingContext, slug: string): Promise<string> {
  const [row] = await ctx.tx
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.organizationId, ctx.organizationId), eq(marketingCampaigns.slug, slug)))
    .limit(1);
  if (!row) return refuse(GONE_CAMPAIGN);
  const chosen = row.audienceId === "selected" ? await selectedSlugs(ctx.tx, ctx.organizationId, row.id) : [];
  const suffix = " (copy)";
  const copy = await insertDraft(
    ctx,
    {
      name: `${row.name.slice(0, 120 - suffix.length)}${suffix}`,
      channel: row.channel as CampaignChannel,
      audienceId: row.audienceId as AudienceId,
      selectedCustomerIds: chosen,
      subject: row.subject,
      message: row.message,
    },
    { summary: row.summary },
  );
  return copy.slug;
}

/* ───────────────────────── seed and tests ───────────────────────── */

/** A recipient as the seed writes it: a customer's reference, or just a contact; with the delivery result where one was recorded. */
export type SeedRecipient = {
  customerId?: string;
  name: string;
  email?: string;
  phone?: string;
  status: "pending" | "delivered" | "not-delivered";
  /** Business-local "2024-10-18T10:15". */
  at?: string;
  failureReason?: string;
};

export type SeedCampaign = Campaign & { recipientRows?: readonly SeedRecipient[] };
export type SeedMarketing = { campaigns: readonly SeedCampaign[] };

/**
 * Write a whole set of campaigns for one business (the sample business, the second seed business, a test copy), in the order given.
 * The campaigns are history the product carries in: statuses, times, counts and delivery results are written as they are, which the
 * runtime role could never do. Instants are read from the local wall-clock strings in the business's time zone. Runs on the owner
 * connection after the customers are written.
 */
export async function insertMarketing(tx: Tx, organizationId: string, timeZone: string, data: SeedMarketing, refs: Refs, options: IdOptions = {}): Promise<void> {
  const customerId = (slug: string) => {
    const id = refs.idBySlug.customers.get(slug);
    if (!id) throw new Error(`Unknown customer "${slug}".`);
    return id;
  };
  for (const campaign of data.campaigns) {
    const [dayOnly, time] = (campaign.sentAt ?? "").split("T");
    const [row] = await tx
      .insert(marketingCampaigns)
      .values({
        organizationId,
        ...idFor(options, organizationId, "campaign", campaign.id),
        slug: campaign.id,
        name: campaign.name,
        summary: campaign.summary ?? null,
        channel: campaign.channel,
        audienceId: campaign.audienceId,
        subject: campaign.subject ?? null,
        message: campaign.message ?? null,
        status: campaign.status,
        scheduledFor: campaign.scheduledFor ? localToInstant(campaign.scheduledFor, timeZone) : null,
        sentAt: campaign.status === "sent" && time ? localToInstant(campaign.sentAt!, timeZone) : null,
        sentOn: campaign.status === "sent" ? dayOnly : null,
        recipientCount: campaign.recipients ?? null,
        deliveredCount: campaign.delivery?.delivered ?? null,
        notDeliveredCount: campaign.delivery?.notDelivered ?? null,
      })
      .returning({ id: marketingCampaigns.id });
    for (const slug of campaign.selectedCustomerIds ?? []) {
      await tx.insert(marketingCampaignSelectedCustomers).values({ organizationId, campaignId: row.id, customerId: customerId(slug) });
    }
    for (const recipient of campaign.recipientRows ?? []) {
      await tx.insert(marketingCampaignRecipients).values({
        organizationId,
        campaignId: row.id,
        customerId: recipient.customerId ? customerId(recipient.customerId) : null,
        recipientName: recipient.name,
        recipientEmail: recipient.email ?? null,
        recipientPhone: recipient.phone ?? null,
        status: recipient.status,
        deliveredAt: recipient.at ? localToInstant(recipient.at, timeZone) : null,
        failureReason: recipient.failureReason ?? null,
      });
    }
  }
}

/** Remove every campaign, chosen customer and recipient of one organization (tests reset a worker's copy of the sample business with this). */
export async function clearMarketing(tx: Tx, organizationId: string): Promise<void> {
  await tx.delete(marketingCampaignRecipients).where(eq(marketingCampaignRecipients.organizationId, organizationId));
  await tx.delete(marketingCampaignSelectedCustomers).where(eq(marketingCampaignSelectedCustomers.organizationId, organizationId));
  await tx.delete(marketingCampaigns).where(eq(marketingCampaigns.organizationId, organizationId));
}
