/**
 * The PUBLIC read and write paths: what a visitor without a session can reach.
 *
 * A visitor has no session, no membership and no organization, so none of the tenant queries (which run inside `withTenant`, under Row
 * Level Security) apply to them. They go through these SQL functions (migrations 0013, 0018, 0020, 0021 and 0025), which are the only place a request with no
 * membership touches tenant rows:
 *
 *   app_public_site(platform_slug, page_slug)   a PUBLISHED site as a visitor sees it
 *   app_public_listing(public_slug)             a PUBLISHED Marketplace listing, showing only what it switches on
 *   app_public_create_booking(...)              one booking of source "Website" for a Service the site's business offers online
 *   app_public_asset(asset_id)                  where a business's CURRENT logo is stored (migration 0018), for the route that serves it
 *   app_public_domain(hostname)                 which PUBLISHED site an ACTIVE custom domain belongs to (migration 0020): its public identity only
 *   app_public_site_domain(platform_slug)       a published site's main active custom domain, for its canonical address (migration 0020)
 *   app_tls_eligible(hostname)                  may the proxy request a certificate for this name? true only for an ACTIVE claim of a PUBLISHED site (migration 0021)
 *   app_public_marketplace_search(...)          one page of discoverable providers for a search (migration 0025)
 *   app_public_marketplace_facets(...)          what there is to choose from, given what is chosen (migration 0025)
 *   app_public_marketplace_sitemap()            the pages a search engine may be told about (migration 0025)
 *   app_public_listing_booking(slug, service)   what the Marketplace booking page needs for one Service of one listing (migration 0025)
 *   app_public_create_marketplace_booking(...)  one booking of source "Marketplace" (migration 0025)
 *
 * The functions take a PUBLIC IDENTITY, find the owning organization themselves, and return a small projection built field by field. They
 * run as the runtime role with no tenant context: nothing here uses an organization id, and the runtime role has no more privilege than
 * before (the migration or admin connection is never used by a request). Whatever comes back is parsed and checked here again; a
 * projection that does not look right is treated as "not found".
 *
 * No `server-only` import on purpose (shared with the specs); nothing under src/ that is a Client Component may import this file.
 */
import { sql } from "drizzle-orm";
import type { PublicHost, PublicListingData, PublicNavPage, PublicPage, PublicReview, PublicServiceArea, PublicSite } from "@/data/public-site";
import { assetUrl } from "@/lib/asset-rules";
import { SERVICE_CATEGORIES, type BookingMethod, type IntakeQuestion, type Service, type ServiceCategory, type ServicePricing, type ServiceVisibility } from "@/data/services";
import type { BusinessInfo, WeeklyHours } from "@/data/settings";
import type { DiscoveryArea, DiscoveryFacets, DiscoveryResults, DiscoveryService, FacetCategory, FacetLocation, MarketplaceSitemap, ProviderCard } from "@/data/marketplace-discovery";
import { PAGE_TYPES, type PageType, type SectionModel, type VersionSettings } from "@/data/website";
import { DISCOVERY_PAGE_SIZE } from "@/lib/marketplace-discovery";
import { isSectionType, readProps } from "@/lib/site-sections";
import { readTheme } from "@/lib/site-theme";
import type { DateFormatId, TimeFormatId } from "@/lib/display-preferences";
import { getDb } from "./index";
import { weeklyHoursFromRows } from "./settings-mappers";

type Json = Record<string, unknown>;

/** A UUID in the form the database writes it. (Not db/tenant's `isUuid`: nothing on the public path imports the tenant-transaction module.) */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const PRICING_MODELS = ["diagnostic-fee", "fixed-price", "free-assessment"];
const BOOKING_METHODS: BookingMethod[] = ["instant", "request-appointment", "request-quote"];
const VISIBILITIES: ServiceVisibility[] = ["public-booking", "public-only", "internal"];
const DATE_FORMATS: DateFormatId[] = ["mdy-short", "mdy-numeric", "dmy-numeric", "ymd-iso"];

