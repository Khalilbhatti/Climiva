/**
 * The PUBLIC read and write paths: what a visitor without a session can reach.
 *
 * A visitor has no session, no membership and no organization, so none of the tenant queries (which run inside `withTenant`, under Row
 * Level Security) apply to them. They go through six SQL functions (migrations 0013, 0018 and 0020), which are the only place a request with no
 * membership touches tenant rows:
 *
 *   app_public_site(platform_slug, page_slug)   a PUBLISHED site as a visitor sees it
 *   app_public_listing(public_slug)             a PUBLISHED Marketplace listing, showing only what it switches on
 *   app_public_create_booking(...)              one booking of source "Website" for a Service the site's business offers online
 *   app_public_asset(asset_id)                  where a business's CURRENT logo is stored (migration 0018), for the route that serves it
 *   app_public_domain(hostname)                 which PUBLISHED site an ACTIVE custom domain belongs to (migration 0020): its public identity only
 *   app_public_site_domain(platform_slug)       a published site's main active custom domain, for its canonical address (migration 0020)
 *
 * The functions take a PUBLIC IDENTITY, find the owning organization themselves, and return a small projection built field by field. They
 * run as the runtime role with no tenant context: nothing here uses an organization id, and the runtime role has no more privilege than
 * before (the migration or admin connection is never used by a request). Whatever comes back is parsed and checked here again; a
 * projection that does not look right is treated as "not found".
 *
 * No `server-only` import on purpose (shared with the specs); nothing under src/ that is a Client Component may import this file.
 */
import { sql } from "drizzle-orm";
import type { PublicHost, PublicListingData, PublicNavPage, PublicPage, PublicSite } from "@/data/public-site";
import { assetUrl } from "@/lib/asset-rules";
import { SERVICE_CATEGORIES, type BookingMethod, type IntakeQuestion, type Service, type ServiceCategory, type ServicePricing, type ServiceVisibility } from "@/data/services";
import type { BusinessInfo } from "@/data/settings";
import { PAGE_TYPES, type PageType, type SectionModel, type VersionSettings } from "@/data/website";
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

/** A public Service from the projection. Only the public fields exist in it, so only they are set. */
function serviceOf(raw: unknown): Service | undefined {
  if (!isJson(raw)) return undefined;
  const slug = str(raw.slug);
  const name = str(raw.name);
  const model = str(raw.pricingModel);
  const method = BOOKING_METHODS.find((candidate) => candidate === raw.bookingMethod);
  const visibility = VISIBILITIES.find((candidate) => candidate === raw.visibility);
  if (!slug || !name || !PRICING_MODELS.includes(model) || !method || !visibility || typeof raw.durationMinutes !== "number") return undefined;
  const amount = raw.priceAmount === null || raw.priceAmount === undefined ? 0 : Number(raw.priceAmount);
  const pricing: ServicePricing =
    model === "free-assessment" ? { model: "free-assessment" } : model === "fixed-price" ? { model: "fixed-price", amount } : { model: "diagnostic-fee", amount, label: str(raw.priceLabel, "diagnostic fee") };
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
  };
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
