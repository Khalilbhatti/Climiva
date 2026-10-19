/**
 * Phase 19B: the rules of Marketplace discovery that need no browser. How a business says where it works (cities, states, ZIP codes and their
 * normal forms), how a visitor's words and place are read, how a search is written into an address and read back, and that the database's matching key
 * for a city is the very key the application computes (so a city spelled two ways is one place wherever it is written).
 *
 * Pure functions are called directly; the one database check connects as the owner and rolls its own rows back.
 */
import { Pool } from "pg";
import { expect, test } from "playwright/test";
import {
  AREA_LIMIT,
  DISCOVERY_MAX_PAGE,
  MAX_TOKENS,
  areaDisplay,
  areaKey,
  areaSlug,
  bookingHref,
  cityKey,
  discoveryHref,
  locationFromText,
  locationLabel,
  normalizeCity,
  normalizePostal,
  normalizeState,
  parseAreas,
  parseLocationSlug,
  pathQuery,
  profileHref,
  readDiscoveryContext,
  readDiscoveryQuery,
  reviewDate,
  tidyAddress,
  tokenize,
} from "../src/lib/marketplace-discovery";
import { pageWindow } from "../src/components/marketplace/discovery/Pagination";

test.describe("how a business says where it works", () => {
  test("a city name is tidied, and anything that is not a plausible city is refused", () => {
    expect(normalizeCity("austin")).toBe("Austin");
    expect(normalizeCity("AUSTIN")).toBe("Austin");
    expect(normalizeCity("  Round    Rock ")).toBe("Round Rock");
    expect(normalizeCity("st. louis")).toBe("St. Louis");
    expect(normalizeCity("Winston-Salem")).toBe("Winston-Salem");
    expect(normalizeCity("McKinney")).toBe("McKinney");
    expect(normalizeCity("O'Fallon")).toBe("O'Fallon");
    for (const bad of ["", "A", "Austin1", "<script>alert(1)</script>", "Austin; drop table x", "78704", "x".repeat(61), "{{city}}", 42, null, undefined]) expect(normalizeCity(bad), String(bad)).toBeUndefined();
  });

  test("one place is one key, however it is typed", () => {
    const keys = ["St. Louis", "st louis", "ST LOUIS", "St Louis", "st.  louis", "St-Louis"].map(cityKey);
    expect(new Set(keys).size).toBe(1);
    expect(cityKey("O'Fallon")).toBe(cityKey("OFallon"));
    expect(cityKey("Winston-Salem")).toBe("winston salem");
    expect(cityKey("Austin")).not.toBe(cityKey("Austin Hills"));
  });

  test("a state is a two-letter code, from a code or a name, in any case", () => {
    for (const [input, expected] of [["TX", "TX"], ["tx", "TX"], ["Tx", "TX"], ["texas", "TX"], ["  Texas ", "TX"], ["New York", "NY"], ["district of columbia", "DC"], ["DC", "DC"]] as const) expect(normalizeState(input), input).toBe(expected);
    for (const bad of ["", "ZZ", "Tex", "Texass", "T", "Ontario", 5, null]) expect(normalizeState(bad), String(bad)).toBeUndefined();
  });

  test("a ZIP is five digits (a ZIP+4 is cut to its ZIP), and nothing else is", () => {
    expect(normalizePostal("78704")).toBe("78704");
    expect(normalizePostal(" 78704 ")).toBe("78704");
    expect(normalizePostal("78704-1234")).toBe("78704");
    for (const bad of ["7870", "787045", "abcde", "78 704", "78704-12", "", null, 78704]) expect(normalizePostal(bad), String(bad)).toBeUndefined();
  });

  test("an area is shown by its label, else its city and state, else its ZIP, and has one address and one identity", () => {
    const city = { city: "Austin", state: "TX", postal: null, label: null };
    const labelled = { city: "Austin", state: "TX", postal: null, label: "South Austin" };
    const zip = { city: null, state: null, postal: "78704", label: null };
    expect([areaDisplay(city), areaDisplay(labelled), areaDisplay(zip)]).toEqual(["Austin, TX", "South Austin", "78704"]);
    expect([areaSlug(city), areaSlug({ city: "St. Louis", state: "MO", postal: null, label: null }), areaSlug(zip)]).toEqual(["austin-tx", "st-louis-mo", "78704"]);
    // A label is not part of a place's identity.
    expect(areaKey(city)).toBe(areaKey(labelled));
    expect(areaKey(city)).not.toBe(areaKey(zip));
  });

  test("a list of areas is accepted only when every area is a city and state or a ZIP, and no place is listed twice", () => {
    const ok = parseAreas([{ city: "austin", state: "texas" }, { postal: "78704-0001", label: " South Austin " }, { city: "St. Louis", state: "MO", label: null }]);
    expect(ok).toEqual({
      ok: true,
      value: [
        { city: "Austin", state: "TX", postal: null, label: null },
        { city: null, state: null, postal: "78704", label: "South Austin" },
        { city: "St. Louis", state: "MO", postal: null, label: null },
      ],
    });
    expect(parseAreas([])).toEqual({ ok: true, value: [] });

    const refused: [string, unknown][] = [
      ["not a list", "Austin, TX"],
      ["neither a city nor a ZIP", [{ label: "Somewhere" }]],
      ["both a city and a ZIP", [{ city: "Austin", state: "TX", postal: "78704" }]],
      ["a city without a state", [{ city: "Austin" }]],
      ["a state that is not one", [{ city: "Austin", state: "ZZ" }]],
      ["a ZIP that is not five digits", [{ postal: "787" }]],
      ["an invalid city", [{ city: "Aus<tin", state: "TX" }]],
      ["an unknown field", [{ city: "Austin", state: "TX", organizationId: "00000000-0000-0000-0000-000000000000" }]],
      ["a label with braces", [{ city: "Austin", state: "TX", label: "{{city}}" }]],
      ["a label that is too long", [{ city: "Austin", state: "TX", label: "x".repeat(61) }]],
      ["an area that is not an object", ["Austin, TX"]],
    ];
    for (const [what, input] of refused) {
      const result = parseAreas(input);
      expect(result.ok, what).toBe(false);
    }
    // The same place twice, however it was typed.
    const duplicate = parseAreas([{ city: "St. Louis", state: "MO" }, { city: "st louis", state: "missouri" }]);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error).toMatch(/already listed/);
    expect(parseAreas([{ postal: "78704" }, { postal: "78704-9999" }]).ok).toBe(false);
    // The same city name in two states is two places.
    expect(parseAreas([{ city: "Springfield", state: "IL" }, { city: "Springfield", state: "MO" }]).ok).toBe(true);
  });

  test("a listing may list up to fifty areas and no more", () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => ({ postal: String(10000 + index) }));
    expect(parseAreas(many(AREA_LIMIT)).ok).toBe(true);
    expect(parseAreas(many(AREA_LIMIT + 1)).ok).toBe(false);
  });
});

