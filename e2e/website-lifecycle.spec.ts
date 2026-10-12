/**
 * Phase 15: the Website's operations as the application's database layer runs them, committing, on each worker's own copy of the Apex
 * business: creating a Draft from the template, saving a page, publishing (what it copies, that it is atomic, that two at once are safe),
 * making a Site private, replacing a Draft with a template on purpose, and a business with more than one Site whose Drafts, pages,
 * sections, themes, published versions and numbers are independent.
 *
 * The standing Apex and Northstar sites are only ever read here (other workers read them in parallel); everything that changes
 * runs on `workerTenant`, which is put back before every test.
 */
import { expect } from "playwright/test";
import { Pool } from "pg";
import { canonicalContent, orderedPages, type WebsiteState } from "../src/data/website";
import { DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_KEY } from "../src/db/default-template";
import { loadPublicSite } from "../src/db/public-queries";
import {
  connectCustomDomain,
  createDraftFromTemplate,
  createSite,
  findPrimarySite,
  listPublishedVersions,
  listSites,
  loadPrimaryWebsite,
  loadWebsiteState,
  publishSite,
  removeCustomDomain,
  replaceDraftWithTemplate,
  setPrimaryAddress,
  unpublishSite,
  type SiteContext,
} from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { Refusal } from "../src/lib/refusal";
import { setServiceDisplay } from "../src/lib/site-builder";
import { APEX_CONTENT, NORTHSTAR_CONTENT } from "./apex-data";
import type { SiteContent } from "../src/lib/site-template";
import { editDraft, editSection, readDraft, saveContent, setHeadlineOf } from "./draft-edits";
import { test } from "./fixtures";
import { versionOf } from "./website-edits";

type Tenant = { userId: string; organizationId: string; platformSlug: string };

let admin: Pool;
test.beforeAll(() => {
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
});
test.afterAll(async () => {
  await admin.end();
});

/** Run `work` as the tenant's owner in one transaction. A refused change is returned as `{ refused }` (and rolls the transaction back). */
async function operate<T>(tenant: Tenant, work: (ctx: SiteContext) => Promise<T>): Promise<{ value: T } | { refused: string }> {
  try {
    return { value: await withTenant({ userId: tenant.userId, organizationId: tenant.organizationId }, (tx) => work({ tx, organizationId: tenant.organizationId })) };
  } catch (error) {
    if (error instanceof Refusal) return { refused: error.message };
    throw error;
  }
}

const must = async <T>(tenant: Tenant, work: (ctx: SiteContext) => Promise<T>): Promise<T> => {
  const result = await operate(tenant, work);
  if ("refused" in result) throw new Error(`Unexpectedly refused: ${result.refused}`);
  return result.value;
};

/** The name of the constraint a failed statement violated (pg's error, or Drizzle's wrapper around it). */
const constraintOf = (error: unknown): string => {
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    const candidate = current as { code?: string; constraint?: string };
    if (candidate.code && /^23/.test(candidate.code) && candidate.constraint) return candidate.constraint;
  }
  return "other";
};

const siteId = async (tenant: Tenant, slug = "main") => (await admin.query<{ id: string }>("select id from sites where organization_id = $1 and slug = $2", [tenant.organizationId, slug])).rows[0].id;

/** A version's whole content as stored, without ids or times, for comparing two versions or one version before and after. */
async function contentOf(versionId: string) {
  const result = await admin.query<{ content: unknown }>(
    `select jsonb_build_object('theme', v.theme, 'settings', v.settings, 'pages', coalesce((
        select jsonb_agg(jsonb_build_object('key', p.page_key, 'title', p.title, 'slug', p.slug, 'type', p.page_type, 'visible', p.is_visible, 'order', p.sort_order,
          'sections', (select coalesce(jsonb_agg(jsonb_build_object('key', s.section_key, 'label', s.label, 'type', s.type, 'variant', s.variant, 'props', s.props, 'visible', s.is_visible, 'order', s.sort_order) order by s.sort_order), '[]'::jsonb)
                         from site_sections s where s.page_id = p.id)) order by p.sort_order)
          from site_pages p where p.site_version_id = v.id), '[]'::jsonb)) as content
       from site_versions v where v.id = $1`,
    [versionId],
  );
  return result.rows[0].content;
}

const versionsOf = async (site: string) =>
  (await admin.query<{ id: string; status: string; version_number: number | null; published_by_user_id: string | null; published_at: Date | null }>(
    "select id, status, version_number, published_by_user_id, published_at from site_versions where site_id = $1 order by version_number nulls last",
    [site],
  )).rows;

const siteRow = async (site: string) =>
  (await admin.query<{ status: string; published_version_id: string | null; is_primary: boolean; selected_template_id: string | null }>(
    "select status, published_version_id, is_primary, selected_template_id from sites where id = $1",
    [site],
  )).rows[0];

