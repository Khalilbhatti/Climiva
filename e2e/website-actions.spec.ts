/**
 * Phase 15 and 16: the Website's Server Actions asked directly, the way a forged or racing request would ask them. One real call of each
 * action is captured from the screen (the Website Builder, on this worker's own copy of the Apex business); replaying it as someone else,
 * with no session, with arguments the screen would never send, a revision that is behind, or several times at once, asks the server's own
 * checks. The standing Apex and Northstar sites are never changed: a replay that could reach them is either refused or a no-op.
 */
import { randomBytes } from "node:crypto";
import type { Page } from "playwright/test";
import { withTenant } from "../src/db/tenant";
import { STALE_DRAFT } from "../src/lib/site-builder-rules";
import type { SiteContent } from "../src/lib/site-template";
import { readDraft } from "./draft-edits";
import { captureAction, replay, withArguments, withFirstArgument, type Captured } from "./replay";
import { SEED, expect, test } from "./saas";
import { saveButton, statusBadge } from "./website-builder-ui";

const NOT_ALLOWED = "Only an owner or admin can change the website.";

type Calls = { save: Captured; publish: Captured; unpublish: Captured; remove: Captured; connect: Captured; primary: Captured };

/** Make each Website call once through the screens, and keep what the screen sent. The site ends up private with a recorded domain. */
async function captureAll(page: Page): Promise<Calls> {
  await page.goto("/website/builder");
  await page.getByTestId("builder-section-hero").getByTestId("section-select").click();
  await page.getByLabel("Headline", { exact: true }).fill("Captured headline");
  const save = await captureAction(page, () => saveButton(page).click());
  await expect(saveButton(page)).toBeDisabled();
  await expect(statusBadge(page)).toHaveText("Draft newer than published");
  const publish = await captureAction(page, () => page.getByRole("button", { name: "Publish changes" }).click());
  await expect(statusBadge(page)).toHaveText("Published");

  await page.goto("/website/domain");
  await page.getByRole("button", { name: "More actions for www.apexclimateair.com" }).click();
  await page.getByRole("menuitem", { name: "Remove domain" }).click();
  const remove = await captureAction(page, () => page.getByRole("dialog", { name: "Remove custom domain?" }).getByRole("button", { name: "Remove domain" }).click());
  await expect(page.getByRole("region", { name: "Custom domain" })).toContainText("No custom domain connected");
  await page.getByRole("region", { name: "Custom domain" }).getByRole("button", { name: "Connect custom domain" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect custom domain" });
  await dialog.getByLabel("Domain name").fill("www.captured-example.com");
  const connect = await captureAction(page, () => dialog.getByRole("button", { name: "Connect domain" }).click());
  await expect(page.getByRole("region", { name: "Custom domain" })).toContainText("www.captured-example.com");
  const primary = await captureAction(page, () => page.getByRole("region", { name: "Custom domain" }).getByRole("button", { name: "Make primary" }).click());
  await expect(page.getByRole("region", { name: "Custom domain" })).toContainText("Primary");

  await page.goto("/website");
  await page.getByRole("region", { name: "Publishing" }).getByRole("button", { name: "Unpublish" }).click();
  const unpublish = await captureAction(page, () => page.getByRole("dialog", { name: "Unpublish website?" }).getByRole("button", { name: "Unpublish" }).click());
  await expect(page.getByRole("region", { name: "Publishing" })).toContainText("Your website is ready to preview.");
  return { save, publish, unpublish, remove, connect, primary };
}

type Db = import("pg").Pool;
type Worker = { userId: string; organizationId: string };

const standingState = async (db: Db) =>
  JSON.stringify(
    (
      await db.query(
        `select o.slug, s.slug as site, s.status, s.published_version_id, s.custom_domain, s.custom_domain_status, s.primary_domain, s.updated_at::text as updated,
                (select count(*) from site_versions v where v.site_id = s.id) as versions,
                (select string_agg(v.revision::text, ',' order by v.id) from site_versions v where v.site_id = s.id) as revisions,
                (select md5(string_agg(c.props::text, '|' order by c.site_version_id, p.page_key, c.section_key)) from site_sections c join site_pages p on p.id = c.page_id where c.site_id = s.id) as text
           from sites s join organizations o on o.id = s.organization_id where o.slug in ('apex-climate-heating-air', 'northstar-heating-cooling') order by o.slug, s.slug`,
      )
    ).rows,
  );

const cloneState = async (db: Db, organizationId: string) =>
  JSON.stringify(
    (
      await db.query(
        `select s.slug, s.status, s.published_version_id, s.custom_domain, s.custom_domain_status, s.primary_domain,
                (select count(*) from site_versions v where v.site_id = s.id) as versions,
                (select md5(string_agg(c.props::text || c.is_visible::text, '|' order by v.status, p.page_key, c.section_key)) from site_sections c join site_pages p on p.id = c.page_id join site_versions v on v.id = c.site_version_id where c.site_id = s.id) as text
           from sites s where s.organization_id = $1 order by s.slug`,
        [organizationId],
      )
    ).rows,
  );

const ok = (text: string) => /"ok":true/.test(text);
const refused = (text: string) => /"ok":false/.test(text);

const siteOf = async (db: Db, organizationId: string) => (await db.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [organizationId])).rows[0].id;
const draftOf = async (db: Db, worker: Worker) => withTenant({ userId: worker.userId, organizationId: worker.organizationId }, async (tx) => readDraft({ tx, organizationId: worker.organizationId }, await siteOf(db, worker.organizationId)));
const draftHeadline = async (db: Db, organizationId: string) =>
  (await db.query<{ props: Record<string, string> }>(
    `select c.props from site_sections c join site_pages p on p.id = c.page_id join site_versions v on v.id = p.site_version_id
      where c.organization_id = $1 and v.site_id = (select id from sites where organization_id = $1 and slug = 'main') and v.status = 'draft' and p.page_key = 'home' and c.section_key = 'hero'`,
    [organizationId],
  )).rows[0].props.headline;
const liveHero = async (db: Db, organizationId: string) =>
  (await db.query<{ props: Record<string, string> }>(
    `select c.props from sites s join site_versions v on v.id = s.published_version_id join site_pages p on p.site_version_id = v.id join site_sections c on c.page_id = p.id
      where s.organization_id = $1 and s.slug = 'main' and p.page_key = 'home' and c.section_key = 'hero'`,
    [organizationId],
  )).rows[0].props;

/** The saved Draft with its hero edited, as the Builder would send it. */
const withHero = (content: SiteContent, props: Record<string, string>): SiteContent => ({
  ...content,
  pages: content.pages.map((page) => (page.key !== "home" ? page : { ...page, sections: page.sections.map((section) => (section.key !== "hero" ? section : { ...section, props: { ...section.props, ...props } })) })),
});

test.describe("asking the Website's actions directly", () => {
  test("a member can read the website but every write is refused, and the business they belong to is untouched", async ({ page, db, apiAs }) => {
    const calls = await captureAll(page);
    // Six different actions were captured, each with its own id.
    expect(new Set(Object.values(calls).map((captured) => captured.headers["next-action"])).size).toBe(6);
    const jamie = await apiAs("jamie");
    const standing = await standingState(db);
    for (const [name, captured] of Object.entries(calls)) {
      const text = await (await replay(jamie, captured)).text();
      expect(text, name).toContain(NOT_ALLOWED);
    }
    // Forged arguments make no difference to a person who may not write.
    expect(await (await replay(jamie, calls.save, withFirstArgument(calls.save, (args) => (args.expectedRevision = 1)))).text()).toContain(NOT_ALLOWED);
    expect(await (await replay(jamie, calls.publish, withArguments(calls.publish, () => []))).text()).toContain(NOT_ALLOWED);
    expect(await standingState(db)).toBe(standing);
  });

  test("with no session, the request is turned away before any action runs", async ({ page, db, apiAs, workerTenant }) => {
    const calls = await captureAll(page);
    const before = await cloneState(db, workerTenant.organizationId);
    const visitor = await apiAs(null);
    for (const [name, captured] of Object.entries(calls)) {
      const response = await replay(visitor, captured, captured.body, { maxRedirects: 0 });
      expect([307, 401, 403], name).toContain(response.status());
    }
    expect(await cloneState(db, workerTenant.organizationId)).toBe(before);
  });

  test("an owner of another business reaches only their own site: nothing about this business changes, whatever the request names", async ({ page, db, apiAs, workerTenant }) => {
    const calls = await captureAll(page);
    const before = await cloneState(db, workerTenant.organizationId);
    const northstarOrg = (await db.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    const taylorId = (await db.query<{ id: string }>("select id from auth_user where email = $1", [SEED.taylor])).rows[0].id;
    const northstar = await withTenant({ userId: taylorId, organizationId: northstarOrg }, async (tx) => readDraft({ tx, organizationId: northstarOrg }, await siteOf(db, northstarOrg)));
    const taylor = await apiAs("taylor");
    const standing = await standingState(db);
    const workerSite = await siteOf(db, workerTenant.organizationId);

    // Taylor sends Northstar's own content at its own revision (so nothing of the standing site changes), naming this business and its site
    // in every way: the request is understood as Taylor's own site, and this business's site is not reached.
    const same = withFirstArgument(calls.save, (args) => {
      args.expectedRevision = northstar.revision;
      args.content = northstar.content;
      args.organizationId = workerTenant.organizationId;
      args.siteId = workerSite;
      args.site = "main";
    });
    const text = await (await replay(taylor, calls.save, same)).text();
    expect(ok(text)).toBe(true);
    expect(await cloneState(db, workerTenant.organizationId)).toBe(before);
    expect(await standingState(db)).toBe(standing);
    // This business's own copy and revision mean nothing to Taylor's site: the save is refused as behind, and nothing is stored anywhere.
    const apex = await draftOf(db, workerTenant);
    const crossed = await (await replay(taylor, calls.save, withFirstArgument(calls.save, (args) => ((args.expectedRevision = apex.revision), (args.content = apex.content))))).text();
    expect(refused(crossed)).toBe(true);
    // Taylor's forged content is checked like anyone's.
    const forged = withHero(northstar.content, { headline: "<script>alert(1)</script>" });
    expect(refused(await (await replay(taylor, calls.save, withFirstArgument(calls.save, (args) => ((args.expectedRevision = northstar.revision), (args.content = forged))))).text())).toBe(true);
    expect(await standingState(db)).toBe(standing);
    expect(await cloneState(db, workerTenant.organizationId)).toBe(before);
  });

  test("the server reads the content and the revision only: an organization or site named in the request is ignored, and what the screen would never send is refused", async ({ page, db, workerTenant }) => {
    const calls = await captureAll(page);
    const api = page.context().request;
    const northstarOrg = (await db.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    const standing = await standingState(db);
    const send = async (change: (args: Record<string, unknown>, content: SiteContent) => void) => {
      const current = await draftOf(db, workerTenant);
      return (await replay(api, calls.save, withFirstArgument(calls.save, (args) => ((args.expectedRevision = current.revision), (args.content = current.content), change(args, current.content))))).text();
    };
    const unchanged = async (label: string, text: string) => {
      expect(refused(text), label).toBe(true);
      expect(text, label).not.toMatch(/violates|constraint|postgres|stack trace|ECONN|select\s+\w+\s+from|insert\s+into/i);
      expect(await draftHeadline(db, workerTenant.organizationId), label).toBe("Captured headline");
    };
    const pages = (content: SiteContent, key: string, change: (page: SiteContent["pages"][number]) => unknown) => ({ ...content, pages: content.pages.map((page) => (page.key === key ? change(page) : page)) });

    await unchanged("markup in a section's text", await send((args, content) => (args.content = withHero(content, { headline: "<img src=x onerror=alert(1)>" }))));
    await unchanged("a script address", await send((args, content) => (args.content = withHero(content, { headline: "javascript:alert(1)" }))));
    await unchanged("a text that is a handler", await send((args, content) => (args.content = withHero(content, { headline: "onclick = alert(1)" }))));
    await unchanged("an unknown token", await send((args, content) => (args.content = withHero(content, { headline: "Hello {{business.phone}}" }))));
    await unchanged("an empty headline", await send((args, content) => (args.content = withHero(content, { headline: "" }))));
    await unchanged("a headline that is too long", await send((args, content) => (args.content = withHero(content, { headline: "x".repeat(500) }))));
    await unchanged("a field the section does not have", await send((args, content) => (args.content = withHero(content, { html: "<b>x</b>", className: "x" }))));
    await unchanged("an alignment that is not one", await send((args, content) => (args.content = withHero(content, { alignment: "right" }))));
    await unchanged("a visibility that is not a yes or no", await send((args, content) => (args.content = pages(content, "home", (page) => ({ ...page, sections: page.sections.map((section) => ({ ...section, visible: "yes" })) })))));
    await unchanged("a page that is not a list of sections", await send((args, content) => (args.content = pages(content, "home", (page) => ({ ...page, sections: { hero: {} } })))));
    await unchanged("pages as an object", await send((args, content) => (args.content = { ...content, pages: { home: {} } })));
    await unchanged("no content at all", await send((args) => delete args.content));
    await unchanged("content that is a number", await send((args) => (args.content = 7)));
    await unchanged("the home page deleted", await send((args, content) => (args.content = { ...content, pages: content.pages.filter((page) => page.key !== "home") })));
    await unchanged("a page that becomes another kind", await send((args, content) => (args.content = pages(content, "services", (page) => ({ ...page, type: "content" })))));
    await unchanged("a reserved address", await send((args, content) => (args.content = pages(content, "about", (page) => ({ ...page, slug: "login" })))));
    await unchanged("a list of Services that is not a list", await send((args, content) => (args.content = { ...content, settings: { serviceDisplay: { order: "all", hidden: [] } } })));
    await unchanged("a Service that is not a slug", await send((args, content) => (args.content = { ...content, settings: { serviceDisplay: { order: ["Not A Slug"], hidden: [] } } })));
    await unchanged("a theme with CSS", await send((args, content) => (args.content = { ...content, theme: { ...content.theme, css: "body{display:none}" } })));
    await unchanged("a revision that is a string", await send((args) => (args.expectedRevision = "1")));
    await unchanged("a revision that is missing", await send((args) => delete args.expectedRevision));
    await unchanged("a revision that is behind", await send((args) => (args.expectedRevision = (args.expectedRevision as number) - 1)));
    await unchanged("an input that is not an object", await (await replay(api, calls.save, withArguments(calls.save, () => ["hello"]))).text());
    await unchanged("no input at all", await (await replay(api, calls.save, withArguments(calls.save, () => []))).text());
    // One good change next to a bad one stores neither.
    await unchanged("a good change beside a bad one", await send((args, content) => (args.content = pages(withHero(content, { headline: "Half saved" }), "about", (page) => ({ ...page, title: "" })))));
    expect(await (await replay(api, calls.save, "not json at all")).text()).not.toMatch(/violates|postgres/i);

    // An organization or a site named in the request is not read: the change lands on this business's own site, and on no other.
    const accepted = await send((args, content) => {
      args.content = withHero(content, { headline: "Named elsewhere" });
      args.organizationId = northstarOrg;
      args.organization_id = northstarOrg;
      args.siteId = northstarOrg;
      args.site = "northstar";
    });
    expect(ok(accepted)).toBe(true);
    expect(await standingState(db)).toBe(standing);
    expect(await draftHeadline(db, workerTenant.organizationId)).toBe("Named elsewhere");
  });

  test("a save or a publish from a copy that is behind is refused whole, and nothing is stored or published", async ({ page, db, workerTenant }) => {
    const calls = await captureAll(page);
    const api = page.context().request;
    const behind = await draftOf(db, workerTenant);
    // Another tab saves, so the revision the first one holds is no longer the Draft's.
    const next = await replay(api, calls.save, withFirstArgument(calls.save, (args) => ((args.expectedRevision = behind.revision), (args.content = withHero(behind.content, { headline: "Saved by the other tab" })))));
    expect(ok(await next.text())).toBe(true);

    const published = async () => (await db.query<{ n: number }>("select count(*)::int as n from site_versions v join sites s on s.id = v.site_id where s.organization_id = $1 and s.slug = 'main' and v.status = 'published'", [workerTenant.organizationId])).rows[0].n;
    const before = await published();
    const lateSave = await (await replay(api, calls.save, withFirstArgument(calls.save, (args) => ((args.expectedRevision = behind.revision), (args.content = withHero(behind.content, { headline: "From the tab that is behind" })))))).text();
    expect(refused(lateSave)).toBe(true);
    expect(lateSave).toContain(STALE_DRAFT);
    expect(await draftHeadline(db, workerTenant.organizationId)).toBe("Saved by the other tab");

    const latePublish = await (await replay(api, calls.publish, withFirstArgument(calls.publish, (args) => (args.expectedRevision = behind.revision)))).text();
    expect(refused(latePublish)).toBe(true);
    expect(latePublish).toContain(STALE_DRAFT);
    expect(await published()).toBe(before);
    // A publish that names no revision is the older kind (the Website page's button) and still works; one that names a non-number is refused.
    expect(refused(await (await replay(api, calls.publish, withArguments(calls.publish, () => [{ expectedRevision: "1" }]))).text())).toBe(true);
    expect(ok(await (await replay(api, calls.publish, withArguments(calls.publish, () => []))).text())).toBe(true);
    expect(await published()).toBe(before + 1);
  });

  test("the domain actions take a name and a choice, never a status: a domain is recorded as pending, a reserved or malformed name is refused", async ({ page, db, workerTenant }) => {
    const calls = await captureAll(page);
    const api = page.context().request;
    const site = async () => (await db.query("select custom_domain, custom_domain_status, primary_domain from sites where organization_id = $1 and slug = 'main'", [workerTenant.organizationId])).rows[0];
    const connect = async (change: (args: Record<string, unknown>) => void) => (await replay(api, calls.connect, withFirstArgument(calls.connect, change))).text();

    const before = await site();
    for (const bad of ["climvia.com", "www.climvia.com", "apexclimate.climvia.com", "not a domain", "", "x".repeat(400), "<script>.com", "http://", "localhost"]) {
      expect(refused(await connect((args) => (args.domain = bad))), bad).toBe(true);
    }
    expect(refused(await connect((args) => (args.domain = 42)))).toBe(true);
    expect(await site()).toEqual(before);

    // A status smuggled in with the name is not read: the domain is recorded as waiting for verification, never verified.
    expect(ok(await connect((args) => Object.assign(args, { domain: "WWW.Smuggled-Example.com", status: "verified", customDomainStatus: "verified", verified: true })))).toBe(true);
    expect(await site()).toEqual({ custom_domain: "www.smuggled-example.com", custom_domain_status: "pending_verification", primary_domain: null });

    // The main address is a choice of two, and only while a domain is recorded.
    const choose = async (primary: unknown) => (await replay(api, calls.primary, withFirstArgument(calls.primary, (args) => (args.primary = primary)))).text();
    for (const bad of ["verified", "other.example.com", "", null, 7, ["custom"]]) expect(refused(await choose(bad)), JSON.stringify(bad)).toBe(true);
    expect(ok(await choose("custom"))).toBe(true);
    expect((await site()).primary_domain).toBe("www.smuggled-example.com");
    expect(ok(await choose("climvia"))).toBe(true);
    expect((await site()).primary_domain).toBeNull();
    // Removing the domain, twice, is safe; choosing a custom address after that is refused.
    expect(ok((await (await replay(api, calls.remove)).text()))).toBe(true);
    expect(ok((await (await replay(api, calls.remove)).text()))).toBe(true);
    expect(refused(await choose("custom"))).toBe(true);
    expect((await site()).custom_domain).toBeNull();
  });

  test("six publishes at once make one new version, and every one of them is answered with it", async ({ page, db, workerTenant }) => {
    const calls = await captureAll(page);
    const api = page.context().request;
    // Make the site live again with a new Draft, then publish the same Draft six times at once.
    expect(ok(await (await replay(api, calls.publish, withArguments(calls.publish, () => []))).text())).toBe(true);
    await page.goto("/website/builder");
    await page.getByTestId("builder-section-hero").getByTestId("section-select").click();
    await page.getByLabel("Headline", { exact: true }).fill("Published six times");
    await saveButton(page).click();
    await expect(saveButton(page)).toBeDisabled();
    await expect(statusBadge(page)).toHaveText("Draft newer than published");
    const numbers = async () => (await db.query<{ version_number: number }>("select version_number from site_versions v join sites s on s.id = v.site_id where s.organization_id = $1 and s.slug = 'main' and v.status = 'published' order by version_number", [workerTenant.organizationId])).rows.map((row: { version_number: number }) => row.version_number);
    const before = await numbers();
    const current = await draftOf(db, workerTenant);
    const body = withFirstArgument(calls.publish, (args) => (args.expectedRevision = current.revision));
    const responses = await Promise.all(Array.from({ length: 6 }, () => replay(api, calls.publish, body)));
    const texts = await Promise.all(responses.map((response) => response.text()));
    for (const text of texts) expect(ok(text)).toBe(true);
    const after = await numbers();
    expect(after).toEqual([...before, Math.max(...before) + 1]);
    // Each answer carries the same version number, and the site points at it.
    for (const text of texts) expect(text).toContain(`"versionNumber":${Math.max(...after)}`);
    expect((await db.query("select v.version_number from sites s join site_versions v on v.id = s.published_version_id where s.organization_id = $1 and s.slug = 'main'", [workerTenant.organizationId])).rows[0].version_number).toBe(Math.max(...after));
    // Publishing again with nothing new changes nothing.
    expect(ok(await (await replay(api, calls.publish, body)).text())).toBe(true);
    expect(await numbers()).toEqual(after);
  });

  test("two saves at once with the same revision store one: the other is told the Draft moved, and the stored Draft is whole", async ({ page, db, workerTenant }) => {
    const calls = await captureAll(page);
    const api = page.context().request;
    const opened = await draftOf(db, workerTenant);
    const token = randomBytes(3).toString("hex");
    const attempt = (headline: string) => replay(api, calls.save, withFirstArgument(calls.save, (args) => ((args.expectedRevision = opened.revision), (args.content = withHero(opened.content, { headline, primaryCta: headline.slice(0, 20) })))));
    const results = await Promise.all([attempt(`First ${token}`), attempt(`Second ${token}`), attempt(`Third ${token}`)]);
    const texts = await Promise.all(results.map((response) => response.text()));
    expect(texts.filter(ok)).toHaveLength(1);
    expect(texts.filter((text) => refused(text) && text.includes(STALE_DRAFT))).toHaveLength(2);
    const stored = (await draftOf(db, workerTenant)).content.pages[0].sections[0].props;
    const winner = texts.findIndex(ok);
    const headline = [`First ${token}`, `Second ${token}`, `Third ${token}`][winner];
    expect(stored).toMatchObject({ headline, primaryCta: headline.slice(0, 20) });
  });

  test("a publish and a save at the same moment are both kept in order: the published version is the Draft as it was before the save or after it, whole", async ({ page, db, workerTenant }) => {
    const calls = await captureAll(page);
    const api = page.context().request;
    expect(ok(await (await replay(api, calls.publish, withArguments(calls.publish, () => []))).text())).toBe(true);
    const opened = await draftOf(db, workerTenant);
    const hero = await liveHero(db, workerTenant.organizationId);
    const token = randomBytes(3).toString("hex");
    const [saved, published] = await Promise.all([
      replay(api, calls.save, withFirstArgument(calls.save, (args) => ((args.expectedRevision = opened.revision), (args.content = withHero(opened.content, { headline: `Race ${token}`, primaryCta: "Call now" }))))),
      replay(api, calls.publish, withFirstArgument(calls.publish, (args) => (args.expectedRevision = opened.revision))),
    ]);
    expect(ok(await saved.text())).toBe(true);
    // Either the publish ran first (and published the Draft as it was), or the save ran first and the publish, which had been shown the
    // older Draft, was refused. Never a mixture.
    const answer = await published.text();
    expect(ok(answer) || answer.includes(STALE_DRAFT)).toBe(true);
    const live = await liveHero(db, workerTenant.organizationId);
    const whole = (live.headline === hero.headline && live.primaryCta === hero.primaryCta) || (live.headline === `Race ${token}` && live.primaryCta === "Call now");
    expect(whole).toBe(true);
    if (!ok(answer)) expect(live).toEqual(hero);
  });
});
