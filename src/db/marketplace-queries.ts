/**
 * Marketplace listing data access, inside an open tenant transaction.
 *
 * A business has at most one listing; having none IS the "not set up" state. The listing stores only its own configuration and the
 * Services it selects (by reference to the business's own Services, through composite keys). Everything else the directory shows is read
 * from the organization and its Services when the listing is drawn.
 *
 * Every function takes the transaction and the verified organization; a Service a request names is resolved INSIDE that organization, so
 * another business's Service is indistinguishable from one that does not exist. A listing row is locked before it is changed, so two saves
 * queue up. No `server-only` import (shared with the seed and the specs); no Client Component may import this file.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { defaultListingConfig, getEligibleServices, type ListingConfig, type ListingStatus, type ListingSuspension, type MarketplaceState, type CoverId, type ServiceArea } from "@/data/marketplace";
import type { Service } from "@/data/services";
import { instantToLocal } from "@/lib/business-time";
import { refuse } from "@/lib/refusal";
import type { Tx } from "./index";
import { marketplaceListingServices, marketplaceListings, marketplaceServiceAreas, services, type MarketplaceListingRow } from "./schema";

export type ListingContext = { tx: Tx; organizationId: string; organizationSlug: string };

export async function findListing(tx: Tx, organizationId: string): Promise<MarketplaceListingRow | undefined> {
  const rows = await tx.select().from(marketplaceListings).where(eq(marketplaceListings.organizationId, organizationId)).limit(1);
  return rows[0];
}

function statusOf(row: MarketplaceListingRow): ListingStatus {
  // A listing that was saved but never published is, to the business, one that is not set up.
  return row.status === "published" ? "published" : row.status === "hidden" ? "hidden" : "not-set-up";
}

/**
 * The business's listing as the Marketplace screens hold it. With no listing: not set up, with the defaults the setup form starts from.
 * `order` lists every eligible Service once: the selected ones in the listing's order, then the others in the catalog's.
 */