const draftOf = async (site: string) => (await versionsOf(site)).find((version) => version.status === "draft")!;
const liveOf = async (site: string) => {
  const row = await siteRow(site);
  return (await versionsOf(site)).find((version) => version.id === row.published_version_id);
};

/** The home page's hero props as stored in the Draft of `site`, to be edited (every field is required when a section is saved). */
async function heroProps(site: string): Promise<Record<string, string>> {
  const draft = await draftOf(site);
  const result = await admin.query<{ props: Record<string, string> }>(
    "select s.props from site_sections s join site_pages p on p.id = s.page_id where p.site_version_id = $1 and p.page_key = 'home' and s.section_key = 'hero'",
    [draft.id],
  );
  return result.rows[0].props;
}

async function setHeadline(tenant: Tenant, site: string, headline: string) {
  await must(tenant, (ctx) => setHeadlineOf(ctx, site, headline));
}

const liveHero = async (site: string) => {
  const live = (await liveOf(site))!;
  return (await admin.query<{ props: unknown }>("select s.props from site_sections s join site_pages p on p.id = s.page_id where p.site_version_id = $1 and p.page_key = 'home' and s.section_key = 'hero'", [live.id])).rows[0].props;
};

const publishedHeadline = async (platformSlug: string) => {
  const site = await loadPublicSite(platformSlug, "");
  return site?.page?.sections.find((section) => section.key === "hero")?.props.headline;
};

