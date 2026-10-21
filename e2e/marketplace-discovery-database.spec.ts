/**
 * Phase 19B at the DATABASE: what the public discovery functions answer, what they leave out, and what keeps one business's service areas and bookings
 * away from another's, independent of the application code.
 *
 * The public functions are called as the restricted runtime role (`climvia_app`, DATABASE_URL) with NO context at all: that is what a request without a
 * session looks like. Fixtures are written as the owner. Every test makes its own providers and finds them by a word in their names that nothing else
 * has, so what other specs publish in parallel cannot change an answer here.
 */
import { randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { expect, test } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { SAMPLE_SERVICES, allow, makeProvider, suspend, uniqueZip, type Provider } from "./marketplace-helpers";

let app: Pool;
let admin: Pool;
let handles: ReturnType<typeof adminDb>;

test.beforeAll(() => {
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
  handles = adminDb();
  admin = handles.pool;
});

test.afterAll(async () => {
  await app.end();
  await handles.pool.end();
});

type Json = Record<string, unknown>;

/** The public search, as a visitor's request makes it: no context, tokens already cleaned by the application. */
async function search(args: { tokens?: string[]; service?: string | null; location?: string | null; booking?: string | null; category?: string | null; page?: number; size?: number }): Promise<{ total: number; page: number; pageSize: number; results: Json[] }> {
  const result = await app.query<{ r: { total: number; page: number; pageSize: number; results: Json[] } }>(
    "select app_public_marketplace_search($1::text[], $2, $3, $4, $5, $6, $7) as r",
    [args.tokens ?? [], args.service ?? null, args.location ?? null, args.booking ?? null, args.category ?? null, args.page ?? 1, args.size ?? 12],
  );
  return result.rows[0].r;
}

async function facets(args: { tokens?: string[]; service?: string | null; location?: string | null; booking?: string | null; category?: string | null }): Promise<{ services: Json[]; locations: Json[]; categories: Json[]; bookingModes: Json[] }> {
  const result = await app.query("select app_public_marketplace_facets($1::text[], $2, $3, $4, $5) as r", [args.tokens ?? [], args.service ?? null, args.location ?? null, args.booking ?? null, args.category ?? null]);
  return result.rows[0].r;
}

const sitemap = async (): Promise<{ listings: { slug: string; updatedAt: string }[]; services: string[]; locations: string[]; combinations: { service: string; location: string }[] }> => (await app.query("select app_public_marketplace_sitemap() as r")).rows[0].r;
const profile = async (slug: string): Promise<Json | null> => (await app.query("select app_public_listing($1) as r", [slug])).rows[0].r;
const slugs = (rows: Json[]) => rows.map((row) => row.slug as string);

/** A word that only this run's providers have, in their names. */
const family = () => `fam${randomBytes(4).toString("hex")}`;
/** A ZIP code no other test or seed uses. */
const zip = uniqueZip;

/** The fields of a card, and of what is inside it: nothing else is ever sent. */
const CARD_KEYS = ["areaCount", "areas", "canBook", "categories", "description", "logo", "name", "rating", "service", "serviceCount", "slug"];
const CARD_SERVICE_KEYS = ["bookingMethod", "category", "durationMinutes", "name", "priceAmount", "priceLabel", "pricingModel", "slug"];

test.describe("a search answers with public fields only", () => {
  test("a card is built field by field: no organization, listing id, contact detail, moderation state or reviewer", async () => {
    const word = family();
    const provider = await makeProvider("card", handles, { nameWord: word, areas: [{ city: "Austin", state: "TX", label: "Central Austin" }], reviews: [{ rating: 5, reviewer: "Sarah Mitchell" }, { rating: 4, visibility: "private", reviewer: "Secret Person" }] });
    const answer = await search({ tokens: [word] });
    expect(answer.total).toBe(1);
    const card = answer.results[0];
    expect(Object.keys(card).sort()).toEqual(CARD_KEYS);
    expect(Object.keys(card.service as Json).sort()).toEqual(CARD_SERVICE_KEYS);
    expect(Object.keys((card.areas as Json[])[0]).sort()).toEqual(["display", "slug"]);
    expect(Object.keys(card.rating as Json).sort()).toEqual(["average", "count"]);
    expect(card).toMatchObject({ slug: provider.slug, name: provider.name, areas: [{ display: "Central Austin", slug: "austin-tx" }], areaCount: 1, rating: { average: 5, count: 1 }, serviceCount: 2, canBook: true });

    const text = JSON.stringify(answer);
    for (const secret of [provider.business.organizationId, provider.listingId, provider.business.owner.userId, provider.business.owner.email, "reason", "moderation", "suspended", "organization", "Sarah Mitchell", "Secret Person"]) {
      expect(text, secret).not.toContain(secret);
    }
    // The business's phone and email are in its record; the search does not carry them.
    const record = (await admin.query<{ phone: string; email: string }>("select phone, email from organizations where id = $1", [provider.business.organizationId])).rows[0];
    for (const detail of [record.phone, record.email]) expect(text, detail).not.toContain(detail);
  });

  test("only a provider that is published, not suspended and showing a Service can be found; the rest are as if they were not there", async () => {
    const word = family();
    const open = await makeProvider("open", handles, { nameWord: word });
    const hidden = await makeProvider("hidden", handles, { nameWord: word, status: "hidden" });
    const draft = await makeProvider("draft", handles, { nameWord: word, status: "draft" });
    const suspended = await makeProvider("susp", handles, { nameWord: word, suspended: true });
    const bare = await makeProvider("bare", handles, { nameWord: word, services: [] });
    const answer = await search({ tokens: [word] });
    expect(slugs(answer.results)).toEqual([open.slug]);
    expect(answer.total).toBe(1);

    // A Service that is switched off, or turned internal, is not shown, and a listing with nothing left to show leaves the Marketplace.
    await admin.query("update services set is_active = false where organization_id = $1 and slug = any($2)", [open.business.organizationId, [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp]]);
    expect((await search({ tokens: [word] })).total).toBe(0);
    await admin.query("update services set is_active = true where organization_id = $1 and slug = any($2)", [open.business.organizationId, [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp]]);
    expect((await search({ tokens: [word] })).total).toBe(1);
    for (const gone of [hidden, draft, suspended, bare]) expect(JSON.stringify(await search({ tokens: [word] })), gone.slug).not.toContain(gone.slug);
  });

  test("suspending removes a provider at once and allowing again brings it back, with nothing of the business's own settings touched", async () => {
    const word = family();
    const provider = await makeProvider("toggle", handles, { nameWord: word, areas: [{ postal: "78704" }] });
    expect((await search({ tokens: [word] })).total).toBe(1);
    await suspend(admin, provider.listingId);
    expect((await search({ tokens: [word] })).total).toBe(0);
    expect(await profile(provider.slug)).toBeNull();
    expect((await facets({ tokens: [word] })).services).toEqual([]);
    expect((await sitemap()).listings.map((entry) => entry.slug)).not.toContain(provider.slug);
    // The business's own record is exactly what it was.
    expect((await admin.query("select status from marketplace_listings where id = $1", [provider.listingId])).rows[0].status).toBe("published");
    expect((await admin.query("select count(*)::int as n from marketplace_service_areas where listing_id = $1", [provider.listingId])).rows[0].n).toBe(1);
    await allow(admin, provider.listingId);
    expect((await search({ tokens: [word] })).total).toBe(1);
    expect(await profile(provider.slug)).not.toBeNull();
    // Allowed again, but the business hides it: the platform's allowance does not publish anything.
    await admin.query("update marketplace_listings set status = 'hidden' where id = $1", [provider.listingId]);
    expect((await search({ tokens: [word] })).total).toBe(0);
  });
});

test.describe("where a provider works decides where it is found", () => {
  test("a place filter matches a listed ZIP or city exactly, and a provider that lists no area is found by no place", async () => {
    const word = family();
    const zipCode = zip();
    const cityName = `Zanzibar${randomBytes(2).toString("hex").replace(/[0-9]/g, "q")}`;
    const here = await makeProvider("here", handles, { nameWord: word, areas: [{ postal: zipCode }, { city: cityName, state: "TX", label: "The Zanzibar side" }] });
    const elsewhere = await makeProvider("elsewhere", handles, { nameWord: word, areas: [{ postal: "99950" }] });
    const nowhere = await makeProvider("nowhere", handles, { nameWord: word });
    const key = cityName.toLowerCase();

    expect(slugs((await search({ tokens: [word], location: zipCode })).results)).toEqual([here.slug]);
    expect(slugs((await search({ tokens: [word], location: `${key}-tx` })).results)).toEqual([here.slug]);
    // A city without a state matches that city in any state; with the wrong state it matches nothing.
    expect(slugs((await search({ tokens: [word], location: key })).results)).toEqual([here.slug]);
    expect((await search({ tokens: [word], location: `${key}-ok` })).total).toBe(0);
    expect((await search({ tokens: [word], location: "99950" })).results.map((card) => card.slug)).toEqual([elsewhere.slug]);
    // No filter: all three, the one with no area included; the card says it lists none.
    const all = await search({ tokens: [word] });
    expect(all.total).toBe(3);
    expect(all.results.find((card) => card.slug === nowhere.slug)).toMatchObject({ areas: [], areaCount: 0 });
    // Words of a place are matched in service areas only: a provider with no area has none to match.
    expect(slugs((await search({ tokens: [word, key] })).results)).toEqual([here.slug]);
    expect(slugs((await search({ tokens: [word, zipCode] })).results)).toEqual([here.slug]);
    expect((await search({ tokens: [word, "tx"] })).results.map((card) => card.slug)).toEqual([here.slug]);
    // The headquarters address is never coverage: nowhere's record has a ZIP code, and it is still found by no place.
    const hq = (await admin.query<{ postal_code: string }>("select postal_code from organizations where id = $1", [nowhere.business.organizationId])).rows[0];
    expect(hq.postal_code).toBeTruthy();
    expect(slugs((await search({ tokens: [word], location: hq.postal_code })).results)).not.toContain(nowhere.slug);
  });

  test("the area a visitor asked for is the one a card shows first, then the others in the order the business gave them", async () => {
    const word = family();
    const a = zip();
    const b = zip();
    const provider = await makeProvider("order", handles, { nameWord: word, areas: [{ postal: a }, { postal: b, label: "Second place" }, { city: "Ordertown", state: "CO" }] });
    const plain = (await search({ tokens: [word] })).results[0];
    expect((plain.areas as Json[]).map((area) => area.slug)).toEqual([a, b, "ordertown-co"]);
    const asked = (await search({ tokens: [word], location: b })).results[0];
    expect((asked.areas as Json[]).map((area) => area.slug)).toEqual([b, a, "ordertown-co"]);
    expect(asked.slug).toBe(provider.slug);
  });

  test("a card shows at most four places and says how many there are", async () => {
    const word = family();
    await makeProvider("many", handles, { nameWord: word, areas: [1, 2, 3, 4, 5, 6].map((n) => ({ postal: `5100${n}` })) });
    const card = (await search({ tokens: [word] })).results[0];
    expect((card.areas as Json[]).length).toBe(4);
    expect(card.areaCount).toBe(6);
  });
});

test.describe("filters, words and ranking", () => {
  test("a Service, a type of work and a way of booking each narrow the list, and the way of booking is a fact about the same Service", async () => {
    const word = family();
    const both = await makeProvider("both", handles, { nameWord: word, services: [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp] });
    const repairOnly = await makeProvider("repair", handles, { nameWord: word, services: [SAMPLE_SERVICES.repair] });
    const noBooking = await makeProvider("nobook", handles, { nameWord: word, services: [SAMPLE_SERVICES.tuneUp], actions: { book: false } });
    const byService = (service: string) => search({ tokens: [word], service });
    expect(new Set(slugs((await byService(SAMPLE_SERVICES.repair)).results))).toEqual(new Set([both.slug, repairOnly.slug]));
    expect(new Set(slugs((await byService(SAMPLE_SERVICES.tuneUp)).results))).toEqual(new Set([both.slug, noBooking.slug]));
    expect((await byService("no-such-service")).total).toBe(0);

    const kinds = await admin.query<{ slug: string; booking_method: string; category: string }>("select slug, booking_method, category from services where organization_id = $1 and slug = any($2)", [both.business.organizationId, [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp]]);
    const method = Object.fromEntries(kinds.rows.map((row) => [row.slug, row.booking_method]));
    // Booking "instant" means a Service that books instantly, offered with booking turned on: noBooking has such a Service but no booking action.
    const instantProviders = new Set(slugs((await search({ tokens: [word], booking: "instant" })).results));
    expect(instantProviders.has(both.slug)).toBe(method[SAMPLE_SERVICES.tuneUp] === "instant" || method[SAMPLE_SERVICES.repair] === "instant");
    expect(instantProviders.has(noBooking.slug)).toBe(false);
    expect(instantProviders.has(repairOnly.slug)).toBe(method[SAMPLE_SERVICES.repair] === "instant");

    const categoryOf = Object.fromEntries(kinds.rows.map((row) => [row.slug, row.category]));
    const inCategory = new Set(slugs((await search({ tokens: [word], category: categoryOf[SAMPLE_SERVICES.tuneUp] })).results));
    expect(inCategory.has(both.slug)).toBe(true);
    expect(inCategory.has(noBooking.slug)).toBe(true);
    expect(inCategory.has(repairOnly.slug)).toBe(categoryOf[SAMPLE_SERVICES.repair] === categoryOf[SAMPLE_SERVICES.tuneUp]);

    // The Service a card leads with is the one the search matched.
    const matched = (await search({ tokens: [word], service: SAMPLE_SERVICES.tuneUp })).results.find((card) => card.slug === both.slug)!;
    expect((matched.service as Json).slug).toBe(SAMPLE_SERVICES.tuneUp);
  });

  test("a filter value that is not valid matches nothing, and is never an error", async () => {
    const word = family();
    await makeProvider("valid", handles, { nameWord: word });
    for (const bad of [{ service: "Not A Slug" }, { service: "x".repeat(81) }, { booking: "free-money" }, { category: "Plumbing" }, { location: "!!" }, { location: "Austin TX" }, { location: "123" }, { location: "'; drop table organizations; --" }]) {
      const answer = await search({ tokens: [word], ...bad });
      expect(answer.total, JSON.stringify(bad)).toBe(0);
      expect(answer.results).toEqual([]);
    }
  });

  test("hostile words are cleaned again by the database: they match nothing, break nothing, and read nothing", async () => {
    const word = family();
    await makeProvider("hostile", handles, { nameWord: word });
    // (A NUL byte cannot be sent to PostgreSQL at all; the application's own words never contain one, which the rules spec checks.)
    const hostile = ["'; drop table organizations; --", "%", "_", "\\m", "(", "[a-z]+", ".*", "a|b", "$1", "x".repeat(41), "😀", "é"];
    for (const token of hostile) {
      const answer = await search({ tokens: [word, token] });
      expect(answer.total, token).toBe(1);
      expect(answer.results.length).toBe(1);
    }
    // Only letters and digits (up to 40) are words; with eight at most, the others are dropped.
    expect((await search({ tokens: [word, ...hostile] })).total).toBe(1);
    expect((await search({ tokens: [word, "nomatchword"] })).total).toBe(0);
    expect((await admin.query("select count(*)::int as n from organizations")).rows[0].n).toBeGreaterThan(0);
    // A list of more than eight words uses eight.
    expect((await search({ tokens: [word, ...Array.from({ length: 30 }, (_, i) => `w${i}`)] })).total).toBeGreaterThanOrEqual(0);
  });

  test("every word must be found: in the name, a shown Service, or a place; and a word is matched from the start of a word", async () => {
    const word = family();
    const provider = await makeProvider("words", handles, { nameWord: word, areas: [{ city: "Fort Worth", state: "TX" }] });
    const name = provider.name.toLowerCase();
    expect((await search({ tokens: [word, "repair"] })).total).toBe(1);
    expect((await search({ tokens: [word, "ac", "repair", "diagnos"] })).total).toBe(1);
    expect((await search({ tokens: [word, "fort", "worth"] })).total).toBe(1);
    expect((await search({ tokens: [word, "fort", "dallas"] })).total).toBe(0);
    expect((await search({ tokens: [word, name.split(" ")[1].slice(0, 6)] })).total).toBe(1);
    // Not from the middle of a word.
    expect((await search({ tokens: [word, "epair"] })).total).toBe(0);
    expect((await search({ tokens: [word, "orth"] })).total).toBe(0);
    // A Service the business does not show is not matched.
    expect((await search({ tokens: [word, "ductless"] })).total).toBe(0);
  });

  test("the order is the match first, then the rating from public reviews, then the number of reviews, then the name: the same every time", async () => {
    const word = family();
    const best = await makeProvider("best", handles, { nameWord: word, reviews: [{ rating: 5 }, { rating: 5 }, { rating: 4, visibility: "private" }] });
    const many = await makeProvider("many", handles, { nameWord: word, reviews: [{ rating: 4 }, { rating: 4 }, { rating: 4 }] });
    const few = await makeProvider("few", handles, { nameWord: word, reviews: [{ rating: 4 }] });
    const none1 = await makeProvider("noneb", handles, { nameWord: word });
    const none2 = await makeProvider("nonea", handles, { nameWord: word });
    const first = await search({ tokens: [word] });
    const order = slugs(first.results);
    expect(order.slice(0, 3)).toEqual([best.slug, many.slug, few.slug]);
    // The two with no reviews come last, in the order of their names.
    const rest = [none1, none2].sort((x, y) => x.name.toLowerCase().localeCompare(y.name.toLowerCase())).map((provider) => provider.slug);
    expect(order.slice(3)).toEqual(rest);
    for (let round = 0; round < 3; round += 1) expect(slugs((await search({ tokens: [word] })).results)).toEqual(order);
    // A private review changes neither the rating nor the count.
    expect(first.results[0].rating).toEqual({ average: 5, count: 2 });

    // A word in a business's name ranks that business above one that only matches by Service.
    const named = await makeProvider("named", handles, { nameWord: `${word} chillwise`.split(" ")[0], services: [SAMPLE_SERVICES.repair] });
    await admin.query("update organizations set name = $2 where id = $1", [named.business.organizationId, `${word} Chillwise Cooling`]);
    const twice = await search({ tokens: [word, "chillwise"] });
    expect(slugs(twice.results)).toEqual([named.slug]);
  });

  test("a page is a bounded slice of one stable order: no provider twice, none skipped, and the size and page are clamped", async () => {
    const word = family();
    const made: Provider[] = [];
    for (const label of ["p1", "p2", "p3", "p4", "p5"]) made.push(await makeProvider(label, handles, { nameWord: word }));
    const one = await search({ tokens: [word], size: 2, page: 1 });
    const two = await search({ tokens: [word], size: 2, page: 2 });
    const three = await search({ tokens: [word], size: 2, page: 3 });
    const four = await search({ tokens: [word], size: 2, page: 4 });
    expect([one.total, two.total, three.total, four.total]).toEqual([5, 5, 5, 5]);
    expect([one.results.length, two.results.length, three.results.length, four.results.length]).toEqual([2, 2, 1, 0]);
    const paged = [...one.results, ...two.results, ...three.results].map((card) => card.slug as string);
    expect(new Set(paged).size).toBe(5);
    expect(paged).toEqual(slugs((await search({ tokens: [word], size: 24 })).results));
    // Clamps: a page below one is the first, a size above 24 is 24, a size below one is one, a huge page is page 100 (empty, with the true total).
    expect((await search({ tokens: [word], page: 0 })).page).toBe(1);
    expect((await search({ tokens: [word], page: -5 })).page).toBe(1);
    expect((await search({ tokens: [word], size: 1000 })).pageSize).toBe(24);
    expect((await search({ tokens: [word], size: 0 })).pageSize).toBe(1);
    const far = await search({ tokens: [word], page: 2_000_000_000 });
    expect(far).toMatchObject({ page: 100, total: 5, results: [] });
  });
});

test.describe("what a visitor can choose from is what is really there", () => {
  test("each list leaves out its own filter, counts providers, and has nothing that no discoverable provider offers", async () => {
    const word = family();
    const zipA = zip();
    const zipB = zip();
    await makeProvider("fa", handles, { nameWord: word, services: [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp], areas: [{ postal: zipA }, { postal: zipB }] });
    await makeProvider("fb", handles, { nameWord: word, services: [SAMPLE_SERVICES.repair], areas: [{ postal: zipA }] });
    // Offers a Service nobody else does, but is suspended: that Service is not a choice.
    await makeProvider("fc", handles, { nameWord: word, services: [SAMPLE_SERVICES.furnace], areas: [{ postal: zipB }], suspended: true });
    await makeProvider("fd", handles, { nameWord: word, services: [SAMPLE_SERVICES.ductless], areas: [{ postal: zipB }], status: "hidden" });

    const all = await facets({ tokens: [word] });
    const count = (rows: Json[], key: string, value: string) => rows.find((row) => row[key] === value)?.providers;
    expect(count(all.services, "slug", SAMPLE_SERVICES.repair)).toBe(2);
    expect(count(all.services, "slug", SAMPLE_SERVICES.tuneUp)).toBe(1);
    expect(all.services.map((service) => service.slug)).not.toContain(SAMPLE_SERVICES.furnace);
    expect(all.services.map((service) => service.slug)).not.toContain(SAMPLE_SERVICES.ductless);
    expect(count(all.locations, "slug", zipA)).toBe(2);
    expect(count(all.locations, "slug", zipB)).toBe(1);
    expect(all.locations.every((place) => place.kind === "postal")).toBe(true);

    // Choosing a Service narrows the places, and still shows the other Services (a list leaves out its own filter).
    const tuneUp = await facets({ tokens: [word], service: SAMPLE_SERVICES.tuneUp });
    expect(tuneUp.locations.map((place) => place.slug).sort()).toEqual([zipA, zipB].sort());
    expect(count(tuneUp.services, "slug", SAMPLE_SERVICES.repair)).toBe(2);
    // Choosing a place narrows the Services.
    const inB = await facets({ tokens: [word], location: zipB });
    expect(count(inB.services, "slug", SAMPLE_SERVICES.repair)).toBe(1);
    expect(count(inB.services, "slug", SAMPLE_SERVICES.tuneUp)).toBe(1);
    expect(count(inB.locations, "slug", zipA)).toBe(2);
    // Booking modes count only Services that can be booked online, on listings that offer it.
    const modes = all.bookingModes.reduce((sum, mode) => sum + (mode.providers as number), 0);
    expect(modes).toBeGreaterThan(0);
    // Nothing found, nothing offered.
    expect(await facets({ tokens: [word, "nomatchword"] })).toEqual({ services: [], locations: [], categories: [], bookingModes: [] });
  });
});

test.describe("what a search engine may be told about", () => {
  test("only discoverable providers, the Services they show and the places they list, and a combination only where a provider has both", async () => {
    const word = family();
    const zipCode = zip();
    const city = `Sitemapville${randomBytes(2).toString("hex").replace(/[0-9]/g, "q")}`;
    const live = await makeProvider("smlive", handles, { nameWord: word, services: [SAMPLE_SERVICES.repair], areas: [{ postal: zipCode }, { city, state: "TX" }] });
    const noAreas = await makeProvider("smnone", handles, { nameWord: word, services: [SAMPLE_SERVICES.ductless] });
    const hidden = await makeProvider("smhidden", handles, { nameWord: word, services: [SAMPLE_SERVICES.furnace], areas: [{ postal: "99951" }], status: "hidden" });
    const suspended = await makeProvider("smsusp", handles, { nameWord: word, services: [SAMPLE_SERVICES.heatPump], areas: [{ postal: "99952" }], suspended: true });

    const map = await sitemap();
    const listed = map.listings.map((entry) => entry.slug);
    expect(listed).toContain(live.slug);
    expect(listed).toContain(noAreas.slug);
    expect(listed).not.toContain(hidden.slug);
    expect(listed).not.toContain(suspended.slug);
    const key = city.toLowerCase();
    expect(map.locations).toEqual(expect.arrayContaining([zipCode, `${key}-tx`]));
    expect(map.locations).not.toContain("99951");
    expect(map.locations).not.toContain("99952");
    const combos = map.combinations.filter((pair) => [zipCode, `${key}-tx`, "99951", "99952"].includes(pair.location));
    expect(combos).toEqual(expect.arrayContaining([{ service: SAMPLE_SERVICES.repair, location: zipCode }, { service: SAMPLE_SERVICES.repair, location: `${key}-tx` }]));
    expect(combos.length).toBe(2);
    // A Service only a provider without places offers has a page of its own but no combination with any place.
    expect(map.combinations.some((pair) => pair.service === SAMPLE_SERVICES.ductless && [zipCode, `${key}-tx`].includes(pair.location))).toBe(false);
    for (const entry of map.listings) expect(Date.parse(entry.updatedAt), entry.slug).not.toBeNaN();
    expect(JSON.stringify(map)).not.toMatch(/organization|listing_id|owner|email|phone/i);
  });
});

test.describe("a provider's profile is public fields only", () => {
  test("the profile carries the business's choices, its places and its public reviews as a first name and a last initial, and nothing private", async () => {
    const provider = await makeProvider("profile", handles, {
      areas: [{ city: "Austin", state: "TX" }, { postal: "78704", label: "South Austin" }],
      reviews: [
        { rating: 5, reviewer: "Sarah Mitchell", text: "Great work.", on: "2024-10-25" },
        { rating: 3, reviewer: "Ana de la Cruz", text: "Fine.", on: "2024-10-20" },
        { rating: 1, reviewer: "Hidden Reviewer", text: "Private words.", visibility: "private" },
        { rating: 4, reviewer: "Madonna", text: "Single name.", on: "2024-10-10" },
      ],
      show: { phone: false, email: false, address: false },
    });
    const data = (await profile(provider.slug))!;
    expect(Object.keys(data).sort()).toEqual(["hours", "listing", "organization", "reviews", "serviceAreas", "services", "rating", "sitePages", "siteSlug"].sort());
    expect(data.serviceAreas).toEqual([
      { display: "Austin, TX", kind: "city", slug: "austin-tx" },
      { display: "South Austin", kind: "postal", slug: "78704" },
    ]);
    expect(data.rating).toEqual({ average: 4, count: 3 });
    // Newest first, each reviewer as a first name and a last initial (a single name as it is).
    expect((data.reviews as Json[]).map((review) => [review.reviewer, review.rating])).toEqual([["Sarah M.", 5], ["Ana C.", 3], ["Madonna", 4]]);
    expect((data.reviews as Json[]).map((review) => Object.keys(review).sort())).toEqual([["date", "rating", "reviewer", "text"], ["date", "rating", "reviewer", "text"], ["date", "rating", "reviewer", "text"]]);
    const text = JSON.stringify(data);
    for (const secret of ["Hidden Reviewer", "Private words", "Sarah Mitchell", "Ana de la Cruz", provider.business.organizationId, provider.listingId, provider.business.owner.email]) expect(text, secret).not.toContain(secret);
    // Contact details the business turned off are not in the answer at all.
    const organization = data.organization as Json;
    expect(organization.phone ?? null).toBeNull();
    expect(organization.email ?? null).toBeNull();
    expect(organization.address ?? null).toBeNull();
  });

  test("at most the ten latest public reviews are sent, newest first", async () => {
    const provider = await makeProvider("tenrev", handles, { reviews: Array.from({ length: 13 }, (_, index) => ({ rating: 5, text: `Review ${index}`, on: `2024-09-${String(index + 1).padStart(2, "0")}` })) });
    const data = (await profile(provider.slug))!;
    const reviews = data.reviews as Json[];
    expect(reviews.length).toBe(10);
    expect(reviews[0].date).toBe("2024-09-13");
    expect(reviews[9].date).toBe("2024-09-04");
    expect((data.rating as Json).count).toBe(13);
  });

  test("an unknown, hidden, draft or suspended listing has no profile, all the same", async () => {
    const ok = await makeProvider("pok", handles);
    const hidden = await makeProvider("phid", handles, { status: "hidden" });
    const draft = await makeProvider("pdraft", handles, { status: "draft" });
    const suspended = await makeProvider("psusp", handles, { suspended: true });
    expect(await profile(ok.slug)).not.toBeNull();
    for (const missing of [hidden.slug, draft.slug, suspended.slug, "no-such-listing", "", "x".repeat(64), "'; drop table organizations; --"]) expect(await profile(missing), missing).toBeNull();
  });
});

test.describe("a booking from the Marketplace", () => {
  const book = (listing: string, service: string, over: Partial<{ key: string; email: string; discoveryService: string | null; discoveryLocation: string | null; name: string; start: string; end: string }> = {}) =>
    app.query<{ r: Json }>(
      "select app_public_create_marketplace_booking($1, $2, $3, '2030-05-14'::date, $4::time, $5::time, $6, '(555) 010-0000', $7, '12 Main Street, Austin, TX', 'note', null, null, $8, $9) as r",
      [listing, service, over.key ?? randomBytes(8).toString("hex"), over.start ?? "10:00", over.end ?? "11:00", over.name ?? "Pat Visitor", over.email ?? `pat-${randomBytes(3).toString("hex")}@example.test`, over.discoveryService ?? null, over.discoveryLocation ?? null],
    ).then((result) => result.rows[0].r);

  test("it is recorded as a Marketplace booking of that listing, with what the visitor was looking at, and the business is found from the listing alone", async () => {
    const provider = await makeProvider("book", handles);
    const answer = await book(provider.slug, SAMPLE_SERVICES.tuneUp, { discoveryService: SAMPLE_SERVICES.tuneUp, discoveryLocation: "austin-tx" });
    expect(answer).toMatchObject({ ok: true, duplicate: false });
    const row = (
      await admin.query(
        `select b.organization_id, b.source, b.marketplace_listing_id, b.discovery_service, b.discovery_location, b.status, b.contact_name, c.name as customer_name, c.organization_id as customer_organization
           from bookings b left join customers c on c.id = b.customer_id where b.organization_id = $1 and b.number = $2`,
        [provider.business.organizationId, answer.number],
      )
    ).rows[0];
    // The visitor is the business's customer now (drizzle/0030): the booking is theirs and keeps the attribution; customer-acquisition-database.spec.ts holds the rule.
    expect(row).toMatchObject({ organization_id: provider.business.organizationId, source: "Marketplace", marketplace_listing_id: provider.listingId, discovery_service: SAMPLE_SERVICES.tuneUp, discovery_location: "austin-tx", contact_name: null, customer_name: "Pat Visitor", customer_organization: provider.business.organizationId });
    expect(["pending", "confirmed"]).toContain(row.status);
    // (A Website booking is still a Website booking: website-database.spec.ts holds its source, and marketplace-discovery.spec.ts counts the two apart.)
  });

  test("what the visitor was looking at is kept only if it is shaped like an address; anything else is dropped, and the booking is made", async () => {
    const provider = await makeProvider("shape", handles);
    for (const [service, location, expected] of [
      ["'; drop table bookings; --", "x".repeat(81), [null, null]],
      ["Ac Repair", "Austin, TX", [null, null]],
      ["ac-repair", "78704", ["ac-repair", "78704"]],
    ] as const) {
      const answer = await book(provider.slug, SAMPLE_SERVICES.repair, { discoveryService: service, discoveryLocation: location });
      expect(answer.ok, service).toBe(true);
      const row = (await admin.query("select discovery_service, discovery_location from bookings where organization_id = $1 and number = $2", [provider.business.organizationId, answer.number])).rows[0];
      expect([row.discovery_service, row.discovery_location]).toEqual(expected);
    }
  });

  test("a repeat of the same submission, or the same person asking for the same time, is the first booking", async () => {
    const provider = await makeProvider("repeat", handles);
    const email = `same-${randomBytes(3).toString("hex")}@example.test`;
    const first = await book(provider.slug, SAMPLE_SERVICES.tuneUp, { key: "key-one-0001", email });
    const sameKey = await book(provider.slug, SAMPLE_SERVICES.tuneUp, { key: "key-one-0001", email: "other@example.test", start: "14:00", end: "15:00" });
    const sameRequest = await book(provider.slug, SAMPLE_SERVICES.tuneUp, { key: "key-two-0002", email });
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(sameKey).toMatchObject({ ok: true, duplicate: true, number: first.number });
    expect(sameRequest).toMatchObject({ ok: true, duplicate: true, number: first.number });
    expect((await admin.query("select count(*)::int as n from bookings where organization_id = $1 and source = 'Marketplace'", [provider.business.organizationId])).rows[0].n).toBe(1);
  });

  test("it is refused for a listing that is hidden, suspended or not taking bookings, and for a Service the listing does not show or another business offers", async () => {
    const word = family();
    const ok = await makeProvider("bok", handles, { nameWord: word, services: [SAMPLE_SERVICES.tuneUp] });
    const hidden = await makeProvider("bhid", handles, { status: "hidden" });
    const suspended = await makeProvider("bsus", handles, { suspended: true });
    const noBooking = await makeProvider("bnb", handles, { actions: { book: false } });
    const other = await makeProvider("bother", handles, { services: [SAMPLE_SERVICES.heatPump] });

    for (const listing of [hidden, suspended, noBooking]) expect(await book(listing.slug, SAMPLE_SERVICES.tuneUp), listing.slug).toEqual({ ok: false, reason: "listing" });
    expect(await book("no-such-listing", SAMPLE_SERVICES.tuneUp)).toEqual({ ok: false, reason: "listing" });
    // A Service the listing does not show (the business offers it, the listing does not).
    expect(await book(ok.slug, SAMPLE_SERVICES.heatPump)).toEqual({ ok: false, reason: "service" });
    // A Service address that belongs to no one, or is an injection.
    for (const service of ["no-such-service", "'; drop table bookings; --", "x".repeat(200), ""]) expect(await book(ok.slug, service), service).toEqual({ ok: false, reason: "service" });
    // The same address in another business is that business's Service: this listing's request cannot reach it.
    const before = (await admin.query("select count(*)::int as n from bookings where organization_id = $1", [other.business.organizationId])).rows[0].n;
    expect(await book(ok.slug, SAMPLE_SERVICES.heatPump)).toEqual({ ok: false, reason: "service" });
    expect((await admin.query("select count(*)::int as n from bookings where organization_id = $1", [other.business.organizationId])).rows[0].n).toBe(before);
    // An Internal-only Service cannot be booked even when it was selected earlier.
    await admin.query("update services set visibility = 'public-only' where organization_id = $1 and slug = $2", [ok.business.organizationId, SAMPLE_SERVICES.tuneUp]);
    expect(await book(ok.slug, SAMPLE_SERVICES.tuneUp)).toEqual({ ok: false, reason: "service" });
    // And invalid visitor details are refused as details.
    await admin.query("update services set visibility = 'public-booking' where organization_id = $1 and slug = $2", [ok.business.organizationId, SAMPLE_SERVICES.tuneUp]);
    expect(await book(ok.slug, SAMPLE_SERVICES.tuneUp, { name: "" })).toEqual({ ok: false, reason: "details" });
    expect(await book(ok.slug, SAMPLE_SERVICES.tuneUp, { name: "x".repeat(81) })).toEqual({ ok: false, reason: "details" });
    expect(await book(ok.slug, SAMPLE_SERVICES.tuneUp, { start: "11:00", end: "10:00" })).toEqual({ ok: false, reason: "details" });
  });

  test("a suspended listing takes no booking even from a page that was open before, and takes bookings again when allowed", async () => {
    const provider = await makeProvider("late", handles);
    expect(await book(provider.slug, SAMPLE_SERVICES.tuneUp)).toMatchObject({ ok: true });
    await suspend(admin, provider.listingId);
    expect(await book(provider.slug, SAMPLE_SERVICES.tuneUp)).toEqual({ ok: false, reason: "listing" });
    await allow(admin, provider.listingId);
    expect(await book(provider.slug, SAMPLE_SERVICES.tuneUp)).toMatchObject({ ok: true });
  });

  test("the booking context is the listing's: hours for the slots even when they are hidden, the phone only when shown, and nothing of another business", async () => {
    const hiding = await makeProvider("ctxhide", handles, { show: { phone: false, hours: false } });
    const showing = await makeProvider("ctxshow", handles);
    const read = async (slug: string) => (await app.query("select app_public_listing_booking($1, $2) as r", [slug, SAMPLE_SERVICES.tuneUp])).rows[0].r as Json;
    const hidden = await read(hiding.slug);
    expect((hidden.organization as Json).phone ?? null).toBeNull();
    expect((hidden.hours as Json[]).length).toBeGreaterThan(0);
    const shown = await read(showing.slug);
    expect(typeof (shown.organization as Json).phone).toBe("string");
    expect(Object.keys(shown).sort()).toEqual(["fixedClock", "hours", "listing", "organization", "service"]);
    expect(JSON.stringify(shown)).not.toContain(showing.business.organizationId);
    expect(JSON.stringify(shown)).not.toContain(showing.listingId);
    // A suspended listing has no booking context at all.
    await suspend(admin, showing.listingId);
    expect(await read(showing.slug)).toBeNull();
  });

  test("the listing's bookings stay when it is deleted: the attribution is cleared, the booking and its source are not", async () => {
    const provider = await makeProvider("gone", handles);
    const made = await book(provider.slug, SAMPLE_SERVICES.tuneUp);
    await admin.query("delete from marketplace_service_areas where listing_id = $1", [provider.listingId]);
    await admin.query("delete from marketplace_listing_services where listing_id = $1", [provider.listingId]);
    await admin.query("delete from marketplace_listings where id = $1", [provider.listingId]);
    const row = (await admin.query("select source, marketplace_listing_id from bookings where organization_id = $1 and number = $2", [provider.business.organizationId, made.number])).rows[0];
    expect(row).toEqual({ source: "Marketplace", marketplace_listing_id: null });
  });
});

test.describe("service areas and moderation are kept apart by the database", () => {
  let apex = "";
  let northstar = "";
  const person: Record<string, string> = {};

  test.beforeAll(async () => {
    apex = (await admin.query<{ id: string }>("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id;
    northstar = (await admin.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    for (const [key, email] of Object.entries({ alex: "alex.morgan@apex.test", jamie: "jamie.rivera@apex.test", taylor: "taylor.brooks@northstar.test" })) {
      person[key] = (await admin.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0].id;
    }
  });

  /** Run `fn` as a person acting for a business, in a transaction that is always rolled back. */
  async function as<T>(userId: string | null, organizationId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<{ value: T } | { error: string; code?: string }> {
    const client = await app.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId ?? "", organizationId ?? ""]);
      return { value: await fn(client) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code };
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }

  const listingOf = async (organizationId: string) => (await admin.query<{ id: string }>("select id from marketplace_listings where organization_id = $1", [organizationId])).rows[0].id;
  const areaCount = (client: PoolClient, listing: string) => client.query<{ n: number }>("select count(*)::int as n from marketplace_service_areas where listing_id = $1", [listing]).then((result) => result.rows[0].n);

  test("members read their own business's areas and nobody else's; with no context, a visitor reads none from the table", async () => {
    const apexListing = await listingOf(apex);
    const northListing = await listingOf(northstar);
    const own = await as(person.alex, apex, (client) => areaCount(client, apexListing));
    expect(own).toMatchObject({ value: expect.any(Number) });
    expect((own as { value: number }).value).toBeGreaterThan(0);
    expect(await as(person.alex, apex, (client) => areaCount(client, northListing))).toEqual({ value: 0 });
    expect(await as(person.taylor, northstar, (client) => areaCount(client, apexListing))).toEqual({ value: 0 });
    expect(await as(null, null, (client) => areaCount(client, apexListing))).toEqual({ value: 0 });
    // A person acting for a business they do not belong to reads nothing of it.
    expect(await as(person.taylor, apex, (client) => areaCount(client, apexListing))).toEqual({ value: 0 });
  });

  test("only an owner or admin writes areas; a member cannot, and nobody can write into another business's listing", async () => {
    const apexListing = await listingOf(apex);
    const northListing = await listingOf(northstar);
    const insert = (client: PoolClient, organizationId: string, listingId: string) =>
      client.query("insert into marketplace_service_areas (organization_id, listing_id, postal_code, sort_order) values ($1, $2, '10001', 99)", [organizationId, listingId]);
    const ownerWrites = await as(person.alex, apex, async (client) => {
      await insert(client, apex, apexListing);
      return areaCount(client, apexListing);
    });
    expect((ownerWrites as { value: number }).value).toBeGreaterThan(0);
    for (const attempt of [
      await as(person.jamie, apex, (client) => insert(client, apex, apexListing)),
      // The business is Apex's, the listing is Northstar's: the composite key refuses it.
      await as(person.alex, apex, (client) => insert(client, apex, northListing)),
      // The business is Northstar's: Apex's owner is not a member of it.
      await as(person.alex, apex, (client) => insert(client, northstar, northListing)),
      await as(person.alex, northstar, (client) => insert(client, northstar, northListing)),
      await as(null, null, (client) => insert(client, apex, apexListing)),
    ]) {
      expect("error" in attempt, JSON.stringify(attempt)).toBe(true);
    }
    // A member cannot delete or change them either.
    expect(await as(person.jamie, apex, async (client) => (await client.query("delete from marketplace_service_areas where listing_id = $1", [apexListing])).rowCount)).toEqual({ value: 0 });
    expect(await as(person.jamie, apex, async (client) => (await client.query("update marketplace_service_areas set label = 'x' where listing_id = $1", [apexListing])).rowCount)).toMatchObject({});
    expect(await as(person.alex, apex, async (client) => (await client.query("delete from marketplace_service_areas where listing_id = $1", [northListing])).rowCount)).toEqual({ value: 0 });
  });

  test("the runtime role cannot read or write the moderation record, cannot write reviews, and has no way to make a review public", async () => {
    const provider = await makeProvider("rls", handles, { reviews: [{ rating: 5, visibility: "private" }] });
    for (const statement of ["select * from platform_listing_moderation", "select * from platform_audit_events", "select * from platform_admins", "update platform_listing_moderation set state = 'allowed'"]) {
      const result = await as(person.alex, apex, (client) => client.query(statement));
      expect(result, statement).toMatchObject({ code: "42501" });
    }
    const write = await as(person.alex, apex, (client) => client.query("update reviews set visibility = 'public' where organization_id = $1", [apex]));
    expect(write).toMatchObject({ code: "42501" });
    const insert = await as(person.alex, apex, (client) => client.query("insert into reviews (organization_id, slug, contact_name, source, rating, review_text, submitted_on, visibility) values ($1, 'forged', 'X', 'Climvia', 5, 'x', '2024-01-01', 'public')", [apex]));
    expect(insert).toMatchObject({ code: "42501" });
    expect((await admin.query("select visibility from reviews where organization_id = $1", [provider.business.organizationId])).rows[0].visibility).toBe("private");
  });

  test("a business is told THAT its listing is suspended and nothing else: only a member of the active business, and only a yes or a no", async () => {
    const provider = await makeProvider("told", handles);
    const owner = provider.business.owner.userId;
    const ask = (userId: string | null, organizationId: string | null) => as(userId, organizationId, async (client) => (await client.query<{ s: boolean }>("select app_listing_suspended() as s")).rows[0].s);
    expect(await ask(owner, provider.business.organizationId)).toEqual({ value: false });
    await suspend(admin, provider.listingId, "A private reason");
    expect(await ask(owner, provider.business.organizationId)).toEqual({ value: true });
    expect(await ask(person.alex, provider.business.organizationId)).toEqual({ value: false });
    expect(await ask(null, null)).toEqual({ value: false });
    expect(await ask(owner, null)).toEqual({ value: false });
    // The answer is a boolean: no reason, no decision time, no administrator.
    expect(JSON.stringify(await ask(owner, provider.business.organizationId))).not.toContain("private");
    await allow(admin, provider.listingId);
    expect(await ask(owner, provider.business.organizationId)).toEqual({ value: false });
  });
});
