/**
 * Marketplace discovery: how a business says where it works, and how a visitor says what they need and where.
 *
 * Everything here is pure and deterministic (no database, no framework, no locale libraries): the Server Actions use it to check what a
 * business stores, the public routes use it to read a visitor's search, and the specs use it directly. The SQL side (migration 0025) has its own
 * matching rules for the same keys, and `marketplace-discovery-rules.spec.ts` holds the two to each other, so a city spelled two ways is one place.
 *
 * Coverage model. A service area is ONE of:
 *   - a city (city + state), "Austin, TX": matches a visitor looking for that city, in that state, and
 *   - a postal code (a five-digit US ZIP), "78704": matches a visitor looking for that ZIP.
 * Either may carry a display label. A business's headquarters address is NOT coverage: only what a business lists here is claimed. Matching is
 * exact on the normalized keys below; there is no radius. The seam for one later is the `kind` of an area (a "radius" kind with a centre and a
 * distance would sit next to "city" and "postal", and the one SQL function that decides whether an area matches a search is the only place that
 * would learn it).
 */
import type { AppHref } from "@/config/routes";
import type { ServiceArea } from "@/data/marketplace";
import { US_STATES } from "@/data/settings";
import { SERVICE_CATEGORIES, type BookingMethod, type ServiceCategory } from "@/data/services";
import { textProblem } from "./site-sections";
import { isRecord, type Parsed } from "./validation";

/** Providers per results page. */
export const DISCOVERY_PAGE_SIZE = 12;
/** Pages beyond this are not served (the results are bounded on purpose). */
export const DISCOVERY_MAX_PAGE = 100;
/** Service areas one listing may list. */
export const AREA_LIMIT = 50;
/** Words of a search that are used; any further words are ignored. */
export const MAX_TOKENS = 8;

export const BOOKING_MODES: readonly BookingMethod[] = ["instant", "request-appointment", "request-quote"];

/** The URL form of each Service category. */
export const CATEGORY_SLUG: Record<ServiceCategory, string> = {
  Cooling: "cooling",
  Heating: "heating",
  "Heat pumps": "heat-pumps",
  Maintenance: "maintenance",
  Emergency: "emergency",
};
export const categoryOfSlug = (slug: string): ServiceCategory | undefined => SERVICE_CATEGORIES.find((category) => CATEGORY_SLUG[category] === slug);

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const US_STATE_CODES: readonly string[] = US_STATES;

const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", [["north", "carolina"].join(" ")]: "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

/* ───────────────────────── what a business stores ───────────────────────── */