test.describe("publishing", () => {
  test("publishing copies the Draft into a new immutable Published version, stamps who and when, and points the Site at it", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const original = await liveOf(site);
    const originalContent = await contentOf(original!.id);
    expect((await versionsOf(site)).map((version) => [version.status, version.version_number])).toEqual([["published", 1], ["draft", null]]);

    await setHeadline(workerTenant, site, "Cooler homes, fair prices");
    const published = await must(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId));
    expect(published).toMatchObject({ number: 2, changed: true });

    const versions = await versionsOf(site);
    expect(versions.map((version) => [version.status, version.version_number])).toEqual([["published", 1], ["published", 2], ["draft", null]]);
    const second = versions[1];
    expect(second.published_by_user_id).toBe(workerTenant.userId);
    expect(second.published_at).not.toBeNull();
    expect(second.id).toBe(published.versionId);
    expect(await siteRow(site)).toMatchObject({ status: "published", published_version_id: second.id });
    // The snapshot is exactly the Draft; the earlier version is exactly what it was.
    expect(await contentOf(second.id)).toEqual(await contentOf((await draftOf(site)).id));
    expect(await contentOf(original!.id)).toEqual(originalContent);
    // A copy, not a link: its pages and sections are rows of their own.
    const shared = await admin.query<{ n: number }>(
      "select count(*)::int as n from site_pages a join site_pages b on a.id = b.id where a.site_version_id = $1 and b.site_version_id = $2",
      [second.id, (await draftOf(site)).id],
    );
    expect(shared.rows[0].n).toBe(0);
    expect(await publishedHeadline(workerTenant.platformSlug)).toBe("Cooler homes, fair prices");
  });

  test("publishing what is already live changes nothing: no new version and the same number", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const again = await must(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId));
    expect(again).toMatchObject({ number: 1, changed: false });
    expect((await versionsOf(site)).length).toBe(2);
  });

  test("editing the Draft after publishing never changes any Published version, in storage or on the public page", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    await setHeadline(workerTenant, site, "Version two headline");
    await must(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId));
    const [first, second] = (await versionsOf(site)).filter((version) => version.status === "published");
    const [firstContent, secondContent] = [await contentOf(first.id), await contentOf(second.id)];

    await setHeadline(workerTenant, site, "Only a draft");
    await must(workerTenant, (ctx) => editDraft(ctx, site, (content) => setServiceDisplay(content, { order: [], hidden: ["furnace-safety-inspection"] })));
    expect(await contentOf(first.id)).toEqual(firstContent);
    expect(await contentOf(second.id)).toEqual(secondContent);
    expect(await publishedHeadline(workerTenant.platformSlug)).toBe("Version two headline");
    const state = await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, (tx) => loadPrimaryWebsite(tx, workerTenant.organizationId));
    expect(state?.live?.number).toBe(2);
    expect(canonicalContent(state!.draft)).not.toBe(canonicalContent(state!.live!));
  });

  test("a Draft that is not valid cannot be published, and nothing about the Site changes", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const draft = await draftOf(site);
    const home = (await admin.query<{ id: string }>("select id from site_pages where site_version_id = $1 and page_key = 'home'", [draft.id])).rows[0].id;
    const before = { versions: await versionsOf(site), site: await siteRow(site) };
    const broken = [
      // A section type this application does not have.
      () => admin.query("insert into site_sections (organization_id, site_id, site_version_id, page_id, section_key, label, type, variant, props, sort_order) values ($1, $2, $3, $4, 'extra', 'Extra', 'carousel', 'default', '{}', 9)", [workerTenant.organizationId, site, draft.id, home]),
      // A variant it does not have.
      () => admin.query("update site_sections set variant = 'fancy' where page_id = $1 and section_key = 'hero'", [home]),
      // Markup in a section's text.
      () => admin.query("update site_sections set props = props || '{\"headline\": \"<script>alert(1)</script>\"}'::jsonb where page_id = $1 and section_key = 'hero'", [home]),
    ];
    for (const damage of broken) {
      await damage();
      const refused = await operate(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId));
      expect(refused).toMatchObject({ refused: expect.stringContaining("can't be published yet") });
      expect(await versionsOf(site)).toEqual(before.versions);
      expect(await siteRow(site)).toEqual(before.site);
      await admin.query("delete from site_sections where page_id = $1 and section_key = 'extra'", [home]);
      await admin.query("update site_sections set variant = 'default', props = $2::jsonb where page_id = $1 and section_key = 'hero'", [home, JSON.stringify(await liveHero(site))]);
    }
  });

  test("a failure after the work rolls the whole publish back: no version, no pages, no pointer change", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    await setHeadline(workerTenant, site, "Never published");
    const before = { versions: await versionsOf(site), site: await siteRow(site), pages: (await admin.query("select count(*)::int as n from site_pages where site_id = $1", [site])).rows[0].n, sections: (await admin.query("select count(*)::int as n from site_sections where site_id = $1", [site])).rows[0].n };
    await expect(
      withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, async (tx) => {
        await publishSite({ tx, organizationId: workerTenant.organizationId }, site, workerTenant.userId);
        throw new Error("the transaction fails after the work");
      }),
    ).rejects.toThrow("fails after");
    expect(await versionsOf(site)).toEqual(before.versions);
    expect(await siteRow(site)).toEqual(before.site);
    expect((await admin.query("select count(*)::int as n from site_pages where site_id = $1", [site])).rows[0].n).toBe(before.pages);
    expect((await admin.query("select count(*)::int as n from site_sections where site_id = $1", [site])).rows[0].n).toBe(before.sections);
    expect(await publishedHeadline(workerTenant.platformSlug)).not.toBe("Never published");
  });

  test("a member of the business cannot publish, and neither can a person from another business", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const jamie = (await admin.query<{ id: string }>("select id from auth_user where email = 'jamie.rivera@apex.test'")).rows[0].id;
    const taylor = (await admin.query<{ id: string }>("select id from auth_user where email = 'taylor.brooks@northstar.test'")).rows[0].id;
    await setHeadline(workerTenant, site, "Unauthorised");
    for (const outsider of [jamie, taylor]) {
      // Not members of this copy of the business at all: they see no Site, so nothing can be published.
      const result = await operate({ ...workerTenant, userId: outsider }, (ctx) => publishSite(ctx, site, outsider));
      expect(result).toMatchObject({ refused: expect.stringMatching(/no longer exists|no draft/) });
    }
    expect((await versionsOf(site)).length).toBe(2);
  });

  test("two publishes at once of the same Draft make one new version: deterministic numbers, no gap, no duplicate", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    await setHeadline(workerTenant, site, "Published twice at once");
    const results = await Promise.all(Array.from({ length: 6 }, () => operate(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId))));
    const values = results.map((result) => ("value" in result ? result.value : undefined));
    expect(values.every((value) => value !== undefined)).toBe(true);
    expect(values.filter((value) => value?.changed)).toHaveLength(1);
    expect(new Set(values.map((value) => value?.number))).toEqual(new Set([2]));
    expect((await versionsOf(site)).filter((version) => version.status === "published").map((version) => version.version_number)).toEqual([1, 2]);
    const live = await liveOf(site);
    expect(live?.version_number).toBe(2);
    expect(await publishedHeadline(workerTenant.platformSlug)).toBe("Published twice at once");
  });

  test("edits and publishes in turn, each publish raced by another, number the versions 1, 2, 3 ... and each holds the edit made before it", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    for (const round of [1, 2, 3, 4]) {
      await setHeadline(workerTenant, site, `Round ${round}`);
      const pair = await Promise.all([operate(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId)), operate(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId))]);
      const numbers = pair.map((result) => ("value" in result ? result.value.number : -1));
      expect(numbers).toEqual([round + 1, round + 1]);
    }
    const published = (await versionsOf(site)).filter((version) => version.status === "published");
    expect(published.map((version) => version.version_number)).toEqual([1, 2, 3, 4, 5]);
    for (const [index, version] of published.entries()) {
      if (index === 0) continue;
      const content = (await contentOf(version.id)) as { pages: { key: string; sections: { key: string; props: { headline?: string } }[] }[] };
      const hero = content.pages.find((page) => page.key === "home")!.sections.find((section) => section.key === "hero")!;
      expect(hero.props.headline).toBe(`Round ${index}`);
    }
  });

  test("a publish racing a save sees the Draft whole: the snapshot is the Draft as it was before or after the save, never a mixture", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const props = await heroProps(site);
    await setHeadline(workerTenant, site, "Before the save");
    const [save, publish] = await Promise.all([
      operate(workerTenant, (ctx) => editDraft(ctx, site, (content) => editSection(content, "home", "hero", { props: { headline: "After the save", primaryCta: "Call now" } }))),
      operate(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId)),
    ]);
    expect("value" in save && "value" in publish).toBe(true);
    const live = (await liveOf(site))!;
    const hero = ((await contentOf(live.id)) as { pages: { key: string; sections: { key: string; props: Record<string, string> }[] }[] }).pages.find((page) => page.key === "home")!.sections.find((section) => section.key === "hero")!;
    const before = hero.props.headline === "Before the save" && hero.props.primaryCta === props.primaryCta;
    const after = hero.props.headline === "After the save" && hero.props.primaryCta === "Call now";
    expect(before || after).toBe(true);
  });

  test("making the Site private stops it being served and keeps every version; publishing again numbers the next one", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    await must(workerTenant, (ctx) => unpublishSite(ctx, site));
    expect(await siteRow(site)).toMatchObject({ status: "draft", published_version_id: null });
    expect(await loadPublicSite(workerTenant.platformSlug, "")).toBeNull();
    expect((await versionsOf(site)).map((version) => [version.status, version.version_number])).toEqual([["published", 1], ["draft", null]]);
    const again = await must(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId));
    expect(again).toMatchObject({ number: 2, changed: true });
    expect(await loadPublicSite(workerTenant.platformSlug, "")).not.toBeNull();
    const history = await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, (tx) => listPublishedVersions(tx, workerTenant.organizationId, site));
    expect(history.map((entry) => entry.number)).toEqual([2, 1]);
  });
});

