/**
 * Phase 16: saving a Draft as the Website Builder does, against PostgreSQL, committing, on each worker's own copy of the Apex business:
 * what one save stores (the whole content, in order, only the rows that changed), the revision that makes a stale tab's save impossible
 * (kept by triggers, so every write path moves it), what a save refuses whatever sent it, that no identity in a request is ever read, that two
 * saves or a save and a publish at once are serialised, and that nothing a save does reaches a Published version or another business.
 *
 * The standing Apex and Northstar sites are only read here (other workers read them in parallel); everything that changes runs on `workerTenant`.
 */
import { expect } from "playwright/test";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { DEFAULT_TEMPLATE_KEY } from "../src/db/default-template";
import { loadPublicSite } from "../src/db/public-queries";
import { createDraftFromTemplate, createSite, publishSite, replaceDraftWithTemplate, saveSiteDraft, type SiteContext } from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { Refusal } from "../src/lib/refusal";
import {
  addPage,
  addSection,
  changeSectionVariant,
  duplicateSection,
  moveSection,
  movePage,
  pageIn,
  removePage,
  removeSection,
  sectionIn,
  setSectionProp,
  setSectionVisible,
  setServiceDisplay,
  setTheme,
  updatePage,
  type Change,
} from "../src/lib/site-builder";
import { STALE_DRAFT } from "../src/lib/site-builder-rules";
import { MAX_PAGES, MAX_SECTIONS_PER_PAGE, type SiteContent } from "../src/lib/site-template";
import { readDraft, withHeadline } from "./draft-edits";
import { test } from "./fixtures";

type Tenant = { userId: string; organizationId: string; platformSlug: string };

let admin: Pool;
test.beforeAll(() => {
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 6 });
});
test.afterAll(async () => {
  await admin.end();
});

const as = (tenant: Tenant) => ({ userId: tenant.userId, organizationId: tenant.organizationId });

/** Run `work` as the tenant's owner in one transaction. A refused change is returned as `{ refused }` (and rolls the transaction back). */
async function operate<T>(tenant: Tenant, work: (ctx: SiteContext) => Promise<T>): Promise<{ value: T } | { refused: string; fields?: Record<string, string> }> {
  try {
    return { value: await withTenant(as(tenant), (tx) => work({ tx, organizationId: tenant.organizationId })) };
  } catch (error) {
    if (error instanceof Refusal) return { refused: error.message, fields: error.fields };
    throw error;
  }
}

const must = async <T>(tenant: Tenant, work: (ctx: SiteContext) => Promise<T>): Promise<T> => {
  const result = await operate(tenant, work);
  if ("refused" in result) throw new Error(`Unexpectedly refused: ${result.refused}`);
  return result.value;
};

const siteId = async (tenant: Tenant, slug = "main") => (await admin.query<{ id: string }>("select id from sites where organization_id = $1 and slug = $2", [tenant.organizationId, slug])).rows[0].id;
const stored = (tenant: Tenant, site: string) => must(tenant, (ctx) => readDraft(ctx, site));
const revisionOf = async (site: string) => (await admin.query<{ revision: number }>("select revision from site_versions where site_id = $1 and status = 'draft'", [site])).rows[0].revision;
const save = (tenant: Tenant, site: string, revision: unknown, content: unknown) => operate(tenant, (ctx) => saveSiteDraft(ctx, site, { expectedRevision: revision, content }));

/** Content after a series of Builder edits, each of which must be allowed. */
function edit(content: SiteContent, ...steps: ((content: SiteContent) => Change | SiteContent)[]): SiteContent {
  return steps.reduce((current, step) => {
    const result = step(current);
    if ("pages" in result) return result;
    if (!result.ok) throw new Error(`Refused: ${result.error}`);
    return result.content;
  }, content);
}

type Row = { page_key: string; section_key: string; id: string; sort_order: number; type: string; updated_at: Date };
const sectionRows = async (site: string): Promise<Row[]> =>
  (
    await admin.query<Row>(
      `select p.page_key, s.section_key, s.id, s.sort_order, s.type, s.updated_at
         from site_sections s join site_pages p on p.id = s.page_id join site_versions v on v.id = s.site_version_id
        where v.site_id = $1 and v.status = 'draft' order by p.sort_order, s.sort_order`,
      [site],
    )
  ).rows;

