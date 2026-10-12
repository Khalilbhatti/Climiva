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
import { and, asc, eq } from "drizzle-orm";
import { defaultListingConfig, getEligibleServices, type ListingConfig, type ListingStatus, type MarketplaceState, type CoverId } from "@/data/marketplace";
import type { Service } from "@/data/services";
import { refuse } from "@/lib/refusal";
import type { Tx } from "./index";
import { marketplaceListingServices, marketplaceListings, services, type MarketplaceListingRow } from "./schema";

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
export async function loadMarketplace(tx: Tx, organizationId: string, catalog: readonly Service[]): Promise<MarketplaceState> {
  const row = await findListing(tx, organizationId);
  if (!row) return { status: "not-set-up", config: defaultListingConfig(catalog) };
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
  const config: ListingConfig = {
    description: row.description,
    cover: (row.cover as CoverId | null) ?? undefined,
    order,
    selected,
    contact: { phone: row.showPhone, email: row.showEmail, address: row.showAddress, hours: row.showHours, website: row.showWebsite },
    actions: { book: row.actionBook, website: row.actionWebsite, contact: row.actionContact },
  };
  return { status: statusOf(row), config, slug: row.publicSlug };
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
    return;
  }
  await tx
    .update(marketplaceListings)
    .set({ ...columnsOf(config), ...(options.publish ? { status: "published" } : {}) })
    .where(and(eq(marketplaceListings.organizationId, organizationId), eq(marketplaceListings.id, row.id)));
  await replaceSelection(tx, organizationId, row.id, selection);
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
}

export async function clearMarketplace(tx: Tx, organizationId: string): Promise<void> {
  await tx.delete(marketplaceListingServices).where(eq(marketplaceListingServices.organizationId, organizationId));
  await tx.delete(marketplaceListings).where(eq(marketplaceListings.organizationId, organizationId));
}