test.describe("saving a page of the Draft", () => {
  test("a save stores the text and visibility, validated against the section's type; the Published version is untouched", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const props = await heroProps(site);
    await must(workerTenant, (ctx) => editDraft(ctx, site, (content) => editSection(content, "home", "hero", { visible: false, props: { ...props, headline: "Saved headline" } })));
    const row = await admin.query<{ is_visible: boolean; props: Record<string, string> }>(
      "select s.is_visible, s.props from site_sections s join site_pages p on p.id = s.page_id where p.site_version_id = $1 and p.page_key = 'home' and s.section_key = 'hero'",
      [(await draftOf(site)).id],
    );
    expect(row.rows[0]).toMatchObject({ is_visible: false, props: { headline: "Saved headline" } });
    expect(await publishedHeadline(workerTenant.platformSlug)).toBe("Heating & cooling service when you need it.");
  });

  test("a save with markup, an unknown field, a missing field, an unknown section type or a broken page is refused whole", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const draft = await contentOf((await draftOf(site)).id);
    const hero = (content: SiteContent, patch: { visible?: boolean; props?: Record<string, string> }) => editSection(content, "home", "hero", patch);
    const attempts: Record<string, (content: SiteContent) => unknown> = {
      markup: (content) => hero(content, { props: { headline: "<img src=x onerror=alert(1)>" } }),
      "script address": (content) => hero(content, { props: { headline: "javascript:alert(1)" } }),
      "unknown field": (content) => hero(content, { props: { onClick: "x" } }),
      "empty required text": (content) => hero(content, { props: { headline: "" } }),
      "visibility that is not a boolean": (content) => hero(content, { visible: "yes" as never }),
      "unknown section type": (content) => ({
        ...content,
        pages: content.pages.map((page) => (page.key !== "home" ? page : { ...page, sections: [...page.sections, { key: "nope", label: "Nope", type: "carousel", variant: "default", visible: true, props: {} }] })),
      }),
      // One good section and one bad one: nothing is stored.
      "one good section and one bad": (content) =>
        editSection(hero(content, { props: { headline: "Good" } }), "home", "bookingCta", { props: { heading: "<b>x</b>" } }),
      "no pages": (content) => ({ ...content, pages: [] }),
    };
    for (const [name, make] of Object.entries(attempts)) {
      const result = await operate(workerTenant, async (ctx) => saveContent(ctx, site, make((await readDraft(ctx, site)).content)));
      expect(result, name).toHaveProperty("refused");
      expect(await contentOf((await draftOf(site)).id), name).toEqual(draft);
    }
  });

  test("the list of Services the site shows is stored as references and validated; the Services themselves are not touched", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const services = JSON.stringify((await admin.query("select slug, name, price_amount, is_active, visibility from services where organization_id = $1 order by slug", [workerTenant.organizationId])).rows);
    await must(workerTenant, (ctx) => editDraft(ctx, site, (content) => setServiceDisplay(content, { order: ["furnace-safety-inspection"], hidden: ["annual-cooling-tune-up"] })));
    const settings = (await admin.query<{ settings: unknown }>("select settings from site_versions where id = $1", [(await draftOf(site)).id])).rows[0].settings;
    expect(settings).toEqual({ serviceDisplay: { order: ["furnace-safety-inspection"], hidden: ["annual-cooling-tune-up"] } });
    for (const bad of [null, "x", [], { order: "x", hidden: [] }, { order: ["Not A Slug"], hidden: [] }, { order: [], hidden: [5] }]) {
      const result = await operate(workerTenant, async (ctx) => {
        const { content } = await readDraft(ctx, site);
        return saveContent(ctx, site, { ...content, settings: { serviceDisplay: bad } });
      });
      expect(result, JSON.stringify(bad)).toHaveProperty("refused");
    }
    expect(JSON.stringify((await admin.query("select slug, name, price_amount, is_active, visibility from services where organization_id = $1 order by slug", [workerTenant.organizationId])).rows)).toBe(services);
  });
});