type PageRow = { page_key: string; id: string; slug: string; sort_order: number; page_type: string; updated_at: Date };
const pageRows = async (site: string): Promise<PageRow[]> =>
  (
    await admin.query<PageRow>(
      `select p.page_key, p.id, p.slug, p.sort_order, p.page_type, p.updated_at
         from site_pages p join site_versions v on v.id = p.site_version_id where v.site_id = $1 and v.status = 'draft' order by p.sort_order`,
      [site],
    )
  ).rows;

/** The Published version's whole content as stored, for proving a save never touches it. */
async function liveContent(site: string) {
  const live = (await admin.query<{ id: string }>("select published_version_id as id from sites where id = $1", [site])).rows[0].id;
  return (
    await admin.query(
      `select jsonb_build_object('theme', v.theme, 'settings', v.settings, 'pages', coalesce((
          select jsonb_agg(jsonb_build_object('key', p.page_key, 'title', p.title, 'slug', p.slug, 'visible', p.is_visible, 'order', p.sort_order,
            'sections', (select coalesce(jsonb_agg(jsonb_build_object('key', s.section_key, 'label', s.label, 'type', s.type, 'variant', s.variant, 'props', s.props, 'visible', s.is_visible, 'order', s.sort_order) order by s.sort_order), '[]'::jsonb)
                           from site_sections s where s.page_id = p.id)) order by p.sort_order)
            from site_pages p where p.site_version_id = v.id), '[]'::jsonb)) as content
         from site_versions v where v.id = $1`,
      [live],
    )
  ).rows[0].content;
}

/** Everything the standing Northstar site holds, as one fingerprint: a save by another business must never move it. */
const northstarFingerprint = async () =>
  JSON.stringify(
    (
      await admin.query(
        `select md5(string_agg(s.id::text || s.props::text || s.is_visible::text || s.sort_order::text, '|' order by s.id)) as sections,
                (select md5(string_agg(p.id::text || p.slug || p.title || p.sort_order::text, '|' order by p.id)) from site_pages p join organizations o on o.id = p.organization_id where o.slug = 'northstar-heating-cooling') as pages,
                (select string_agg(v.revision::text, ',' order by v.id) from site_versions v join organizations o on o.id = v.organization_id where o.slug = 'northstar-heating-cooling') as revisions
           from site_sections s join organizations o on o.id = s.organization_id where o.slug = 'northstar-heating-cooling'`,
      )
    ).rows,
  );

test.describe("a Draft's revision", () => {
  test("every change to a Draft, made any way at all, moves its revision; reading it or changing a Published version does not", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const draft = (await admin.query<{ id: string }>("select id from site_versions where site_id = $1 and status = 'draft'", [site])).rows[0].id;
    let last = await revisionOf(site);
    expect(last).toBeGreaterThanOrEqual(1);
    const moved = async (label: string) => {
      const now = await revisionOf(site);
      expect(now, label).toBeGreaterThan(last);
      last = now;
    };

    await stored(workerTenant, site);
    expect(await revisionOf(site)).toBe(last);

    await admin.query("update site_sections set props = props || '{\"headline\":\"Moved\"}'::jsonb where site_version_id = $1 and section_key = 'hero' and page_id in (select id from site_pages where page_key = 'home' and site_version_id = $1)", [draft]);
    await moved("a section's text");
    await admin.query("update site_sections set is_visible = not is_visible where site_version_id = $1 and section_key = 'hours' and label = 'Business hours' and page_id in (select id from site_pages where page_key = 'home' and site_version_id = $1)", [draft]);
    await moved("a section's visibility");
    await admin.query("update site_pages set title = 'Retitled' where site_version_id = $1 and page_key = 'about'", [draft]);
    await moved("a page's title");
    await admin.query("update site_versions set theme = theme || '{\"radius\": \"large\"}'::jsonb where id = $1", [draft]);
    await moved("the theme");
    await admin.query("update site_versions set settings = '{\"serviceDisplay\":{\"order\":[\"furnace-safety-inspection\"],\"hidden\":[]}}'::jsonb where id = $1", [draft]);
    await moved("the services list");
    await admin.query("delete from site_sections where site_version_id = $1 and section_key = 'bookingCta' and page_id in (select id from site_pages where page_key = 'about' and site_version_id = $1)", [draft]);
    await moved("a deleted section");
    await admin.query(
      "insert into site_pages (organization_id, site_id, site_version_id, page_key, title, slug, page_type, sort_order) select organization_id, site_id, id, 'extra', 'Extra', 'extra', 'content', 9 from site_versions where id = $1",
      [draft],
    );
    await moved("an added page");

    // A Published version never changes, and its revision stays where it was created.
    const live = (await admin.query<{ revision: number }>("select revision from site_versions where id = (select published_version_id from sites where id = $1)", [site])).rows[0].revision;
    expect(live).toBe(1);
  });

  test("a template replaced onto a Draft moves it too, so a Builder opened before it can no longer save", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const opened = await stored(workerTenant, site);
    await must(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, DEFAULT_TEMPLATE_KEY, { confirmReplace: true }));
    expect(await revisionOf(site)).toBeGreaterThan(opened.revision);
    expect(await save(workerTenant, site, opened.revision, withHeadline(opened.content, "From before"))).toEqual({ refused: STALE_DRAFT, fields: undefined });
  });

  test("the application's database role cannot write the revision itself, only the triggers move it", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await revisionOf(site);
    const error = await withTenant(as(workerTenant), (tx) => tx.execute(sql`update site_versions set revision = 1 where site_id = ${site} and status = 'draft'`)).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).not.toBeNull();
    let code: string | undefined;
    for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) code = (current as { code?: string }).code ?? code;
    expect(code).toBe("42501");
    expect(await revisionOf(site)).toBe(before);
  });
});