function intakeOf(value: unknown): IntakeQuestion[] {
  return list(value).flatMap((item): IntakeQuestion[] => {
    if (!isJson(item) || typeof item.id !== "string" || typeof item.prompt !== "string") return [];
    if (item.type !== "single-select" && item.type !== "photo-upload") return [];
    return [
      {
        id: item.id,
        prompt: item.prompt,
        type: item.type,
        required: item.required === true,
        options: Array.isArray(item.options) ? item.options.filter((option): option is string => typeof option === "string") : undefined,
        helper: typeof item.helper === "string" ? item.helper : undefined,
      },
    ];
  });
}

/** A Service's pricing from a projection's `pricingModel`, `priceAmount` and `priceLabel`. */
function pricingOf(model: string, raw: Json): ServicePricing {
  const amount = raw.priceAmount === null || raw.priceAmount === undefined ? 0 : Number(raw.priceAmount);
  return model === "free-assessment" ? { model: "free-assessment" } : model === "fixed-price" ? { model: "fixed-price", amount } : { model: "diagnostic-fee", amount, label: str(raw.priceLabel, "diagnostic fee") };
}

/** A public Service from the projection. Only the public fields exist in it, so only they are set. */
function serviceOf(raw: unknown): Service | undefined {
  if (!isJson(raw)) return undefined;
  const slug = str(raw.slug);
  const name = str(raw.name);
  const model = str(raw.pricingModel);
  const method = BOOKING_METHODS.find((candidate) => candidate === raw.bookingMethod);
  const visibility = VISIBILITIES.find((candidate) => candidate === raw.visibility);
  if (!slug || !name || !PRICING_MODELS.includes(model) || !method || !visibility || typeof raw.durationMinutes !== "number") return undefined;
  const pricing = pricingOf(model, raw);
  const category = SERVICE_CATEGORIES.find((candidate) => candidate === raw.category) ?? ("Maintenance" as ServiceCategory);
  return {
    id: slug,
    name,
    category,
    audience: ["residential"],
    description: str(raw.description),
    durationMinutes: raw.durationMinutes,
    pricing,
    bookingMethod: method,
    visibility,
    active: true,
    displayOrder: typeof raw.displayOrder === "number" ? raw.displayOrder : 0,
    intake: intakeOf(raw.intake),
  };
}

const servicesOf = (value: unknown): Service[] => list(value).map(serviceOf).filter((service): service is Service => service !== undefined);

function hoursOf(value: unknown) {
  return weeklyHoursFromRows(
    list(value).flatMap((item) =>
      isJson(item) && typeof item.day === "number"
        ? [{ dayOfWeek: item.day, isOpen: item.open === true, opensAt: typeof item.opensAt === "string" ? item.opensAt : null, closesAt: typeof item.closesAt === "string" ? item.closesAt : null }]
        : [],
    ),
  );
}

function businessOf(raw: Json): BusinessInfo {
  return {
    name: str(raw.name),
    phone: str(raw.phone),
    email: str(raw.email),
    address: { street: str(raw.street), city: str(raw.city), state: str(raw.state), postalCode: str(raw.postalCode) },
  };
}

/** The business's logo from a projection: its address on this site, or null. Only an id is in the projection; the address is built here. */
function logoOf(raw: unknown): { src: string } | null {
  return isJson(raw) && isUuid(raw.assetId) ? { src: assetUrl(raw.assetId) } : null;
}

function settingsOf(raw: unknown): VersionSettings {
  const display = isJson(raw) && isJson(raw.serviceDisplay) ? raw.serviceDisplay : {};
  const strings = (value: unknown) => list(value).filter((item): item is string => typeof item === "string");
  return { serviceDisplay: { order: strings(display.order), hidden: strings(display.hidden) } };
}

function pageTypeOf(value: unknown): PageType | undefined {
  return PAGE_TYPES.find((candidate) => candidate === value);
}