test.describe("more than one Site in a business", () => {
  const secondSlug = (tenant: Tenant) => `${tenant.platformSlug}-second`;

  test("a second Site has its own Draft, pages, sections, theme and published history, and the first is untouched by anything done to it", async ({ workerTenant }) => {
    const first = await siteId(workerTenant);
    const firstLive = (await liveOf(first))!;
    const firstSnapshot = { live: await contentOf(firstLive.id), draft: await contentOf((await draftOf(first)).id), site: await siteRow(first) };

    const second = await must(workerTenant, async (ctx) => {
      const id = await createSite(ctx.tx, ctx.organizationId, { name: "Second site", slug: "second", platformSlug: secondSlug(workerTenant) });
      await createDraftFromTemplate(ctx, id, DEFAULT_TEMPLATE_KEY);
      return id;
    });
    // The first is the primary one, and a new Site is never primary by accident.
    expect(await siteRow(first)).toMatchObject({ is_primary: true });
    expect(await siteRow(second)).toMatchObject({ is_primary: false, status: "draft", published_version_id: null });
    expect((await versionsOf(second)).map((version) => [version.status, version.version_number])).toEqual([["draft", null]]);
    expect(await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, async (tx) => (await findPrimarySite(tx, workerTenant.organizationId))?.id)).toBe(first);
    expect((await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, (tx) => listSites(tx, workerTenant.organizationId))).map((site) => site.slug).sort()).toEqual(["commercial", "main", "second"]);

    // The same page keys, different rows.
    const homes = await admin.query<{ id: string }>("select id from site_pages where page_key = 'home' and site_version_id = any($1)", [[(await draftOf(first)).id, (await draftOf(second)).id]]);
    expect(new Set(homes.rows.map((row) => row.id)).size).toBe(2);
    expect((await admin.query("select count(*)::int as n from site_pages where site_version_id = $1", [(await draftOf(second)).id])).rows[0].n).toBe(5);

    // Edit and publish the second only.
    await setHeadline(workerTenant, second, "The second site's headline");
    await admin.query("update site_versions set theme = theme || '{\"accent\": \"#1F5FAF\"}'::jsonb where id = $1", [(await draftOf(second)).id]);
    const published = await must(workerTenant, (ctx) => publishSite(ctx, second, workerTenant.userId));
    expect(published).toMatchObject({ number: 1, changed: true }); // numbers are per Site

    expect(await publishedHeadline(secondSlug(workerTenant))).toBe("The second site's headline");
    expect(await publishedHeadline(workerTenant.platformSlug)).toBe("Heating & cooling service when you need it.");
    expect((await loadPublicSite(secondSlug(workerTenant), ""))?.version.theme.accent).toBe("#1F5FAF");
    expect((await loadPublicSite(workerTenant.platformSlug, ""))?.version.theme.accent).toBeNull();

    // Nothing of the first changed.
    expect(await contentOf(firstLive.id)).toEqual(firstSnapshot.live);
    expect(await contentOf((await draftOf(first)).id)).toEqual(firstSnapshot.draft);
    expect(await siteRow(first)).toEqual(firstSnapshot.site);
    expect((await versionsOf(first)).length).toBe(2);

    // And back: editing and publishing the first leaves the second as it was.
    const secondLive = (await liveOf(second))!;
    const secondContent = await contentOf(secondLive.id);
    await setHeadline(workerTenant, first, "The first site again");
    await must(workerTenant, (ctx) => publishSite(ctx, first, workerTenant.userId));
    expect(await contentOf(secondLive.id)).toEqual(secondContent);
    expect(await publishedHeadline(secondSlug(workerTenant))).toBe("The second site's headline");
    expect((await versionsOf(second)).filter((version) => version.status === "published")).toHaveLength(1);

    // Making one private leaves the other served.
    await must(workerTenant, (ctx) => unpublishSite(ctx, second));
    expect(await loadPublicSite(secondSlug(workerTenant), "")).toBeNull();
    expect(await loadPublicSite(workerTenant.platformSlug, "")).not.toBeNull();
  });

  test("a second Site chooses its own template and domain record; the first keeps its own", async ({ workerTenant }) => {
    const first = await siteId(workerTenant);
    const second = await must(workerTenant, (ctx) => createSite(ctx.tx, ctx.organizationId, { name: "Second site", slug: "second", platformSlug: secondSlug(workerTenant) }));
    // Before it has a Draft, a Site has chosen no template.
    expect((await siteRow(second)).selected_template_id).toBeNull();
    const template = (await admin.query<{ id: string }>("select id from site_templates where key = $1", [DEFAULT_TEMPLATE_KEY])).rows[0].id;
    expect((await siteRow(first)).selected_template_id).toBe(template);
    await must(workerTenant, (ctx) => createDraftFromTemplate(ctx, second, DEFAULT_TEMPLATE_KEY));
    expect((await siteRow(second)).selected_template_id).toBe(template);

    await must(workerTenant, (ctx) => connectCustomDomain(ctx, second, "www.second-example.com"));
    const domains = await admin.query<{ slug: string; custom_domain: string | null; custom_domain_status: string | null }>(
      "select slug, custom_domain, custom_domain_status from sites where organization_id = $1 order by slug",
      [workerTenant.organizationId],
    );
    expect(domains.rows).toEqual([
      { slug: "commercial", custom_domain: null, custom_domain_status: null },
      { slug: "main", custom_domain: "www.apexclimateair.com", custom_domain_status: "configured" },
      { slug: "second", custom_domain: "www.second-example.com", custom_domain_status: "pending_verification" },
    ]);
  });

  test("a Site's public address is globally unique and cannot be taken, and a second primary Site is impossible", async ({ workerTenant }) => {
    const attempt = (input: { name: string; slug: string; platformSlug: string; isPrimary?: boolean }) =>
      withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, (tx) => createSite(tx, workerTenant.organizationId, input)).then(
        () => "created",
        (error: unknown) => constraintOf(error),
      );
    expect(await attempt({ name: "Thief", slug: "thief", platformSlug: "northstar" })).toBe("sites_platform_slug_unique");
    expect(await attempt({ name: "Second primary", slug: "also-primary", platformSlug: secondSlug(workerTenant), isPrimary: true })).toBe("sites_primary_unique");
    expect(await attempt({ name: "Reserved", slug: "reserved", platformSlug: "admin" })).toBe("sites_platform_slug_format");
    expect(await attempt({ name: "Same slug", slug: "main", platformSlug: secondSlug(workerTenant) })).toBe("sites_org_slug_unique");
    expect(await attempt({ name: "Fine", slug: "fine", platformSlug: secondSlug(workerTenant) })).toBe("created");
  });

  test("two Sites can be published at the same moment, each numbered on its own", async ({ workerTenant }) => {
    const first = await siteId(workerTenant);
    const second = await must(workerTenant, async (ctx) => {
      const id = await createSite(ctx.tx, ctx.organizationId, { name: "Second site", slug: "second", platformSlug: secondSlug(workerTenant) });
      await createDraftFromTemplate(ctx, id, DEFAULT_TEMPLATE_KEY);
      return id;
    });
    await setHeadline(workerTenant, first, "First at once");
    await setHeadline(workerTenant, second, "Second at once");
    const [a, b] = await Promise.all([
      operate(workerTenant, (ctx) => publishSite(ctx, first, workerTenant.userId)),
      operate(workerTenant, (ctx) => publishSite(ctx, second, workerTenant.userId)),
    ]);
    expect(a).toMatchObject({ value: { number: 2, changed: true } });
    expect(b).toMatchObject({ value: { number: 1, changed: true } });
    expect(await publishedHeadline(workerTenant.platformSlug)).toBe("First at once");
    expect(await publishedHeadline(secondSlug(workerTenant))).toBe("Second at once");
  });
});