export async function loadMarketplace(tx: Tx, organizationId: string, catalog: readonly Service[], timeZone = "UTC"): Promise<MarketplaceState> {
  const row = await findListing(tx, organizationId);
  if (!row) return { status: "not-set-up", suspended: false, suspension: null, config: defaultListingConfig(catalog) };
  const selectedRows = await tx
    .select({ slug: services.slug, sortOrder: marketplaceListingServices.sortOrder })
    .from(marketplaceListingServices)
    .innerJoin(services, and(eq(services.organizationId, marketplaceListingServices.organizationId), eq(services.id, marketplaceListingServices.serviceId)))
    .where(and(eq(marketplaceListingServices.organizationId, organizationId), eq(marketplaceListingServices.listingId, row.id)))
    .orderBy(asc(marketplaceListingServices.sortOrder));
  const eligible = getEligibleServices(catalog).map((service) => service.id);
  // A Service that is no longer eligible (switched off, made internal) is not shown, but its selection is kept until the listing is saved.
  const selected = selectedRows.map((selection) => selection.slug).filter((slug) => eligible.includes(slug));
  const order = [...selected, ...eligible.filter((id) => !selected.includes(id))];
  const areaRows = await tx
    .select()
    .from(marketplaceServiceAreas)
    .where(and(eq(marketplaceServiceAreas.organizationId, organizationId), eq(marketplaceServiceAreas.listingId, row.id)))
    .orderBy(asc(marketplaceServiceAreas.sortOrder));
  const areas: ServiceArea[] = areaRows.map((area) => ({ city: area.city, state: area.stateRegion, postal: area.postalCode, label: area.label }));
  const config: ListingConfig = {
    description: row.description,
    cover: (row.cover as CoverId | null) ?? undefined,
    order,
    selected,
    contact: { phone: row.showPhone, email: row.showEmail, address: row.showAddress, hours: row.showHours, website: row.showWebsite },
    actions: { book: row.actionBook, website: row.actionWebsite, contact: row.actionContact },
    areas,
  };
  // Whether the PLATFORM has suspended the listing, and what it chose to tell the business about it. The internal reason, who decided and the audit trail
  // stay where the platform keeps them: the function answers with the business-facing part only.
  const suspension = await readSuspension(tx, timeZone);
  return { status: statusOf(row), suspended: suspension !== null, suspension, config, slug: row.publicSlug };
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The suspension of the ACTIVE organization's listing as the business may read it, or null (not suspended). */
async function readSuspension(tx: Tx, timeZone: string): Promise<ListingSuspension | null> {
  const raw = (await tx.execute<{ suspension: unknown }>(sql`select app_listing_suspension() as suspension`)).rows[0]?.suspension;
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const local = (value: unknown): string | null => (typeof value === "string" && value !== "" ? instantToLocal(new Date(value), timeZone) : null);
  const state = data.reviewState === "requested" ? "requested" : data.reviewState === "resolved" ? "resolved" : "none";
  return {
    message: textOrNull(data.message),
    suspendedAt: local(data.suspendedAt),
    review: {
      state,
      requestedAt: local(data.reviewRequestedAt),
      note: textOrNull(data.reviewNote),
      resolvedAt: local(data.reviewResolvedAt),
      outcome: data.reviewOutcome === "kept" ? "kept" : data.reviewOutcome === "lifted" ? "lifted" : null,
    },
  };
}

export type ReviewRequestResult = "requested" | "already_requested" | "not_suspended" | "too_soon";

/**
 * Ask the platform to look at the suspension again. Owners and admins only (the database function checks the same thing again). It records the request and
 * the member's note and changes nothing about visibility; one request at a time, and a day's wait after the platform keeps a suspension.
 */
export async function requestListingReview(tx: Tx, note: string | null): Promise<{ result: ReviewRequestResult; retryAfter: Date | null }> {
  const raw = (await tx.execute<{ data: unknown }>(sql`select app_request_listing_review(${note}) as data`)).rows[0]?.data;
  const data = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result: ReviewRequestResult = data.result === "requested" || data.result === "already_requested" || data.result === "too_soon" ? data.result : "not_suspended";
  return { result, retryAfter: typeof data.retryAfter === "string" ? new Date(data.retryAfter) : null };
}

async function lockListing(tx: Tx, organizationId: string): Promise<MarketplaceListingRow | undefined> {
  const rows = await tx.select().from(marketplaceListings).where(eq(marketplaceListings.organizationId, organizationId)).limit(1).for("update");
  return rows[0];
}

/** The Services a configuration selects, as rows of this business: each must be an eligible one (active, not internal). */
async function resolveSelection(tx: Tx, organizationId: string, config: ListingConfig): Promise<{ id: string; slug: string }[]> {
  const found = await tx.select({ id: services.id, slug: services.slug, active: services.isActive, visibility: services.visibility }).from(services).where(eq(services.organizationId, organizationId));
  const bySlug = new Map(found.map((service) => [service.slug, service]));
  const rank = (slug: string) => {
    const index = config.order.indexOf(slug);
    return index === -1 ? config.order.length : index;
  };
  const chosen = [...config.selected].sort((a, b) => rank(a) - rank(b));
  const resolved: { id: string; slug: string }[] = [];
  for (const slug of chosen) {
    const service = bySlug.get(slug);
    // A Service of another business, or one that does not exist, is "not in your catalog": the answer is the same.
    if (!service) return refuse("One of the selected Services is not in your catalog any more. Reload the page and try again.");
    if (!service.active || service.visibility === "internal") return refuse("Only active, public Services can be shown on a listing.", { services: "Only active, public Services can be shown on a listing." });
    resolved.push({ id: service.id, slug });
  }
  return resolved;
}

async function replaceSelection(tx: Tx, organizationId: string, listingId: string, selection: { id: string }[]): Promise<void> {
  await tx.delete(marketplaceListingServices).where(and(eq(marketplaceListingServices.organizationId, organizationId), eq(marketplaceListingServices.listingId, listingId)));
  if (selection.length > 0) {
    await tx.insert(marketplaceListingServices).values(selection.map((service, index) => ({ organizationId, listingId, serviceId: service.id, sortOrder: index })));
  }
}

/** The places the business works, replaced as a set in the order given. The database refuses a place twice and more than fifty. */
async function replaceAreas(tx: Tx, organizationId: string, listingId: string, areas: readonly ServiceArea[]): Promise<void> {
  await tx.delete(marketplaceServiceAreas).where(and(eq(marketplaceServiceAreas.organizationId, organizationId), eq(marketplaceServiceAreas.listingId, listingId)));
  if (areas.length > 0) {
    await tx.insert(marketplaceServiceAreas).values(areas.map((area, index) => ({ organizationId, listingId, city: area.city, stateRegion: area.state, postalCode: area.postal, label: area.label, sortOrder: index })));
  }
}

const columnsOf = (config: ListingConfig) => ({
  description: config.description,
  cover: config.cover ?? null,
  showPhone: config.contact.phone,
  showEmail: config.contact.email,
  showAddress: config.contact.address,
  showHours: config.contact.hours,
  showWebsite: config.contact.website,
  actionBook: config.actions.book,
  actionWebsite: config.actions.website,
  actionContact: config.actions.contact,
});

/** The listing's public identity for a business that has none yet: its address, kept unique among listings. */
async function newPublicSlug(tx: Tx, organizationSlug: string): Promise<string> {
  const base = organizationSlug.slice(0, 55).replace(/-+$/, "") || "listing";
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    const taken = await tx.select({ id: marketplaceListings.id }).from(marketplaceListings).where(eq(marketplaceListings.publicSlug, candidate)).limit(1);
    if (taken.length === 0) return candidate;
  }
  return refuse("Could not find a free listing address.");
}