function navOf(value: unknown): PublicNavPage[] {
  return list(value).flatMap((item) => {
    const type = isJson(item) ? pageTypeOf(item.type) : undefined;
    return isJson(item) && type && typeof item.key === "string" && typeof item.title === "string" && typeof item.slug === "string"
      ? [{ key: item.key, title: item.title, slug: item.slug, type, sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : 0 }]
      : [];
  });
}

/**
 * A published site and one of its pages, by the site's public identity and the page's address ("" is the home page). Null when the site
 * does not exist or is not published. `page` is null when the site has no visible page at that address.
 */
export async function loadPublicSite(platformSlug: string, pageSlug: string): Promise<PublicSite | null> {
  const slug = platformSlug.trim().toLowerCase();
  if (slug === "" || slug.length > 63 || pageSlug.length > 120) return null;
  const result = await getDb().execute<{ site: unknown }>(sql`select app_public_site(${slug}, ${pageSlug}) as site`);
  const raw = result.rows[0]?.site;
  if (!isJson(raw) || !isJson(raw.site) || !isJson(raw.organization) || !isJson(raw.version)) return null;
  const organization = raw.organization;

  const nav = navOf(raw.pages);

  let page: PublicPage | null = null;
  if (isJson(raw.page)) {
    const type = pageTypeOf(raw.page.type);
    if (type && typeof raw.page.key === "string") {
      const pageKey = raw.page.key;
      const sections = list(raw.page.sections).flatMap((item): SectionModel[] => {
        // A section whose type this application does not know is not drawn.
        if (!isJson(item) || !isSectionType(item.type) || typeof item.key !== "string" || typeof item.variant !== "string") return [];
        return [
          {
            id: `${pageKey}.${item.key}`,
            key: item.key,
            label: str(item.label),
            type: item.type,
            variant: item.variant,
            props: readProps(item.type, item.variant, item.props),
            visible: true,
            sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : 0,
          },
        ];
      });
      page = { key: pageKey, title: str(raw.page.title), slug: str(raw.page.slug), type, sections: sections.sort((a, b) => a.sortOrder - b.sortOrder) };
    }
  }

  const dateFormat = DATE_FORMATS.find((candidate) => candidate === organization.dateFormat) ?? "mdy-short";
  const timeFormat: TimeFormatId = organization.timeFormat === "24h" ? "24h" : "12h";
  return {
    site: { id: "", name: str(raw.site.name), platformSlug: str(raw.site.platformSlug) },
    business: businessOf(organization),
    logo: logoOf(organization.logo),
    preferences: { timeZone: str(organization.timeZone), dateFormat, timeFormat },
    hours: hoursOf(raw.hours),
    fixedClock: raw.fixedClock === true,
    version: {
      number: typeof raw.version.number === "number" ? raw.version.number : 0,
      theme: readTheme(raw.version.theme),
      settings: settingsOf(raw.version.settings),
      publishedAt: str(raw.version.publishedAt),
    },
    nav: nav.sort((a, b) => a.sortOrder - b.sortOrder),
    page,
    services: servicesOf(raw.services),
  };
}