test.describe("saving the Draft", () => {
  test("a save stores the whole content in order, only the Draft changes, and saving the same content again writes nothing", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    const liveBefore = await liveContent(site);

    const next = edit(
      before.content,
      (content) => setTheme(content, { accent: "#8B3A1E", radius: "large", density: "compact", headingFont: "serif" }),
      (content) => setServiceDisplay(content, { order: ["furnace-safety-inspection"], hidden: ["annual-cooling-tune-up"] }),
      (content) => updatePage(content, "about", { title: "About us", slug: "about-us" }),
      (content) => addPage(content, "Spring offers"),
      (content) => removePage(content, "contact"),
      (content) => movePage(content, "booking", 1),
      (content) => moveSection(content, "home", "hero", 5),
      (content) => setSectionVisible(content, "home", "hours", false),
      (content) => duplicateSection(content, "home", "why"),
      (content) => addSection(content, "home", "rich_text", "default"),
      (content) => removeSection(content, "home", "bookingCta"),
      (content) => changeSectionVariant(content, "home", "services", "catalog"),
      (content) => setSectionProp(content, "page-1", "page_intro-1", "supportingText", "Seasonal offers, saved."),
    );
    const result = await save(workerTenant, site, before.revision, next);
    expect(result).toMatchObject({ value: { changed: true } });
    const revision = (result as { value: { revision: number } }).value.revision;
    expect(revision).toBeGreaterThan(before.revision);
    expect(await revisionOf(site)).toBe(revision);

    // What is stored is what was sent: the same pages and sections in the same order, with the same text.
    const after = await stored(workerTenant, site);
    expect(after.content).toEqual(next);
    expect(after.revision).toBe(revision);
    expect((await pageRows(site)).map((row) => [row.page_key, row.sort_order])).toEqual([["home", 0], ["booking", 1], ["services", 2], ["about", 3], ["page-1", 4]]);
    expect((await pageRows(site)).find((row) => row.page_key === "page-1")).toMatchObject({ slug: "spring-offers", page_type: "content" });
    const homeSections = pageIn(next, "home")!.sections.map((section) => section.key);
    expect(homeSections).toEqual(["services", "why", "why-copy", "hours", "contact", "hero", "rich_text-1"]);
    expect((await sectionRows(site)).filter((row) => row.page_key === "home").map((row) => [row.section_key, row.sort_order])).toEqual(homeSections.map((key, index) => [key, index]));
    expect((await pageRows(site)).filter((row) => row.slug.startsWith("tmp-"))).toEqual([]);

    // The Published version is exactly what it was, and the public page still shows it.
    expect(await liveContent(site)).toEqual(liveBefore);
    expect((await loadPublicSite(workerTenant.platformSlug, ""))?.page?.sections.find((section) => section.key === "hero")?.props.headline).toBe("Heating & cooling service when you need it.");

    // The same content again writes nothing and leaves the revision where it is.
    expect(await save(workerTenant, site, revision, next)).toEqual({ value: { revision, changed: false } });
    expect(await revisionOf(site)).toBe(revision);
  });

  test("only the rows that changed are written: an edit to one page leaves every other page's rows as they were, with the same identities", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    const rowsBefore = await sectionRows(site);
    const pagesBefore = await pageRows(site);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await save(workerTenant, site, before.revision, withHeadline(before.content, "Only the hero"))).toMatchObject({ value: { changed: true } });
    const rowsAfter = await sectionRows(site);
    expect(rowsAfter.map((row) => row.id)).toEqual(rowsBefore.map((row) => row.id));
    for (const row of rowsAfter) {
      const was = rowsBefore.find((candidate) => candidate.id === row.id)!;
      if (row.page_key === "home" && row.section_key === "hero") expect(row.updated_at.getTime()).toBeGreaterThan(was.updated_at.getTime());
      else expect(row.updated_at.getTime(), `${row.page_key}.${row.section_key}`).toBe(was.updated_at.getTime());
    }
    expect((await pageRows(site)).map((row) => [row.id, row.updated_at.getTime()])).toEqual(pagesBefore.map((row) => [row.id, row.updated_at.getTime()]));
  });

  test("moving, hiding and renaming keep a section's identity; changing its type replaces it", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    const idOf = async (page: string, section: string) => (await sectionRows(site)).find((row) => row.page_key === page && row.section_key === section)!.id;
    const hero = await idOf("home", "hero");
    const intro = await idOf("services", "intro");

    const moved = edit(before.content, (content) => moveSection(content, "home", "hero", 3), (content) => setSectionVisible(content, "home", "hero", false), (content) => setSectionProp(content, "home", "hero", "headline", "Moved and hidden"));
    expect(await save(workerTenant, site, before.revision, moved)).toMatchObject({ value: { changed: true } });
    expect(await idOf("home", "hero")).toBe(hero);

    // The same key with another type is another section: the old row goes and a new one is made.
    const current = await stored(workerTenant, site);
    const retyped: SiteContent = {
      ...current.content,
      pages: current.content.pages.map((page) =>
        page.key !== "services" ? page : { ...page, sections: page.sections.map((section) => (section.key !== "intro" ? section : { key: "intro", label: "Intro now a text block", type: "rich_text", variant: "default", visible: true, props: { heading: "Heading", body: "Body" } })) },
      ),
    };
    expect(await save(workerTenant, site, current.revision, retyped)).toMatchObject({ value: { changed: true } });
    expect(await idOf("services", "intro")).not.toBe(intro);
    expect((await sectionRows(site)).find((row) => row.page_key === "services" && row.section_key === "intro")!.type).toBe("rich_text");
  });

  test("page addresses can be swapped, reused after a deletion and taken from a page that moved, in one save", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    // services <-> about swap addresses; contact is deleted and a new page takes its address; booking takes about's old one's place in order.
    const next = edit(
      before.content,
      (content) => updatePage(content, "services", { slug: "about" }),
      (content) => updatePage(content, "about", { slug: "services" }),
      (content) => removePage(content, "contact"),
      (content) => addPage(content, "Contact"),
    );
    expect(pageIn(next, "page-1")!.slug).toBe("contact");
    expect(await save(workerTenant, site, before.revision, next)).toMatchObject({ value: { changed: true } });
    expect((await pageRows(site)).map((row) => [row.page_key, row.slug])).toEqual([["home", ""], ["services", "about"], ["about", "services"], ["booking", "booking"], ["page-1", "contact"]]);
    expect((await pageRows(site)).filter((row) => row.slug.startsWith("tmp-"))).toEqual([]);
  });

  test("a save with markup, an unknown field or a broken page stores nothing at all, and says where the problem is", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    const result = await save(
      workerTenant,
      site,
      before.revision,
      edit(before.content, (content) => setSectionProp(content, "home", "hero", "headline", "A good change"), (content) => setSectionProp(content, "about", "intro", "supportingText", "<script>alert(1)</script>")),
    );
    expect(result).toMatchObject({ refused: expect.stringContaining("can't be saved yet"), fields: { "about.intro.supportingText": expect.any(String) } });
    expect(await stored(workerTenant, site)).toEqual(before);
  });

  test("what the content check refuses is refused whoever sent it, and each refusal leaves the Draft and its revision exactly as they were", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
    const attempts: Record<string, (content: SiteContent) => unknown> = {
      "the home page deleted": (content) => ({ ...content, pages: content.pages.filter((page) => page.type !== "home") }),
      "the booking page deleted": (content) => ({ ...content, pages: content.pages.filter((page) => page.type !== "booking") }),
      "a page that changes kind": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "services" ? { ...page, type: "content" } : page)) }),
      "the home page moved off the root address": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "home" ? { ...page, slug: "start" } : page)) }),
      "two home pages": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "about" ? { ...page, type: "home", slug: "" } : page)) }),
      "a reserved address": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "about" ? { ...page, slug: "login" } : page)) }),
      "a duplicated address": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "about" ? { ...page, slug: "services" } : page)) }),
      "an address with capitals": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "about" ? { ...page, slug: "About" } : page)) }),
      "a duplicated page key": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "about" ? { ...page, key: "services" } : page)) }),
      "a hidden home page": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "home" ? { ...page, visible: false } : page)) }),
      "a hidden booking page": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "booking" ? { ...page, visible: false } : page)) }),
      "a booking page without a list of Services": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "booking" ? { ...page, sections: page.sections.filter((section) => section.type !== "service_list") } : page)) }),
      "too many pages": (content) => ({ ...content, pages: [...content.pages, ...Array.from({ length: MAX_PAGES }, (_, index) => ({ ...clone(content.pages[2]), key: `p${index}`, slug: `p${index}`, type: "content" }))] }),
      "too many sections": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "about" ? { ...page, sections: Array.from({ length: MAX_SECTIONS_PER_PAGE + 1 }, (_, index) => ({ ...clone(page.sections[0]), key: `s${index}` })) } : page)) }),
      "a section type that does not exist": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "about" ? { ...page, sections: [...page.sections, { key: "x", label: "X", type: "carousel", variant: "default", visible: true, props: {} }] } : page)) }),
      "a variant that does not exist": (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "home" ? { ...page, sections: page.sections.map((section) => (section.key === "hero" ? { ...section, variant: "wide" } : section)) } : page)) }),
      "a theme with CSS": (content) => ({ ...content, theme: { ...content.theme, css: "body{display:none}" } }),
      "an accent that is not a colour": (content) => ({ ...content, theme: { ...content.theme, accent: "red; background:url(x)" } }),
      "a font that is not on the list": (content) => ({ ...content, theme: { ...content.theme, headingFont: "https://example.com/font.woff2" } }),
      "services that are not slugs": (content) => ({ ...content, settings: { serviceDisplay: { order: ["Not A Slug"], hidden: [] } } }),
      "settings with an extra key": (content) => ({ ...content, settings: { ...content.settings, css: "x" } }),
      "no pages at all": (content) => ({ ...content, pages: [] }),
      "content that is not an object": () => "hello",
      "content that is missing": () => undefined,
    };
    for (const [name, make] of Object.entries(attempts)) {
      const result = await save(workerTenant, site, before.revision, make(before.content));
      expect(result, name).toHaveProperty("refused");
      expect((result as { refused: string }).refused, name).not.toMatch(/violates|constraint|postgres|stack|select\s+\w+\s+from/i);
      expect(await stored(workerTenant, site), name).toEqual(before);
    }
  });

  test("the revision a save names must be a whole number the Draft is at: anything else is refused and nothing is stored", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    const content = withHeadline(before.content, "Should not be stored");
    for (const bad of [undefined, null, "1", String(before.revision), 0, -1, before.revision + 0.5, Number.NaN, {}, [before.revision], true]) {
      expect(await save(workerTenant, site, bad, content), JSON.stringify(bad)).toMatchObject({ refused: "The website was not understood." });
    }
    for (const stale of [before.revision - 1, before.revision + 1, 999999]) {
      expect(await save(workerTenant, site, stale, content), String(stale)).toMatchObject({ refused: STALE_DRAFT });
    }
    expect(await stored(workerTenant, site)).toEqual(before);
  });
});