test.describe("applying a template", () => {
  test("a new Site gets a Draft from the default template, once; a Site that has one is refused", async ({ workerTenant }) => {
    const id = await must(workerTenant, (ctx) => createSite(ctx.tx, ctx.organizationId, { name: "Fresh", slug: "fresh", platformSlug: `${workerTenant.platformSlug}-fresh` }));
    expect(await operate(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, id, DEFAULT_TEMPLATE_KEY, { confirmReplace: true }))).toMatchObject({ refused: "This website has no draft to replace." });
    expect(await operate(workerTenant, (ctx) => createDraftFromTemplate(ctx, id, "no-such-template"))).toMatchObject({ refused: "That website template is not available." });
    expect(await versionsOf(id)).toHaveLength(0);

    await must(workerTenant, (ctx) => createDraftFromTemplate(ctx, id, DEFAULT_TEMPLATE_KEY));
    const draft = await draftOf(id);
    // The Draft is the template, word for word: neutral copy, no business named anywhere in it.
    expect(draft.status).toBe("draft");
    const state = await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, async (tx) => {
      const site = (await listSites(tx, workerTenant.organizationId)).find((candidate) => candidate.id === id)!;
      return loadWebsiteState(tx, workerTenant.organizationId, site);
    });
    expect(canonicalContent(state!.draft)).toBe(canonicalContent(versionOf(DEFAULT_TEMPLATE)));
    expect(state?.published).toBe(false);
    expect(JSON.stringify(state)).not.toMatch(/Apex|Austin|Northstar|Denver/);
    expect(await operate(workerTenant, (ctx) => createDraftFromTemplate(ctx, id, DEFAULT_TEMPLATE_KEY))).toMatchObject({ refused: "This website already has a draft." });
  });

  test("replacing a Draft with the template needs to be confirmed, discards the Draft's pages, and never touches a Published version", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const draftBefore = await contentOf((await draftOf(site)).id);
    const live = (await liveOf(site))!;
    const liveBefore = await contentOf(live.id);
    await setHeadline(workerTenant, site, "Work in progress");
    const edited = await contentOf((await draftOf(site)).id);
    expect(edited).not.toEqual(draftBefore);

    // Without saying so, nothing happens.
    for (const options of [{ confirmReplace: false }, {} as never, { confirmReplace: "true" } as never]) {
      expect(await operate(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, DEFAULT_TEMPLATE_KEY, options))).toHaveProperty("refused");
      expect(await contentOf((await draftOf(site)).id)).toEqual(edited);
    }
    // An unknown template does nothing either.
    expect(await operate(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, "nope", { confirmReplace: true }))).toMatchObject({ refused: "That website template is not available." });
    expect(await contentOf((await draftOf(site)).id)).toEqual(edited);

    // On purpose: the Draft becomes the template, the Draft keeps its identity, and the Published version and the live page are as they were.
    const draftId = (await draftOf(site)).id;
    await must(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, DEFAULT_TEMPLATE_KEY, { confirmReplace: true }));
    expect((await draftOf(site)).id).toBe(draftId);
    const replaced = await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, (tx) => loadPrimaryWebsite(tx, workerTenant.organizationId));
    expect(canonicalContent(replaced!.draft)).toBe(canonicalContent(versionOf(DEFAULT_TEMPLATE)));
    expect(await contentOf(live.id)).toEqual(liveBefore);
    expect(await publishedHeadline(workerTenant.platformSlug)).toBe("Heating & cooling service when you need it.");
    expect((await versionsOf(site)).map((version) => [version.status, version.version_number])).toEqual([["published", 1], ["draft", null]]);
  });
});