/** A published Marketplace listing by its public identity, with only what it shows. Null unless it is published. */
export async function loadPublicListing(publicSlug: string): Promise<PublicListingData | null> {
  const slug = publicSlug.trim().toLowerCase();
  if (slug === "" || slug.length > 63) return null;
  const result = await getDb().execute<{ listing: unknown }>(sql`select app_public_listing(${slug}) as listing`);
  const raw = result.rows[0]?.listing;
  if (!isJson(raw) || !isJson(raw.listing) || !isJson(raw.organization)) return null;
  const listing = raw.listing;
  const flags = (value: unknown, keys: string[]) => Object.fromEntries(keys.map((key) => [key, isJson(value) && value[key] === true]));
  const cover = listing.cover === "teal-horizon" || listing.cover === "warm-linen" || listing.cover === "cool-slate" ? listing.cover : null;
  return {
    slug: str(listing.publicSlug),
    description: str(listing.description),
    cover,
    contact: flags(listing.contact, ["phone", "email", "address", "hours", "website"]) as PublicListingData["contact"],
    actions: flags(listing.actions, ["book", "website", "contact"]) as PublicListingData["actions"],
    business: businessOf(raw.organization),
    logo: logoOf(raw.organization.logo),
    hours: hoursOf(raw.hours),
    timeFormat: raw.organization.timeFormat === "24h" ? "24h" : "12h",
    siteSlug: typeof raw.siteSlug === "string" ? raw.siteSlug : null,
    sitePages: navOf(raw.sitePages),
    services: servicesOf(raw.services),
    serviceAreas: list(raw.serviceAreas).flatMap((item): PublicServiceArea[] =>
      isJson(item) && typeof item.display === "string" && typeof item.slug === "string" && (item.kind === "city" || item.kind === "postal") ? [{ display: item.display, kind: item.kind, slug: item.slug }] : [],
    ),
    rating: ratingOf(raw.rating),
    reviews: list(raw.reviews).flatMap((item): PublicReview[] =>
      isJson(item) && typeof item.rating === "number" && item.rating >= 1 && item.rating <= 5 && typeof item.text === "string" && typeof item.date === "string" && typeof item.reviewer === "string"
        ? [{ rating: item.rating, text: item.text, date: item.date, reviewer: item.reviewer }]
        : [],
    ),
  };
}

/** A public rating from a projection: an average between 1 and 5 and a count of at least one, or null. */
function ratingOf(raw: unknown): { average: number; count: number } | null {
  if (!isJson(raw)) return null;
  const average = Number(raw.average);
  const count = Number(raw.count);
  return Number.isFinite(average) && average >= 1 && average <= 5 && Number.isInteger(count) && count >= 1 ? { average, count } : null;
}

/** Where the bytes of a public logo are and what they are: the answer of `app_public_asset`, which exists only for a ready logo that is a business's current one. */
export type PublicAsset = { storageDriver: "local" | "s3"; storageKey: string; mediaType: string; byteSize: number; checksum: string };

export async function loadPublicAsset(assetId: string): Promise<PublicAsset | null> {
  if (!isUuid(assetId)) return null;
  const result = await getDb().execute<{ asset: unknown }>(sql`select app_public_asset(${assetId}::uuid) as asset`);
  const raw = result.rows[0]?.asset;
  if (!isJson(raw)) return null;
  const { storageDriver, storageKey, mediaType, byteSize, checksum } = raw;
  if ((storageDriver !== "local" && storageDriver !== "s3") || typeof storageKey !== "string" || typeof mediaType !== "string") return null;
  if (typeof byteSize !== "number" || typeof checksum !== "string") return null;
  return { storageDriver, storageKey, mediaType, byteSize, checksum };
}

/**
 * The published Site an ACTIVE custom domain belongs to, or null (unknown, not active, or its site is not published: all the same). The name
 * must already be normalized (lib/hostname); this passes it through untouched, so a spelling that is not stored finds nothing.
 */
export async function loadPublicHost(hostname: string): Promise<PublicHost | null> {
  if (typeof hostname !== "string" || hostname.length === 0 || hostname.length > 231) return null;
  const result = await getDb().execute<{ host: unknown }>(sql`select app_public_domain(${hostname}) as host`);
  const raw = result.rows[0]?.host;
  if (!isJson(raw) || typeof raw.platformSlug !== "string" || typeof raw.canonicalHost !== "string") return null;
  return { platformSlug: raw.platformSlug, canonicalHost: raw.canonicalHost };
}

/**
 * May a certificate be requested for this name? True only for the exact normalized name of an ACTIVE claim whose Site is PUBLISHED. The answer is
 * a yes or a no and nothing else, and no DNS is asked: it is what the reverse proxy needs before it obtains a certificate on demand.
 */