/**
 * Save the listing's configuration. With `publish` it is the first-time setup: it creates the listing if there is none and publishes it.
 * Otherwise the listing must exist, and its published or hidden status is unchanged.
 */
export async function saveListing(ctx: ListingContext, config: ListingConfig, options: { publish: boolean }): Promise<void> {
  const { tx, organizationId } = ctx;
  const selection = await resolveSelection(tx, organizationId, config);
  const row = await lockListing(tx, organizationId);
  if (!row) {
    if (!options.publish) return refuse("Set up your listing first.");
    const publicSlug = await newPublicSlug(tx, ctx.organizationSlug);
    const [created] = await tx
      .insert(marketplaceListings)
      .values({ organizationId, publicSlug, status: "published", ...columnsOf(config) })
      .returning({ id: marketplaceListings.id });
    await replaceSelection(tx, organizationId, created.id, selection);
    await replaceAreas(tx, organizationId, created.id, config.areas);
    return;
  }
  await tx
    .update(marketplaceListings)
    .set({ ...columnsOf(config), ...(options.publish ? { status: "published" } : {}) })
    .where(and(eq(marketplaceListings.organizationId, organizationId), eq(marketplaceListings.id, row.id)));
  await replaceSelection(tx, organizationId, row.id, selection);
  await replaceAreas(tx, organizationId, row.id, config.areas);
}

/** Publish a saved listing, or hide a published one. Its configuration is untouched either way. */
export async function setListingStatus(ctx: ListingContext, status: "published" | "hidden"): Promise<void> {
  const { tx, organizationId } = ctx;
  const row = await lockListing(tx, organizationId);
  if (!row) return refuse("Set up your listing first.");
  if (status === "hidden" && row.status !== "published") return refuse("Only a published listing can be hidden.");
  if (status === "published" && row.status === "published") return;
  await tx.update(marketplaceListings).set({ status }).where(and(eq(marketplaceListings.organizationId, organizationId), eq(marketplaceListings.id, row.id)));
}

/* ───────────────────────── seeding and tests ───────────────────────── */

export type SeedListing = { status: "published" | "hidden"; slug?: string; config: ListingConfig };

/** Write a sample listing as an owner connection (the seed). The configuration is checked the way a request is. */
export async function insertSeedListing(tx: Tx, organizationId: string, organizationSlug: string, seed: SeedListing): Promise<void> {
  const selection = await resolveSelection(tx, organizationId, seed.config);
  const publicSlug = seed.slug ?? (await newPublicSlug(tx, organizationSlug));
  const [created] = await tx
    .insert(marketplaceListings)
    .values({ organizationId, publicSlug, status: seed.status, ...columnsOf(seed.config) })
    .returning({ id: marketplaceListings.id });
  await replaceSelection(tx, organizationId, created.id, selection);
  await replaceAreas(tx, organizationId, created.id, seed.config.areas);
}

export async function clearMarketplace(tx: Tx, organizationId: string): Promise<void> {
  await tx.delete(marketplaceServiceAreas).where(eq(marketplaceServiceAreas.organizationId, organizationId));
  await tx.delete(marketplaceListingServices).where(eq(marketplaceListingServices.organizationId, organizationId));
  await tx.delete(marketplaceListings).where(eq(marketplaceListings.organizationId, organizationId));
}