test.describe("the domain record", () => {
  test("a custom domain is recorded as pending verification, can be made the main address and removed, and publishing is independent of all of it", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const before = await siteRow(site);
    await must(workerTenant, (ctx) => connectCustomDomain(ctx, site, " https://WWW.New-Example.com/page "));
    expect((await admin.query("select custom_domain, custom_domain_status, primary_domain from sites where id = $1", [site])).rows[0]).toEqual({ custom_domain: "www.new-example.com", custom_domain_status: "pending_verification", primary_domain: null });
    await must(workerTenant, (ctx) => setPrimaryAddress(ctx, site, "custom"));
    expect((await admin.query("select primary_domain from sites where id = $1", [site])).rows[0].primary_domain).toBe("www.new-example.com");
    await must(workerTenant, (ctx) => setPrimaryAddress(ctx, site, "climvia"));
    expect((await admin.query("select primary_domain from sites where id = $1", [site])).rows[0].primary_domain).toBeNull();
    await must(workerTenant, (ctx) => removeCustomDomain(ctx, site));
    expect((await admin.query("select custom_domain, custom_domain_status from sites where id = $1", [site])).rows[0]).toEqual({ custom_domain: null, custom_domain_status: null });
    expect(await operate(workerTenant, (ctx) => setPrimaryAddress(ctx, site, "custom"))).toMatchObject({ refused: "There is no custom domain to make the main address." });
    // Publishing is untouched by any of it.
    const after = await siteRow(site);
    expect(after.status).toBe(before.status);
    expect(after.published_version_id).toBe(before.published_version_id);
    expect((await versionsOf(site)).length).toBe(2);
  });

  test("a domain that is not a domain name, or is one of Climvia's own, is refused and nothing is recorded", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    for (const bad of ["not a domain", "nodots", "climvia.com", "someone.climvia.com", "", 5, null, "x".repeat(400)]) {
      expect(await operate(workerTenant, (ctx) => connectCustomDomain(ctx, site, bad))).toHaveProperty("refused");
    }
    expect((await admin.query("select custom_domain from sites where id = $1", [site])).rows[0].custom_domain).toBe("www.apexclimateair.com");
  });

  test("a domain is a claim: several businesses can record the same name (the standing Apex site and each test copy do), and none is told of the others", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const claimed = await admin.query<{ n: number }>("select count(*)::int as n from sites where custom_domain = 'www.apexclimateair.com' and custom_domain_status = 'configured'");
    expect(claimed.rows[0].n).toBeGreaterThanOrEqual(2);
    await must(workerTenant, (ctx) => connectCustomDomain(ctx, site, "www.apexclimateair.com"));
    expect((await admin.query("select custom_domain_status from sites where id = $1", [site])).rows[0].custom_domain_status).toBe("pending_verification");
  });
});