export async function isTlsEligible(hostname: string): Promise<boolean> {
  if (typeof hostname !== "string" || hostname.length === 0 || hostname.length > 231) return false;
  const result = await getDb().execute<{ eligible: unknown }>(sql`select app_tls_eligible(${hostname}) as eligible`);
  return result.rows[0]?.eligible === true;
}

/** A published site's main ACTIVE custom domain, or null. */
export async function loadPublicSiteDomain(platformSlug: string): Promise<string | null> {
  if (typeof platformSlug !== "string" || platformSlug.length === 0 || platformSlug.length > 63) return null;
  const result = await getDb().execute<{ host: unknown }>(sql`select app_public_site_domain(${platformSlug}) as host`);
  const raw = result.rows[0]?.host;
  return typeof raw === "string" ? raw : null;
}

export type PublicBookingInput = {
  platformSlug: string;
  serviceSlug: string;
  submissionKey: string;
  date: string;
  start: string;
  end: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  note?: string;
  systemType?: string;
  reportedIssue?: string;
  /** When the request arrived, on the business's clock. */
  receivedAt: Date;
};

export type PublicBookingResult =
  | { ok: true; number: number; status: "pending" | "confirmed"; duplicate: boolean }
  | { ok: false; reason: "site" | "service" | "details" | "unknown" };

/** Make the booking. The organization is the SITE's, found inside the function; nothing here names one. */
export async function createPublicBooking(input: PublicBookingInput): Promise<PublicBookingResult> {
  const result = await getDb().execute<{ booking: unknown }>(
    sql`select app_public_create_booking(
      ${input.platformSlug}, ${input.serviceSlug}, ${input.submissionKey}, ${input.date}::date, ${input.start}::time, ${input.end}::time,
      ${input.name}, ${input.phone}, ${input.email}, ${input.address}, ${input.note ?? null}, ${input.systemType ?? null}, ${input.reportedIssue ?? null},
      ${input.receivedAt.toISOString()}::timestamptz
    ) as booking`,
  );
  const raw = result.rows[0]?.booking;
  if (!isJson(raw)) return { ok: false, reason: "unknown" };
  if (raw.ok === true && typeof raw.number === "number" && (raw.status === "pending" || raw.status === "confirmed")) {
    return { ok: true, number: raw.number, status: raw.status, duplicate: raw.duplicate === true };
  }
  const reason = raw.reason === "site" || raw.reason === "service" || raw.reason === "details" ? raw.reason : "unknown";
  return { ok: false, reason };
}

/* ───────────────────────── Marketplace discovery ───────────────────────── */

/** What a visitor has chosen, already read and bounded by lib/marketplace-discovery (and checked again by the database). */
export type DiscoveryFilters = {
  tokens: readonly string[];
  service: string | null;
  location: string | null;
  booking: BookingMethod | null;
  category: ServiceCategory | null;
};