test.describe("how a visitor's words and place are read", () => {
  test("a search becomes lower-case words: no punctuation, no filler, no repeats, at most eight", () => {
    expect(tokenize("AC Repair")).toEqual(["ac", "repair"]);
    expect(tokenize("  Heat   Pump!!  in   Austin ")).toEqual(["heat", "pump", "austin"]);
    expect(tokenize("repair repair REPAIR")).toEqual(["repair"]);
    expect(tokenize("the service of a heat pump for my home")).toEqual(["heat", "pump", "home"]);
    expect(tokenize("a b c d e f g h i j k").length).toBe(MAX_TOKENS);
    expect(tokenize("x".repeat(41))).toEqual([]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  test("hostile and malformed searches become harmless words, never part of a query", () => {
    for (const hostile of [
      "'; drop table users; --",
      "\" OR 1=1 --",
      "%",
      "_%_",
      "\\",
      "(?i)a|b",
      "[a-z]+",
      "$1",
      "ac\u0000repair",
      "<script>alert(1)</script>",
      "../../etc/passwd",
      "😀 repair",
      "ａｃ repair",
    ]) {
      for (const token of tokenize(hostile)) expect(token, hostile).toMatch(/^[a-z0-9]{1,40}$/);
    }
    expect(tokenize("'; drop table users; --")).toEqual(["drop", "table", "users"]);
    expect(tokenize("%")).toEqual([]);
  });

  test("a place is understood as a ZIP, a city and state, or a city, in the ways people write it", () => {
    const understood: [string, string][] = [
      ["78704", "78704"],
      ["78704-1234", "78704"],
      [" 78704 ", "78704"],
      ["Austin, TX", "austin-tx"],
      ["austin tx", "austin-tx"],
      ["Austin, Texas", "austin-tx"],
      ["austin texas", "austin-tx"],
      ["Austin", "austin"],
      ["Salt Lake City, UT", "salt-lake-city-ut"],
      ["salt lake city utah", "salt-lake-city-ut"],
      ["New York, New York", "new-york-ny"],
      ["St. Louis, MO", "st-louis-mo"],
      ["St Louis MO", "st-louis-mo"],
      ["Winston-Salem, NC", "winston-salem-nc"],
    ];
    for (const [text, slug] of understood) expect(locationFromText(text), text).toBe(slug);
    for (const bad of ["", "   ", "12", "787045", "12345abc", "Austin, XX", "a, b, c", "Austin;drop", "<b>", "x".repeat(81), "9th Street", "Austin, TX, USA"]) expect(locationFromText(bad), bad).toBeUndefined();
  });

  test("a place's address reads back as the same place, and is shown the way a person writes it", () => {
    expect(parseLocationSlug("78704")).toEqual({ kind: "postal", postal: "78704" });
    expect(parseLocationSlug("austin-tx")).toEqual({ kind: "city", cityKey: "austin", state: "TX" });
    expect(parseLocationSlug("salt-lake-city-ut")).toEqual({ kind: "city", cityKey: "salt lake city", state: "UT" });
    // "winston-salem" ends in "em", which is not a state: it is a city with no state.
    expect(parseLocationSlug("winston-salem")).toEqual({ kind: "city", cityKey: "winston salem", state: null });
    for (const bad of ["", "Austin-TX", "austin tx", "787", "78704-1", "a--b", "-austin", "austin-", "x".repeat(81), "9th-street"]) expect(parseLocationSlug(bad), bad).toBeUndefined();
    for (const text of ["Austin, TX", "St. Louis, MO", "Salt Lake City, UT", "78704", "Winston-Salem, NC"]) {
      const slug = locationFromText(text)!;
      expect(locationFromText(locationLabel(slug)), text).toBe(slug);
    }
    expect(locationLabel("austin-tx")).toBe("Austin, TX");
    expect(locationLabel("78704")).toBe("78704");
    expect(locationLabel("not valid!")).toBe("not valid!");
  });
});

test.describe("a search as an address", () => {
  test("the query string is read with every part bounded, and what does not fit is ignored, never an error", () => {
    const query = readDiscoveryQuery({ q: "  AC   repair ", service: "ac-repair", location: "Austin, TX", booking: "instant", category: "cooling", page: "3" });
    expect(query).toEqual({ q: "AC repair", tokens: ["ac", "repair"], service: "ac-repair", locationText: "Austin, TX", location: "austin-tx", booking: "instant", category: "Cooling", page: 3 });

    expect(readDiscoveryQuery({})).toMatchObject({ q: "", tokens: [], service: null, location: null, locationText: "", booking: null, category: null, page: 1 });
    expect(readDiscoveryQuery({ q: "x".repeat(500) }).q.length).toBe(100);
    for (const [page, expected] of [["0", 1], ["-4", 1], ["abc", 1], ["1.5", 1], ["2", 2], ["100", DISCOVERY_MAX_PAGE], ["101", DISCOVERY_MAX_PAGE], ["999", DISCOVERY_MAX_PAGE], ["9999", 1], ["", 1]] as const) expect(readDiscoveryQuery({ page }).page, `page=${page}`).toBe(expected);
    expect(readDiscoveryQuery({ service: "Not A Slug" }).service).toBeNull();
    expect(readDiscoveryQuery({ service: "a".repeat(81) }).service).toBeNull();
    expect(readDiscoveryQuery({ booking: "free-money" }).booking).toBeNull();
    expect(readDiscoveryQuery({ category: "plumbing" }).category).toBeNull();
    // Repeated parameters: the first one counts.
    expect(readDiscoveryQuery({ q: ["first", "second"], page: ["2", "3"] })).toMatchObject({ q: "first", page: 2 });
    // A place that is not understood is kept to show back, and not applied.
    expect(readDiscoveryQuery({ location: "zzz!!" })).toMatchObject({ locationText: "zzz!!", location: null });
  });

  test("an address is written the clean way when only a Service and a place are chosen, and read back as the same search", () => {
    expect(discoveryHref({})).toBe("/marketplace");
    expect(discoveryHref({ service: "ac-repair" })).toBe("/marketplace/services/ac-repair");
    expect(discoveryHref({ location: "austin-tx" })).toBe("/marketplace/locations/austin-tx");
    expect(discoveryHref({ service: "ac-repair", location: "78704" })).toBe("/marketplace/services/ac-repair/78704");
    expect(discoveryHref({ service: "ac-repair", location: "78704", page: 2 })).toBe("/marketplace/services/ac-repair/78704?page=2");
    expect(discoveryHref({ q: "ac repair", location: "austin-tx", page: 2 })).toBe("/marketplace?q=ac+repair&location=Austin%2C+TX&page=2");
    expect(discoveryHref({ q: "ac repair", locationText: "78704", page: 2 })).toBe("/marketplace?q=ac+repair&location=78704&page=2");
    expect(discoveryHref({ service: "ac-repair", booking: "instant" })).toBe("/marketplace?service=ac-repair&booking=instant");
    expect(discoveryHref({ category: "Heat pumps" })).toBe("/marketplace?category=heat-pumps");
    expect(discoveryHref({ q: "heat", page: 1 })).toBe("/marketplace?q=heat");

    for (const href of ["/marketplace?q=ac+repair&location=Austin%2C+TX&page=2", "/marketplace?service=ac-repair&booking=request-appointment&category=cooling", "/marketplace?q=heat&location=78704"]) {
      const params = Object.fromEntries(new URL(href, "http://x").searchParams);
      const query = readDiscoveryQuery(params);
      expect(discoveryHref(query), href).toBe(href);
    }
  });

  test("an address that has a cleaner form is sent there, and one that is already right is left alone", () => {
    const tidy = (params: Record<string, string>) => tidyAddress(params, readDiscoveryQuery(params));
    expect(tidy({ service: "ac-repair" })).toBe("/marketplace/services/ac-repair");
    expect(tidy({ location: "Austin, TX" })).toBe("/marketplace/locations/austin-tx");
    expect(tidy({ service: "ac-repair", location: "78704", page: "2" })).toBe("/marketplace/services/ac-repair/78704?page=2");
    expect(tidy({ q: "", service: "ac-repair" })).toBe("/marketplace/services/ac-repair");
    expect(tidy({ q: "", location: "" })).toBe("/marketplace");
    expect(tidy({ q: "ac repair" })).toBeNull();
    expect(tidy({ q: "ac repair", location: "78704", page: "2" })).toBeNull();
    expect(tidy({ service: "ac-repair", booking: "instant" })).toBeNull();
    expect(tidy({})).toBeNull();
    // A place that was not understood is not thrown away by a redirect: the page says so.
    expect(tidy({ location: "zzz!!" })).toBeNull();
    expect(tidy({ service: "ac-repair", location: "zzz!!" })).toBeNull();
  });

  test("a clean page reads its Service and place from the path and only the page number from the query", () => {
    expect(pathQuery({ page: "2", q: "ignored", booking: "instant" }, { service: "ac-repair", location: "austin-tx" })).toMatchObject({ service: "ac-repair", location: "austin-tx", page: 2, q: "", booking: null });
    expect(pathQuery({}, { service: "ac-repair" })).toMatchObject({ service: "ac-repair", location: null });
    expect(pathQuery({}, { location: "78704" })).toMatchObject({ service: null, location: "78704" });
    for (const bad of [{ service: "Not A Slug" }, { service: "x".repeat(81) }, { location: "not a place" }, { location: "AUSTIN-TX" }, { service: "ac-repair", location: "12" }]) expect(pathQuery({}, bad), JSON.stringify(bad)).toBeUndefined();
  });

  test("what a visitor was looking at is carried to a profile and its booking page as addresses, and only as addresses", () => {
    expect(profileHref("apex", { service: "ac-repair", location: "austin-tx" })).toBe("/listings/apex?service=ac-repair&location=austin-tx");
    expect(profileHref("apex")).toBe("/listings/apex");
    expect(profileHref("apex", { service: null, location: "78704" })).toBe("/listings/apex?location=78704");
    expect(bookingHref("apex", "ac-repair", { service: "ac-repair" })).toBe("/listings/apex/book/ac-repair?service=ac-repair");
    expect(profileHref("apex", { service: "Not A Slug", location: "x".repeat(90) })).toBe("/listings/apex");
    expect(readDiscoveryContext({ service: "ac-repair", location: "austin-tx" })).toEqual({ service: "ac-repair", location: "austin-tx" });
    expect(readDiscoveryContext({ service: "'; drop table bookings; --", location: ["78704"] })).toEqual({ service: null, location: "78704" });
    expect(readDiscoveryContext({})).toEqual({ service: null, location: null });
  });

  test("a review date reads the same everywhere, and the pager links the first, the last and the pages around the current one", () => {
    expect(reviewDate("2024-10-25")).toBe("Oct 25, 2024");
    expect(reviewDate("2024-01-05")).toBe("Jan 5, 2024");
    expect(reviewDate("garbage")).toBe("garbage");
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageWindow(2, 10)).toEqual([1, 2, 3, "gap", 10]);
    expect(pageWindow(10, 10)).toEqual([1, "gap", 9, 10]);
  });
});

test.describe("the database and the application agree on what a city is", () => {
  let admin: Pool;
  test.beforeAll(() => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  });
  test.afterAll(async () => {
    await admin.end();
  });

  test("the key the database generates for a city is the key the application computes, for every spelling", async () => {
    const client = await admin.connect();
    try {
      await client.query("begin");
      const listing = await client.query<{ id: string; organization_id: string }>("select id, organization_id from marketplace_listings where public_slug = 'northstar-heating-cooling'");
      const { id, organization_id: organization } = listing.rows[0];
      await client.query("delete from marketplace_service_areas where listing_id = $1", [id]);
      const cities = ["St. Louis", "st louis", "Winston-Salem", "O'Fallon", "Round Rock", "AUSTIN", "McKinney", "Port St. Lucie", "Coeur d'Alene", "Mt. Pleasant"];
      for (const [index, city] of cities.entries()) {
        // Each city goes in under a state of its own (the unique index would refuse two spellings of one place in one state, which the next test is about).
        const state = `${String.fromCharCode(65 + index)}Z`;
        const stored = await client.query<{ city_key: string }>(
          "insert into marketplace_service_areas (organization_id, listing_id, city, state_region, sort_order) values ($1, $2, $3, $4, $5) returning city_key",
          [organization, id, city, state, index],
        );
        expect(stored.rows[0].city_key, city).toBe(cityKey(city));
      }
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  test("the database refuses a place listed twice however it was spelled, and a city or ZIP of the wrong shape", async () => {
    const client = await admin.connect();
    try {
      await client.query("begin");
      const listing = await client.query<{ id: string; organization_id: string }>("select id, organization_id from marketplace_listings where public_slug = 'northstar-heating-cooling'");
      const { id, organization_id: organization } = listing.rows[0];
      await client.query("delete from marketplace_service_areas where listing_id = $1", [id]);
      const insert = (city: string | null, state: string | null, postal: string | null, label: string | null = null) =>
        client.query("insert into marketplace_service_areas (organization_id, listing_id, city, state_region, postal_code, label, sort_order) values ($1, $2, $3, $4, $5, $6, 0)", [organization, id, city, state, postal, label]);
      const attempt = async (label: string, run: () => Promise<unknown>, constraint: string) => {
        await client.query("savepoint s");
        await expect(run(), label).rejects.toMatchObject({ constraint });
        await client.query("rollback to savepoint s");
      };
      await insert("St. Louis", "MO", null);
      await attempt("the same city spelled another way", () => insert("st louis", "MO", null), "marketplace_service_areas_place_unique");
      await insert("Springfield", "IL", null);
      await insert("Springfield", "MO", null);
      await attempt("a city and a ZIP in one row", () => insert("Austin", "TX", "78704"), "marketplace_service_areas_shape");
      await attempt("neither", () => insert(null, null, null), "marketplace_service_areas_shape");
      await attempt("a ZIP with letters", () => insert(null, null, "7870a"), "marketplace_service_areas_postal");
      await attempt("a state in lower case", () => insert("Austin", "tx", null), "marketplace_service_areas_state");
      await attempt("a city with markup", () => insert("Aus<tin", "TX", null), "marketplace_service_areas_city");
      await attempt("a label that is empty", () => insert("Austin", "TX", null, ""), "marketplace_service_areas_label");
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