test.describe("the stored website is the approved one", () => {
  const read = async (email: string, slug: string): Promise<WebsiteState> => {
    const userId = (await admin.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0].id;
    const organizationId = (await admin.query<{ id: string }>("select id from organizations where slug = $1", [slug])).rows[0].id;
    return (await withTenant({ userId, organizationId }, (tx) => loadPrimaryWebsite(tx, organizationId)))!;
  };

  test("Apex's primary Site is published, with exactly Home, Services, About, Contact and Booking, and its Draft is its Published version", async () => {
    const state = await read("alex.morgan@apex.test", "apex-climate-heating-air");
    expect(state.published).toBe(true);
    expect(state.live?.number).toBe(1);
    expect(orderedPages(state.live!).map((page) => [page.key, page.title, page.slug, page.visible])).toEqual([
      ["home", "Home", "", true],
      ["services", "Services", "services", true],
      ["about", "About", "about", true],
      ["contact", "Contact", "contact", true],
      ["booking", "Booking", "booking", true],
    ]);
    expect(canonicalContent(state.draft)).toBe(canonicalContent(state.live!));
    expect(canonicalContent(state.live!)).toBe(canonicalContent(versionOf(APEX_CONTENT, "published", 1)));
    expect(state.site.platformSlug).toBe("apexclimate");
    expect(state.domain).toEqual({ custom: "www.apexclimateair.com", customStatus: "configured", primary: "climvia" });
  });

  test("Northstar's Site is its own: different words and colour, a hidden section, and no custom domain", async () => {
    const state = await read("taylor.brooks@northstar.test", "northstar-heating-cooling");
    expect(canonicalContent(state.live!)).toBe(canonicalContent(versionOf(NORTHSTAR_CONTENT, "published", 1)));
    expect(canonicalContent(state.live!)).not.toBe(canonicalContent(versionOf(APEX_CONTENT, "published", 1)));
    expect(state.live?.theme.accent).toBe("#1F5FAF");
    expect(state.domain).toEqual({ primary: "climvia" });
    expect(state.site.platformSlug).toBe("northstar");
    expect(JSON.stringify(state)).not.toContain("Apex");
  });

  test("the template row in the database is the default template in the code, and Apex's approved copy is that template plus one authored heading", async () => {
    const row = await admin.query<{ definition: unknown; schema_version: number; is_active: boolean; category: string }>("select definition, schema_version, is_active, category from site_templates where key = $1", [DEFAULT_TEMPLATE_KEY]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].definition).toEqual(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));
    expect(row.rows[0]).toMatchObject({ schema_version: 1, is_active: true, category: "hvac" });
    expect((await admin.query("select count(*)::int as n from site_templates")).rows[0].n).toBe(1);
  });

  test("the approved Apex copy is preserved word for word", async () => {
    const home = await loadPublicSite("apexclimate", "");
    const props = (key: string) => home?.page?.sections.find((section) => section.key === key)?.props;
    expect(props("hero")).toMatchObject({
      headline: "Heating & cooling service when you need it.",
      supportingText: "Book HVAC maintenance, diagnostics, and repair services with {{business.name}}.",
      primaryCta: "Book service",
      secondaryCta: "View services",
    });
    expect(props("why")).toMatchObject({ heading: "Why customers choose Apex Climate", item1Title: "Clear service options", item2Title: "Convenient online booking", item3Title: "Local customer support" });
    expect(props("bookingCta")).toMatchObject({ heading: "Ready to schedule service?", buttonLabel: "Book service" });
    expect(home?.nav.map((entry) => entry.title)).toEqual(["Home", "Services", "About", "Contact", "Booking"]);
  });
});