const CITY = /^[A-Za-z][A-Za-z .'-]{1,59}$/;
const LABEL_MAX = 60;

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");

/** "  aUSTIN  " is not fixed, "austin" and "AUSTIN" become "Austin": a name typed in one case is title-cased, a name with mixed case is kept as typed. */
function titleCase(value: string): string {
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/(^|[ '-])([a-z])/g, (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

/** A city's display name, or undefined when it is not a plausible one (letters, spaces, apostrophes, periods and hyphens; 2 to 60 characters). */
export function normalizeCity(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const city = collapse(input);
  if (!CITY.test(city)) return undefined;
  return titleCase(city);
}

/**
 * The matching key of a city: lower case, apostrophes and periods dropped, hyphens and runs of spaces as one space. "St. Louis", "st louis" and
 * "ST LOUIS" are one key. (The same rule is a generated column in the database, so every writer agrees.)
 */
export function cityKey(city: string): string {
  return city.toLowerCase().replace(/[.']/g, "").replace(/[-\s]+/g, " ").trim();
}

/** A US state as its two-letter code, from a code or a name, or undefined. */
export function normalizeState(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = collapse(input);
  const code = value.toUpperCase();
  if (US_STATE_CODES.includes(code)) return code;
  return US_STATE_NAMES[value.toLowerCase()];
}

/** A US ZIP as five digits (ZIP+4 is cut to its ZIP), or undefined. */
export function normalizePostal(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const match = /^(\d{5})(?:-\d{4})?$/.exec(input.trim());
  return match?.[1];
}

/** What an area is called on a card: its label, else "City, ST" or the ZIP. */
export function areaDisplay(area: ServiceArea): string {
  return area.label ?? (area.city ? `${area.city}, ${area.state}` : (area.postal ?? ""));
}

/** One area's identity, for refusing a duplicate: the same place is one area however it was typed. */
export function areaKey(area: ServiceArea): string {
  return area.city ? `city:${cityKey(area.city)}:${area.state}` : `postal:${area.postal}`;
}

/** The address of an area on the public pages: "austin-tx" for a city, "78704" for a ZIP. */
export function areaSlug(area: ServiceArea): string {
  return area.city ? locationSlug(area.city, area.state ?? "") : (area.postal ?? "");
}

export function locationSlug(city: string, state: string): string {
  return `${cityKey(city).replace(/ /g, "-")}-${state.toLowerCase()}`;
}

const AREA_KEYS = ["city", "state", "postal", "label"] as const;

/** The service areas of a listing from a request: a bounded list, each one a city and state or a ZIP, no place twice, plain-text labels. */
export function parseAreas(input: unknown): Parsed<ServiceArea[]> {
  const bad = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });
  if (!Array.isArray(input)) return bad("The service areas were not understood.");
  if (input.length > AREA_LIMIT) return bad(`A listing can list up to ${AREA_LIMIT} service areas.`, { areas: `A listing can list up to ${AREA_LIMIT} service areas.` });
  const areas: ServiceArea[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.entries()) {
    if (!isRecord(item) || !Object.keys(item).every((key) => (AREA_KEYS as readonly string[]).includes(key))) return bad("The service areas were not understood.");
    const hasCity = typeof item.city === "string" && item.city.trim() !== "";
    const hasPostal = typeof item.postal === "string" && item.postal.trim() !== "";
    const where = `Service area ${index + 1}`;
    if (hasCity === hasPostal) {
      const message = `${where}: enter either a city and state, or a ZIP code.`;
      return bad(message, { areas: message });
    }
    let label: string | null = null;
    if (item.label !== undefined && item.label !== null && item.label !== "") {
      const trimmed = typeof item.label === "string" ? collapse(item.label) : "";
      const problem = trimmed === "" || trimmed.length > LABEL_MAX ? `${where}: keep the name to ${LABEL_MAX} characters or fewer.` : trimmed.includes("{{") ? "Use plain text. Double braces are not allowed." : textProblem(trimmed);
      if (problem) return bad(problem, { areas: problem });
      label = trimmed;
    }
    let area: ServiceArea;
    if (hasCity) {
      const city = normalizeCity(item.city);
      const state = normalizeState(item.state);
      if (!city) {
        const message = `${where}: enter a city name using letters, spaces, apostrophes, periods or hyphens.`;
        return bad(message, { areas: message });
      }
      if (!state || (item.postal !== undefined && item.postal !== null && item.postal !== "")) {
        const message = `${where}: choose a US state for the city.`;
        return bad(message, { areas: message });
      }
      area = { city, state, postal: null, label };
    } else {
      const postal = normalizePostal(item.postal);
      if (!postal || (item.city !== undefined && item.city !== null && item.city !== "") || (item.state !== undefined && item.state !== null && item.state !== "")) {
        const message = `${where}: enter a five-digit US ZIP code.`;
        return bad(message, { areas: message });
      }
      area = { city: null, state: null, postal, label };
    }
    const key = areaKey(area);
    if (seen.has(key)) {
      const message = `${where}: ${areaDisplay(area)} is already listed.`;
      return bad(message, { areas: message });
    }
    seen.add(key);
    areas.push(area);
  }
  return { ok: true, value: areas };
}

/* ───────────────────────── what a visitor asks for ───────────────────────── */

const STOP_WORDS = new Set(["in", "near", "for", "the", "a", "an", "of", "and", "to", "my", "me", "around", "service", "services"]);

/** The words of a search: lower case, letters and digits only, no filler, no repeats, at most eight, none longer than 40 characters. */
export function tokenize(query: string): string[] {
  const words = query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ");
  const tokens: string[] = [];
  for (const word of words) {
    if (word === "" || word.length > 40 || STOP_WORDS.has(word) || tokens.includes(word)) continue;
    tokens.push(word);
    if (tokens.length === MAX_TOKENS) break;
  }
  return tokens;
}

/**
 * Where a visitor says they want service, as the address form the database matches: a ZIP ("78704"), a city and state ("austin-tx") or a city on its
 * own ("austin"). "Austin, TX", "austin tx", "Austin, Texas" and "78704-1234" are all understood. Anything else is not a place.
 */
export function locationFromText(text: string): string | undefined {
  const raw = collapse(text);
  if (raw === "" || raw.length > 80) return undefined;
  const postal = normalizePostal(raw);
  if (postal) return postal;
  if (/^\d/.test(raw)) return undefined;
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  let cityText = raw;
  let state: string | undefined;
  if (parts.length === 2) {
    cityText = parts[0];
    state = normalizeState(parts[1]);
    if (!state) return undefined;
  } else if (parts.length > 2) {
    return undefined;
  } else {
    // "austin tx", "salt lake city utah": a state at the end, as a code or a name of one or two words.
    const words = raw.split(" ");
    for (const take of [2, 1]) {
      if (words.length <= take) continue;
      const candidate = normalizeState(words.slice(-take).join(" "));
      if (candidate) {
        state = candidate;
        cityText = words.slice(0, -take).join(" ");
        break;
      }
    }
  }
  const city = normalizeCity(cityText);
  if (!city) return undefined;
  const key = cityKey(city).replace(/ /g, "-");
  if (key === "" || !SLUG.test(key)) return undefined;
  return state ? `${key}-${state.toLowerCase()}` : key;
}

/** A location address read back: a ZIP, a city and state, or a city; undefined when it is none of these. */
export function parseLocationSlug(slug: string): { kind: "postal"; postal: string } | { kind: "city"; cityKey: string; state: string | null } | undefined {
  if (/^\d{5}$/.test(slug)) return { kind: "postal", postal: slug };
  if (!SLUG.test(slug) || slug.length > 80 || /^\d/.test(slug)) return undefined;
  const withState = /^(.+)-([a-z]{2})$/.exec(slug);
  if (withState && US_STATE_CODES.includes(withState[2].toUpperCase())) return { kind: "city", cityKey: withState[1].replace(/-/g, " "), state: withState[2].toUpperCase() };
  return { kind: "city", cityKey: slug.replace(/-/g, " "), state: null };
}

/** A place for people to read: "78704", "Austin, TX" or "Austin" from the address form of a location. */
export function locationLabel(slug: string, knownCity?: string): string {
  const parsed = parseLocationSlug(slug);
  if (!parsed) return slug;
  if (parsed.kind === "postal") return parsed.postal;
  const city = knownCity ?? titleCase(parsed.cityKey);
  return parsed.state ? `${city}, ${parsed.state}` : city;
}

/** What a visitor has asked the Marketplace for, after every part of it has been read and bounded. */
export type DiscoveryQuery = {
  /** The free-text box as typed (kept to show back), and its words. */
  q: string;
  tokens: string[];
  /** The Service a visitor chose: a Service's address ("ac-repair-diagnostics"). */
  service: string | null;
  /** The place as typed (to show back), and as an address ("austin-tx") when it was understood. */
  locationText: string;
  location: string | null;
  booking: BookingMethod | null;
  category: ServiceCategory | null;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/** Read a results page's query string. Anything that does not fit is ignored, never an error: a malformed link shows the page it can. */
export function readDiscoveryQuery(params: Params): DiscoveryQuery {
  const q = collapse(first(params.q)).slice(0, 100);
  const service = first(params.service);
  const locationText = collapse(first(params.location)).slice(0, 80);
  const booking = BOOKING_MODES.find((mode) => mode === first(params.booking)) ?? null;
  const category = categoryOfSlug(first(params.category)) ?? null;
  const page = /^\d{1,3}$/.test(first(params.page)) ? Math.min(Math.max(Number(first(params.page)), 1), DISCOVERY_MAX_PAGE) : 1;
  return {
    q,
    tokens: tokenize(q),
    service: SLUG.test(service) && service.length <= 80 ? service : null,
    locationText,
    location: locationText === "" ? null : (locationFromText(locationText) ?? null),
    booking,
    category,
    page,
  };
}

/** The address of a results page for a query (the path part is the clean form when only a Service and/or a place are chosen). */
export function discoveryHref(query: Partial<Pick<DiscoveryQuery, "q" | "service" | "location" | "locationText" | "booking" | "category" | "page">>): AppHref {
  const plain = !query.q && !query.booking && !query.category;
  let path = "/marketplace";
  if (plain && query.service && query.location) path = `/marketplace/services/${query.service}/${query.location}`;
  else if (plain && query.service) path = `/marketplace/services/${query.service}`;
  else if (plain && query.location) path = `/marketplace/locations/${query.location}`;
  const search = new URLSearchParams();
  // On the clean pages the Service and the place are in the path; on /marketplace they are in the query, with everything else. A place in the
  // query is written the way a person writes it ("Austin, TX"), which is what the page reads back.
  if (path === "/marketplace") {
    if (query.q) search.set("q", query.q);
    if (query.service) search.set("service", query.service);
    const place = query.locationText || (query.location ? locationLabel(query.location) : "");
    if (place) search.set("location", place);
    if (query.booking) search.set("booking", query.booking);
    if (query.category) search.set("category", CATEGORY_SLUG[query.category]);
  }
  if (query.page && query.page > 1) search.set("page", String(query.page));
  const qs = search.toString();
  return (qs ? `${path}?${qs}` : path) as AppHref;
}

/** Where a visitor was when they chose a provider: the Service and the place they were looking at, as addresses. Carried to the profile and the booking page. */
export type DiscoveryContext = { service?: string | null; location?: string | null };

const contextQuery = (context?: DiscoveryContext) => {
  const search = new URLSearchParams();
  if (context?.service && SLUG.test(context.service) && context.service.length <= 80) search.set("service", context.service);
  if (context?.location && SLUG.test(context.location) && context.location.length <= 80) search.set("location", context.location);
  const qs = search.toString();
  return qs ? `?${qs}` : "";
};

/** A provider's profile. The context is only so that a booking made from it can say what the visitor was looking for. */
export const profileHref = (listingSlug: string, context?: DiscoveryContext): AppHref => `/listings/${listingSlug}${contextQuery(context)}` as AppHref;

/** The Marketplace booking page of one of a provider's Services. */
export const bookingHref = (listingSlug: string, serviceSlug: string, context?: DiscoveryContext): AppHref => `/listings/${listingSlug}/book/${serviceSlug}${contextQuery(context)}` as AppHref;

/** The discovery context carried on a profile or booking address; anything that is not an address is dropped. */
export function readDiscoveryContext(params: Params): DiscoveryContext {
  const service = first(params.service);
  const location = first(params.location);
  return {
    service: SLUG.test(service) && service.length <= 80 ? service : null,
    location: SLUG.test(location) && location.length <= 80 ? location : null,
  };
}

/**
 * The query of a clean page (/marketplace/services/<service>, /marketplace/locations/<place>, or both): the Service and the place come from the
 * path, and only the page number is read from the query string. Undefined when either part of the path is not an address, which is a "not found".
 */
export function pathQuery(params: Params, path: { service?: string; location?: string }): DiscoveryQuery | undefined {
  if (path.service !== undefined && !(SLUG.test(path.service) && path.service.length <= 80)) return undefined;
  if (path.location !== undefined && !parseLocationSlug(path.location)) return undefined;
  return { ...readDiscoveryQuery({ page: params.page }), service: path.service ?? null, location: path.location ?? null };
}

/**
 * Where a /marketplace address should really be, when it is not there: a search that only names a Service and/or a place has a clean page of its
 * own, and a query string with empty values is tidied. Null when the address is already the right one.
 */
export function tidyAddress(params: Params, query: DiscoveryQuery): AppHref | null {
  const placeOk = query.locationText === "" || query.location !== null;
  if (!query.q && !query.booking && !query.category && (query.service || query.location) && placeOk) return discoveryHref(query);
  if (["q", "service", "location", "booking", "category", "page"].some((key) => params[key] === "")) return discoveryHref(query);
  return null;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A review's date as a visitor reads it: "Oct 25, 2024" from "2024-10-25". The same on every page and for every visitor (no clock, no locale). */
export function reviewDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? `${MONTHS_SHORT[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : date;
}