test.describe("a tab that is behind", () => {
  test("a save from a copy that is older than the stored Draft is refused whole, and the newer Draft is not overwritten", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const opened = await stored(workerTenant, site);
    // Another tab saves first.
    const first = await save(workerTenant, site, opened.revision, withHeadline(opened.content, "Saved by the first tab"));
    expect(first).toMatchObject({ value: { changed: true } });
    // The second tab still has the old revision, and edited something else.
    const second = await save(workerTenant, site, opened.revision, edit(opened.content, (content) => setSectionProp(content, "about", "intro", "heading", "From the second tab"), (content) => addPage(content)));
    expect(second).toEqual({ refused: STALE_DRAFT, fields: undefined });
    const now = await stored(workerTenant, site);
    expect(sectionIn(now.content, "home", "hero")!.props.headline).toBe("Saved by the first tab");
    expect(sectionIn(now.content, "about", "intro")!.props.heading).toBe(sectionIn(opened.content, "about", "intro")!.props.heading);
    expect(now.content.pages).toHaveLength(5);
    // After reloading (the new revision) the second tab's save is accepted.
    expect(await save(workerTenant, site, now.revision, edit(now.content, (content) => setSectionProp(content, "about", "intro", "heading", "From the second tab")))).toMatchObject({ value: { changed: true } });
  });

  test("two saves at the same moment are queued: exactly one is stored, the other is told the Draft moved, every time", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    for (let round = 0; round < 5; round += 1) {
      const opened = await stored(workerTenant, site);
      const [a, b] = await Promise.all([
        save(workerTenant, site, opened.revision, withHeadline(opened.content, `Round ${round} A`)),
        save(workerTenant, site, opened.revision, withHeadline(opened.content, `Round ${round} B`)),
      ]);
      const results = [a, b];
      expect(results.filter((result) => "value" in result), `round ${round}`).toHaveLength(1);
      expect(results.filter((result) => "refused" in result && result.refused === STALE_DRAFT), `round ${round}`).toHaveLength(1);
      const winner = "value" in a ? "A" : "B";
      expect(sectionIn((await stored(workerTenant, site)).content, "home", "hero")!.props.headline, `round ${round}`).toBe(`Round ${round} ${winner}`);
    }
  });

  test("publishing names the revision it showed: a Draft that has moved is not published, and nothing is created", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const opened = await stored(workerTenant, site);
    const versions = async () => (await admin.query("select count(*)::int as n from site_versions where site_id = $1", [site])).rows[0].n as number;
    const count = await versions();
    expect(await save(workerTenant, site, opened.revision, withHeadline(opened.content, "Newer than the tab"))).toMatchObject({ value: { changed: true } });

    expect(await operate(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId, { expectedRevision: opened.revision }))).toEqual({ refused: STALE_DRAFT, fields: undefined });
    expect(await versions()).toBe(count);
    expect((await loadPublicSite(workerTenant.platformSlug, ""))?.page?.sections.find((section) => section.key === "hero")?.props.headline).toBe("Heating & cooling service when you need it.");

    const current = await stored(workerTenant, site);
    const published = await must(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId, { expectedRevision: current.revision }));
    expect(published).toMatchObject({ number: 2, changed: true });
    expect(await versions()).toBe(count + 1);
    // Publishing copies the Draft; it does not change it, so the revision is the same and the Builder stays current.
    expect(await revisionOf(site)).toBe(current.revision);
    expect((await loadPublicSite(workerTenant.platformSlug, ""))?.page?.sections.find((section) => section.key === "hero")?.props.headline).toBe("Newer than the tab");
    // Publishing again with nothing new is a no-op that still names its revision.
    expect(await must(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId, { expectedRevision: current.revision }))).toMatchObject({ number: 2, changed: false });
    // And a save after publishing is a Draft newer than the Published version.
    expect(await save(workerTenant, site, current.revision, withHeadline(current.content, "After publishing"))).toMatchObject({ value: { changed: true } });
    expect((await loadPublicSite(workerTenant.platformSlug, ""))?.page?.sections.find((section) => section.key === "hero")?.props.headline).toBe("Newer than the tab");
  });

  test("a publish and a save at the same moment: the published version is the Draft whole, as it was before the save or after it", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    for (let round = 0; round < 4; round += 1) {
      const opened = await stored(workerTenant, site);
      const before = await liveContent(site);
      const changed = withHeadline(opened.content, `Raced ${round}`);
      const [saved, published] = await Promise.all([
        save(workerTenant, site, opened.revision, changed),
        operate(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId, { expectedRevision: opened.revision })),
      ]);
      expect("value" in saved, `round ${round}: the save is stored, whichever came first`).toBe(true);
      const live = await liveContent(site);
      const headline = (content: { pages: { key: string; sections: { key: string; props: Record<string, string> }[] }[] }) => content.pages.find((page) => page.key === "home")!.sections.find((section) => section.key === "hero")!.props.headline;
      if ("value" in published) {
        // The publish ran first: it published the Draft as it was before the save, whole.
        expect(headline(live), `round ${round}`).toBe(sectionIn(opened.content, "home", "hero")!.props.headline);
        expect(headline(live)).not.toBe(`Raced ${round}`);
      } else {
        // The save ran first, so the Draft the publish had been shown was already out of date: it published nothing.
        expect(published).toEqual({ refused: STALE_DRAFT, fields: undefined });
        expect(live).toEqual(before);
      }
    }
  });
});