/** A list of words as a SQL text[] (a JavaScript array would otherwise become a row of parameters). */
const textArray = (values: readonly string[]) => (values.length === 0 ? sql`'{}'::text[]` : sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`);

const count = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

function discoveryServiceOf(raw: unknown): DiscoveryService | null {
  if (!isJson(raw)) return null;
  const method = BOOKING_METHODS.find((candidate) => candidate === raw.bookingMethod);
  const category = SERVICE_CATEGORIES.find((candidate) => candidate === raw.category);
  const model = str(raw.pricingModel);
  if (!str(raw.slug) || !str(raw.name) || !method || !category || !PRICING_MODELS.includes(model) || typeof raw.durationMinutes !== "number") return null;
  return { slug: str(raw.slug), name: str(raw.name), category, pricing: pricingOf(model, raw), bookingMethod: method, durationMinutes: raw.durationMinutes };
}

function cardOf(raw: unknown): ProviderCard | undefined {
  if (!isJson(raw) || !str(raw.slug) || !str(raw.name)) return undefined;
  const areas = list(raw.areas).flatMap((item): DiscoveryArea[] => (isJson(item) && str(item.display) && str(item.slug) ? [{ display: str(item.display), slug: str(item.slug) }] : []));
  return {
    slug: str(raw.slug),
    name: str(raw.name),
    description: str(raw.description),
    logo: logoOf(raw.logo),
    rating: ratingOf(raw.rating),
    service: discoveryServiceOf(raw.service),
    serviceCount: count(raw.serviceCount),
    categories: list(raw.categories).filter((item): item is ServiceCategory => SERVICE_CATEGORIES.some((category) => category === item)),
    areas,
    areaCount: count(raw.areaCount),
    canBook: raw.canBook === true,
  };
}

/** One page of the providers a search matches, ranked, with the total. Nothing about an organization is in it. */
export async function loadMarketplaceResults(filters: DiscoveryFilters, page: number): Promise<DiscoveryResults> {
  const result = await getDb().execute<{ results: unknown }>(
    sql`select app_public_marketplace_search(${textArray(filters.tokens)}, ${filters.service}, ${filters.location}, ${filters.booking}, ${filters.category}, ${page}, ${DISCOVERY_PAGE_SIZE}) as results`,
  );
  const raw = result.rows[0]?.results;
  if (!isJson(raw)) return { total: 0, page: 1, pageSize: DISCOVERY_PAGE_SIZE, results: [] };
  return {
    total: count(raw.total),
    page: Math.max(count(raw.page), 1),
    pageSize: Math.max(count(raw.pageSize), 1),
    results: list(raw.results).map(cardOf).filter((card): card is ProviderCard => card !== undefined),
  };
}

/** What there is to choose from, given what has been chosen. */
export async function loadMarketplaceFacets(filters: DiscoveryFilters): Promise<DiscoveryFacets> {
  const result = await getDb().execute<{ facets: unknown }>(
    sql`select app_public_marketplace_facets(${textArray(filters.tokens)}, ${filters.service}, ${filters.location}, ${filters.booking}, ${filters.category}) as facets`,
  );
  const raw = result.rows[0]?.facets;
  const facets: DiscoveryFacets = { services: [], locations: [], categories: [], bookingModes: [] };
  if (!isJson(raw)) return facets;
  facets.services = list(raw.services).flatMap((item) => (isJson(item) && str(item.slug) && str(item.name) ? [{ slug: str(item.slug), name: str(item.name), providers: count(item.providers) }] : []));
  facets.locations = list(raw.locations).flatMap((item): FacetLocation[] =>
    isJson(item) && str(item.slug) && str(item.label) && (item.kind === "city" || item.kind === "postal") ? [{ slug: str(item.slug), kind: item.kind, label: str(item.label), providers: count(item.providers) }] : [],
  );
  facets.categories = list(raw.categories).flatMap((item): FacetCategory[] => {
    const name = isJson(item) ? SERVICE_CATEGORIES.find((category) => category === item.name) : undefined;
    return isJson(item) && name ? [{ name, providers: count(item.providers) }] : [];
  });
  facets.bookingModes = list(raw.bookingModes).flatMap((item) => {
    const mode = isJson(item) ? BOOKING_METHODS.find((candidate) => candidate === item.mode) : undefined;
    return isJson(item) && mode ? [{ mode, providers: count(item.providers) }] : [];
  });
  return facets;
}

/** The pages a search engine may be told about. Each has at least one discoverable provider; a suspended or unpublished one is in none. */
export async function loadMarketplaceSitemap(): Promise<MarketplaceSitemap> {
  const result = await getDb().execute<{ map: unknown }>(sql`select app_public_marketplace_sitemap() as map`);
  const raw = result.rows[0]?.map;
  const map: MarketplaceSitemap = { listings: [], services: [], locations: [], combinations: [] };
  if (!isJson(raw)) return map;
  map.listings = list(raw.listings).flatMap((item) => (isJson(item) && str(item.slug) ? [{ slug: str(item.slug), updatedAt: str(item.updatedAt) }] : []));
  map.services = list(raw.services).filter((item): item is string => typeof item === "string" && item !== "");
  map.locations = list(raw.locations).filter((item): item is string => typeof item === "string" && item !== "");
  map.combinations = list(raw.combinations).flatMap((item) => (isJson(item) && str(item.service) && str(item.location) ? [{ service: str(item.service), location: str(item.location) }] : []));
  return map;
}

/** Everything the Marketplace booking page and action need for one Service of one listing. */
export type MarketplaceBookingContext = {
  listingSlug: string;
  business: { name: string; phone: string };
  logo: { src: string } | null;
  hours: WeeklyHours;
  preferences: { timeZone: string; dateFormat: DateFormatId; timeFormat: TimeFormatId };
  fixedClock: boolean;
  service: Service;
};

/**
 * The booking context for one Service of a listing, or null (unknown, not published, suspended, no online booking, or a Service the listing does not
 * show and the business does not offer for online booking: all the same). The business's phone is empty when its listing does not show it.
 */
export async function loadMarketplaceBooking(listingSlug: string, serviceSlug: string): Promise<MarketplaceBookingContext | null> {
  const listing = listingSlug.trim().toLowerCase();
  if (listing === "" || listing.length > 63 || serviceSlug === "" || serviceSlug.length > 80) return null;
  const result = await getDb().execute<{ context: unknown }>(sql`select app_public_listing_booking(${listing}, ${serviceSlug}) as context`);
  const raw = result.rows[0]?.context;
  if (!isJson(raw) || !isJson(raw.listing) || !isJson(raw.organization)) return null;
  const service = serviceOf(raw.service);
  if (!service) return null;
  const organization = raw.organization;
  return {
    listingSlug: str(raw.listing.publicSlug),
    business: { name: str(organization.name), phone: str(organization.phone) },
    logo: logoOf(organization.logo),
    hours: hoursOf(raw.hours),
    preferences: {
      timeZone: str(organization.timeZone),
      dateFormat: DATE_FORMATS.find((candidate) => candidate === organization.dateFormat) ?? "mdy-short",
      timeFormat: organization.timeFormat === "24h" ? "24h" : "12h",
    },
    fixedClock: raw.fixedClock === true,
    service,
  };
}

export type MarketplaceBookingInput = Omit<PublicBookingInput, "platformSlug"> & {
  listingSlug: string;
  /** What the visitor was looking at (addresses from the results page they came from); informational only. */
  discoveryService?: string;
  discoveryLocation?: string;
};

export type MarketplaceBookingResult =
  | { ok: true; number: number; status: "pending" | "confirmed"; duplicate: boolean }
  | { ok: false; reason: "listing" | "service" | "details" | "unknown" };

/** Make the booking. The business and the Service are found inside the function from the LISTING's public identity; nothing here names an organization. */
export async function createMarketplaceBooking(input: MarketplaceBookingInput): Promise<MarketplaceBookingResult> {
  const result = await getDb().execute<{ booking: unknown }>(
    sql`select app_public_create_marketplace_booking(
      ${input.listingSlug}, ${input.serviceSlug}, ${input.submissionKey}, ${input.date}::date, ${input.start}::time, ${input.end}::time,
      ${input.name}, ${input.phone}, ${input.email}, ${input.address}, ${input.note ?? null}, ${input.systemType ?? null}, ${input.reportedIssue ?? null},
      ${input.discoveryService ?? null}, ${input.discoveryLocation ?? null}, ${input.receivedAt.toISOString()}::timestamptz
    ) as booking`,
  );
  const raw = result.rows[0]?.booking;
  if (!isJson(raw)) return { ok: false, reason: "unknown" };
  if (raw.ok === true && typeof raw.number === "number" && (raw.status === "pending" || raw.status === "confirmed")) {
    return { ok: true, number: raw.number, status: raw.status, duplicate: raw.duplicate === true };
  }
  const reason = raw.reason === "listing" || raw.reason === "service" || raw.reason === "details" ? raw.reason : "unknown";
  return { ok: false, reason };
}
