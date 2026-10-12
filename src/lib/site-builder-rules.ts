/**
 * The rules of a Site's structure that the Website Builder and the server share: which pages are structural, which sections a kind of page
 * must keep, which addresses a page may not take, and how names and addresses are made safe and unique.
 *
 * The Builder enforces them to explain itself (a disabled control says why); the server enforces them again, on every save and every
 * publish, because a request does not have to come from the Builder (`validateContent` in lib/site-template calls into this file).
 *
 * Pure: no database, no framework.
 */
import type { PageType } from "@/data/website";
import type { SectionType } from "./site-sections";

/** What a person sees when their copy of the Draft is older than the stored one. Compared by the screens, so it lives in one place. */
export const STALE_DRAFT = "This website was changed somewhere else after you opened it, so your changes were not saved. Reload to see the latest version.";

/**
 * Addresses a page may not take. A published page is served at `<site address>/<slug>`; these are the names the platform and the future
 * domain routing keep for themselves, so an authored page can never hijack one when a site gets its own host name.
 */
export const RESERVED_PAGE_SLUGS = [
  "api",
  "admin",
  "app",
  "assets",
  "auth",
  "favicon",
  "listings",
  "login",
  "logout",
  "marketplace",
  "onboarding",
  "robots",
  "settings",
  "signup",
  "sitemap",
  "sites",
  "static",
  "website",
  "_next",
] as const;

export const isReservedSlug = (slug: string): boolean => (RESERVED_PAGE_SLUGS as readonly string[]).includes(slug);

/** What each kind of page may and may not become. The home page and the booking page are structural: the rest of the site leads to them. */
export type PageRule = {
  /** Whether the page can be deleted from the Draft. */
  removable: boolean;
  /** Whether the page can be hidden from the site. */
  hideable: boolean;
  /** Whether the page's address can be changed. The home page IS the site's root address. */
  slugEditable: boolean;
  /** Why not, in words for the person, when any of the above is false. */
  reason?: string;
};

const FREE: PageRule = { removable: true, hideable: true, slugEditable: true };

export const PAGE_RULES: Readonly<Record<PageType, PageRule>> = {
  home: { removable: false, hideable: false, slugEditable: false, reason: "The home page is the address of your website, so it can't be deleted, hidden or moved." },
  booking: { removable: false, hideable: false, slugEditable: true, reason: "The booking page is where customers choose a Service to book, so it can't be deleted or hidden." },
  services: FREE,
  contact: FREE,
  content: FREE,
};

/** A section a kind of page cannot do without: it must keep at least one VISIBLE section of this type. */
export const REQUIRED_SECTION: Readonly<Partial<Record<PageType, { type: SectionType; message: string }>>> = {
  booking: { type: "service_list", message: "The booking page needs a visible list of Services, so customers can choose one to book." },
};

/** A page title becomes an address by lower-casing it and joining its words with hyphens. Empty when nothing usable is left. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** `base`, or `base-2`, `base-3` ... : the first address not already in `taken`. A reserved base is numbered too. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const clean = slugify(base) || "page";
  const free = (candidate: string) => !taken.has(candidate) && !isReservedSlug(candidate);
  if (free(clean)) return clean;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${clean.slice(0, 80 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (free(candidate)) return candidate;
  }
  return `${clean.slice(0, 70)}-${taken.size + 1}`;
}

/** `base-copy`, `base-copy-2` ... for a duplicate, never longer than `max` characters. */
export function copyKey(base: string, taken: ReadonlySet<string>, max: number): string {
  const trim = (suffix: string) => `${base.slice(0, max - suffix.length)}${suffix}`;
  let candidate = trim("-copy");
  for (let n = 2; taken.has(candidate); n += 1) candidate = trim(`-copy-${n}`);
  return candidate;
}

/** `prefix-1`, `prefix-2` ... : the first key not already in `taken`. */
export function numberedKey(prefix: string, taken: ReadonlySet<string>, max: number): string {
  const base = prefix.slice(0, max - 4);
  for (let n = 1; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