test.describe("who a save can reach", () => {
  test("nothing in a request names a row: ids, organizations and sites that are sent are never read, and the rows made are this site's own", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    const northstar = await northstarFingerprint();
    const foreign = (await admin.query<{ id: string; organization_id: string; site_id: string; site_version_id: string; page_id: string }>(
      `select s.id, s.organization_id, s.site_id, s.site_version_id, s.page_id from site_sections s join organizations o on o.id = s.organization_id where o.slug = 'northstar-heating-cooling' limit 1`,
    )).rows[0];

    const forged = {
      ...edit(before.content, (content) => setSectionProp(content, "home", "hero", "headline", "Forged identities")),
      organizationId: foreign.organization_id,
      siteId: foreign.site_id,
      siteVersionId: foreign.site_version_id,
    };
    forged.pages = forged.pages.map((page) => ({
      ...page,
      id: foreign.page_id,
      organizationId: foreign.organization_id,
      siteId: foreign.site_id,
      siteVersionId: foreign.site_version_id,
      sections: page.sections.map((section) => ({ ...section, id: foreign.id, organizationId: foreign.organization_id, pageId: foreign.page_id, sortOrder: 99 })),
    })) as typeof forged.pages;

    expect(await save(workerTenant, site, before.revision, forged)).toMatchObject({ value: { changed: true } });
    expect(sectionIn((await stored(workerTenant, site)).content, "home", "hero")!.props.headline).toBe("Forged identities");
    // Every row of this Draft belongs to this business and this site, with ids of its own.
    const rows = (await admin.query<{ organization_id: string; site_id: string; id: string }>("select s.organization_id, s.site_id, s.id from site_sections s join site_versions v on v.id = s.site_version_id where v.site_id = $1 and v.status = 'draft'", [site])).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.organization_id === workerTenant.organizationId && row.site_id === site && row.id !== foreign.id)).toBe(true);
    expect((await sectionRows(site)).filter((row) => row.sort_order === 99)).toEqual([]);
    expect(await northstarFingerprint()).toBe(northstar);
  });

  test("another business's site cannot be saved or published by naming it: it is not there for this business, and it is unchanged", async ({ workerTenant }) => {
    const northstarSite = (await admin.query<{ id: string }>("select s.id from sites s join organizations o on o.id = s.organization_id where o.slug = 'northstar-heating-cooling' and s.is_primary")).rows[0].id;
    const northstarOrg = (await admin.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    const content = withHeadline((await stored(workerTenant, await siteId(workerTenant))).content, "Stolen");
    const before = await northstarFingerprint();
    const revision = (await revisionOf(northstarSite)) as number;

    const asWorker = await operate(workerTenant, (ctx) => saveSiteDraft(ctx, northstarSite, { expectedRevision: revision, content }));
    expect(asWorker).toMatchObject({ refused: expect.stringContaining("no longer exists") });
    // Even with the other business's id in the context (a bug elsewhere), the database's own policy hides the rows.
    const lying = await operate(workerTenant, (ctx) => saveSiteDraft({ tx: ctx.tx, organizationId: northstarOrg }, northstarSite, { expectedRevision: revision, content }));
    expect(lying).toMatchObject({ refused: expect.stringContaining("no longer exists") });
    expect(await operate(workerTenant, (ctx) => publishSite({ tx: ctx.tx, organizationId: northstarOrg }, northstarSite, workerTenant.userId))).toMatchObject({ refused: expect.stringContaining("no longer exists") });
    expect(await northstarFingerprint()).toBe(before);
  });

  test("a site with no Draft cannot be saved, and a site's own Draft is the only one a save can reach", async ({ workerTenant }) => {
    const empty = await must(workerTenant, (ctx) => createSite(ctx.tx, ctx.organizationId, { name: "No draft", slug: "no-draft", platformSlug: `${workerTenant.platformSlug}-nodraft` }));
    const content = (await stored(workerTenant, await siteId(workerTenant))).content;
    expect(await save(workerTenant, empty, 1, content)).toMatchObject({ refused: "This website has no draft yet." });
  });
});

test.describe("big sites, and more than one Site", () => {
  test("a site at the page limit with pages at the section limit saves, reorders and reloads exactly", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    let content = before.content;
    while (content.pages.length < MAX_PAGES) content = edit(content, (current) => addPage(current));
    for (const page of content.pages) {
      if (page.type === "home") continue;
      let guard = 0;
      while (pageIn(content, page.key)!.sections.length < MAX_SECTIONS_PER_PAGE && guard++ < 60) content = edit(content, (current) => addSection(current, page.key, "rich_text", "default"));
    }
    const startedAt = Date.now();
    const first = await save(workerTenant, site, before.revision, content);
    expect(first).toMatchObject({ value: { changed: true } });
    expect(Date.now() - startedAt).toBeLessThan(20_000);
    expect((await stored(workerTenant, site)).content).toEqual(content);

    // Reverse every page's sections and the order of the pages after Home: one save, every order stored.
    const reversed: SiteContent = {
      ...content,
      pages: [content.pages[0], ...content.pages.slice(1).reverse()].map((page) => ({ ...page, sections: [...page.sections].reverse() })),
    };
    const current = await stored(workerTenant, site);
    expect(await save(workerTenant, site, current.revision, reversed)).toMatchObject({ value: { changed: true } });
    expect((await stored(workerTenant, site)).content).toEqual(reversed);
    expect((await pageRows(site)).map((row) => row.sort_order)).toEqual(Array.from({ length: MAX_PAGES }, (_, index) => index));
  });

  test("thirty sections on one page: add, reorder the last to the first, hide, delete and save, and the stored order is the edited order", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await stored(workerTenant, site);
    let content = before.content;
    while (pageIn(content, "home")!.sections.length < 30) content = edit(content, (current) => addSection(current, "home", "feature_list", "plain"));
    content = edit(content, (current) => moveSection(current, "home", "feature_list-24", 0), (current) => setSectionVisible(current, "home", "feature_list-3", false), (current) => removeSection(current, "home", "feature_list-7"));
    expect(await save(workerTenant, site, before.revision, content)).toMatchObject({ value: { changed: true } });
    const keys = (await sectionRows(site)).filter((row) => row.page_key === "home").map((row) => row.section_key);
    expect(keys).toEqual(pageIn(content, "home")!.sections.map((section) => section.key));
    expect(keys[0]).toBe("feature_list-24");
    expect(keys).not.toContain("feature_list-7");
    expect(sectionIn((await stored(workerTenant, site)).content, "home", "feature_list-3")!.visible).toBe(false);
  });

  test("a second Site has its own revision and its own saves: saving one never moves, stales or changes the other", async ({ workerTenant }) => {
    const first = await siteId(workerTenant);
    const second = await must(workerTenant, async (ctx) => {
      const id = await createSite(ctx.tx, ctx.organizationId, { name: "Second site", slug: "second", platformSlug: `${workerTenant.platformSlug}-second` });
      await createDraftFromTemplate(ctx, id, DEFAULT_TEMPLATE_KEY);
      return id;
    });
    const a = await stored(workerTenant, first);
    const b = await stored(workerTenant, second);
    expect(await save(workerTenant, first, a.revision, withHeadline(a.content, "First site only"))).toMatchObject({ value: { changed: true } });
    expect(await revisionOf(second)).toBe(b.revision);
    expect(await stored(workerTenant, second)).toEqual(b);
    expect(await save(workerTenant, second, b.revision, edit(b.content, (content) => setTheme(content, { accent: "#1F5FAF" }), (content) => addPage(content, "Only here")))).toMatchObject({ value: { changed: true } });
    const afterFirst = await stored(workerTenant, first);
    expect(afterFirst.content.pages).toHaveLength(5);
    expect(afterFirst.content.theme.accent).toBeNull();
    expect((await stored(workerTenant, second)).content.pages).toHaveLength(6);
  });
});
