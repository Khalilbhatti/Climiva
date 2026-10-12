/**
 * Phase 15: the Website's Server Actions asked directly, the way a forged or racing request would ask them. One real call of each action is
 * captured from the screen (on this worker's own copy of the Apex business); replaying it as someone else, with no session, with arguments the
 * screen would never send, or several times at once, asks the server's own checks. The standing Apex and Northstar sites are never changed:
 * a replay that could reach them is either refused or a no-op.
 */
import { randomBytes } from "node:crypto";
import type { Page } from "playwright/test";
import { captureAction, replay, withFirstArgument, type Captured } from "./replay";
import { expect, test } from "./saas";

const NOT_ALLOWED = "Only an owner or admin can change the website.";

type Calls = { save: Captured; publish: Captured; unpublish: Captured; remove: Captured; connect: Captured; primary: Captured };

/** Make each Website call once through the screens, and keep what the screen sent. The site ends up published with a recorded domain. */
async function captureAll(page: Page): Promise<Calls> {
  await page.goto("/website/pages/home");
  await page.getByLabel("Headline", { exact: true }).fill("Captured headline");
  const save = await captureAction(page, () => page.getByRole("button", { name: "Save changes" }).click());
  await expect(page.getByText("Saved · unpublished changes")).toBeVisible();

  await page.goto("/website");
  const publish = await captureAction(page, () => page.getByRole("button", { name: "Publish changes" }).first().click());
  await expect(page.getByRole("region", { name: "Publishing" })).toContainText("Your website is live");

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

const standingState = async (db: Db) =>
  JSON.stringify(
    (
      await db.query(
        `select o.slug, s.slug as site, s.status, s.published_version_id, s.custom_domain, s.custom_domain_status, s.primary_domain, s.updated_at::text as updated,
                (select count(*) from site_versions v where v.site_id = s.id) as versions,
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
    expect(await (await replay(jamie, calls.save, withFirstArgument(calls.save, (args) => (args.page = "about")))).text()).toContain(NOT_ALLOWED);
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
    const northstar = await db.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'");
    const taylor = await apiAs("taylor");
    const standing = await standingState(db);
    // Taylor sends the exact Northstar content (so nothing of the standing site changes), naming this business and its site in every way.
    const props = (await db.query<{ props: Record<string, string> }>(
      `select c.props from site_sections c join site_pages p on p.id = c.page_id join site_versions v on v.id = p.site_version_id join sites s on s.id = v.site_id
        join organizations o on o.id = s.organization_id where o.slug = 'northstar-heating-cooling' and v.status = 'draft' and p.page_key = 'home' and c.section_key = 'hero'`,
    )).rows[0].props;
    const same = withFirstArgument(calls.save, (args) => {
      args.sections = { hero: { visible: true, props } };
      args.organizationId = workerTenant.organizationId;
      args.siteId = "main";
      args.site = "main";
    });
    const text = await (await replay(taylor, calls.save, same)).text();
    expect(ok(text)).toBe(true);
    expect(await cloneState(db, workerTenant.organizationId)).toBe(before);
    expect(await standingState(db)).toBe(standing);
    expect(northstar.rows).toHaveLength(1);
    // Taylor's forged content is checked like anyone's.
    const forged = await (await replay(taylor, calls.save, withFirstArgument(calls.save, (args) => (args.sections = { hero: { visible: true, props: { ...props, headline: "<script>alert(1)</script>" } } })))).text();
    expect(refused(forged)).toBe(true);
    expect(await standingState(db)).toBe(standing);
  });

  test("the server reads the page and its sections only: an organization or site named in the request is ignored, and what the screen would not send is refused", async ({ page, db, workerTenant }) => {
    const calls = await captureAll(page);
    const api = page.context().request;
    const northstar = (await db.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    const standing = await standingState(db);
    const hero = (await db.query<{ props: Record<string, string> }>(
      `select c.props from site_sections c join site_pages p on p.id = c.page_id join site_versions v on v.id = p.site_version_id
        where c.organization_id = $1 and v.site_id = (select id from sites where organization_id = $1 and slug = 'main') and v.status = 'draft' and p.page_key = 'home' and c.section_key = 'hero'`,
      [workerTenant.organizationId],
    )).rows[0].props;
    const send = async (change: (args: Record<string, unknown>) => void) => (await replay(api, calls.save, withFirstArgument(calls.save, change))).text();
    const heroOf = (headline: string, extra: Record<string, unknown> = {}) => ({ hero: { visible: true, props: { ...hero, headline, ...extra } } });
    const unchanged = async (label: string, text: string) => {
      expect(refused(text), label).toBe(true);
      expect(text, label).not.toMatch(/violates|constraint|postgres|stack trace|ECONN|select\s+\w+\s+from|insert\s+into/i);
      expect((await db.query<{ props: Record<string, string> }>(
        `select c.props from site_sections c join site_pages p on p.id = c.page_id join site_versions v on v.id = p.site_version_id
          where c.organization_id = $1 and v.site_id = (select id from sites where organization_id = $1 and slug = 'main') and v.status = 'draft' and p.page_key = 'home' and c.section_key = 'hero'`,
        [workerTenant.organizationId],
      )).rows[0].props.headline, label).toBe("Captured headline");
    };

    await unchanged("a page that does not exist", await send((args) => ((args.page = "pricing"), (args.sections = heroOf("Nope")))));
    await unchanged("a section the page does not have", await send((args) => (args.sections = { nope: { visible: true, props: hero } })));
    await unchanged("markup in a section's text", await send((args) => (args.sections = heroOf("<img src=x onerror=alert(1)>"))));
    await unchanged("a script address", await send((args) => (args.sections = heroOf("javascript:alert(1)"))));
    await unchanged("a text that is a handler", await send((args) => (args.sections = heroOf("onclick = alert(1)"))));
    await unchanged("an unknown token", await send((args) => (args.sections = heroOf("Hello {{business.phone}}"))));
    await unchanged("an empty headline", await send((args) => (args.sections = heroOf(""))));
    await unchanged("a headline that is too long", await send((args) => (args.sections = heroOf("x".repeat(500)))));
    await unchanged("a field the section does not have", await send((args) => (args.sections = heroOf("Fine", { html: "<b>x</b>", className: "x" }))));
    await unchanged("an alignment that is not one", await send((args) => (args.sections = heroOf("Fine", { alignment: "right" }))));
    await unchanged("a visibility that is not a yes or no", await send((args) => (args.sections = { hero: { visible: "yes", props: hero } })));
    await unchanged("sections as a list", await send((args) => (args.sections = [hero])));
    await unchanged("a page that is a number", await send((args) => (args.page = 7)));
    await unchanged("no sections at all", await send((args) => delete args.sections));
    await unchanged("a list of Services that is not a list", await send((args) => ((args.sections = heroOf("Fine")), (args.serviceDisplay = { order: "all", hidden: [] }))));
    await unchanged("a Service that is not a slug", await send((args) => ((args.sections = heroOf("Fine")), (args.serviceDisplay = { order: ["Not A Slug"], hidden: [] }))));
    // One good section next to a bad one stores neither.
    await unchanged("a good section beside a bad one", await send((args) => (args.sections = { ...heroOf("Half saved"), bookingCta: { visible: true, props: { heading: "<b>x</b>", supportingText: "x", buttonLabel: "x" } } })));
    expect(await (await replay(api, calls.save, "not json at all")).text()).not.toMatch(/violates|postgres/i);

    // An organization or a site named in the request is not read: the change lands on this business's own site, and on no other.
    const accepted = await send((args) => {
      args.sections = heroOf("Named elsewhere");
      args.organizationId = northstar;
      args.organization_id = northstar;
      args.siteId = northstar;
      args.site = "northstar";
    });
    expect(ok(accepted)).toBe(true);
    expect(await standingState(db)).toBe(standing);
    expect((await db.query<{ props: Record<string, string> }>(
      `select c.props from site_sections c join site_pages p on p.id = c.page_id join site_versions v on v.id = p.site_version_id
        where c.organization_id = $1 and v.site_id = (select id from sites where organization_id = $1 and slug = 'main') and v.status = 'draft' and p.page_key = 'home' and c.section_key = 'hero'`,
      [workerTenant.organizationId],
    )).rows[0].props.headline).toBe("Named elsewhere");
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
    expect(ok(await (await replay(api, calls.publish)).text())).toBe(true);
    await page.goto("/website/pages/home");
    await page.getByLabel("Headline", { exact: true }).fill("Published six times");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved · unpublished changes")).toBeVisible();
    const numbers = async () => (await db.query<{ version_number: number }>("select version_number from site_versions v join sites s on s.id = v.site_id where s.organization_id = $1 and s.slug = 'main' and v.status = 'published' order by version_number", [workerTenant.organizationId])).rows.map((row: { version_number: number }) => row.version_number);
    const before = await numbers();
    const responses = await Promise.all(Array.from({ length: 6 }, () => replay(api, calls.publish)));
    const texts = await Promise.all(responses.map((response) => response.text()));
    for (const text of texts) expect(ok(text)).toBe(true);
    const after = await numbers();
    expect(after).toEqual([...before, Math.max(...before) + 1]);
    // Each answer carries the same version number, and the site points at it.
    for (const text of texts) expect(text).toContain(`"versionNumber":${Math.max(...after)}`);
    expect((await db.query("select v.version_number from sites s join site_versions v on v.id = s.published_version_id where s.organization_id = $1 and s.slug = 'main'", [workerTenant.organizationId])).rows[0].version_number).toBe(Math.max(...after));
    // Publishing again with nothing new changes nothing.
    expect(ok(await (await replay(api, calls.publish)).text())).toBe(true);
    expect(await numbers()).toEqual(after);
  });

  test("a publish and a save at the same moment are both kept in order: the published version is the Draft as it was before or after the save, whole", async ({ page, db, workerTenant }) => {
    const calls = await captureAll(page);
    const api = page.context().request;
    expect(ok(await (await replay(api, calls.publish)).text())).toBe(true);
    const hero = (await db.query<{ props: Record<string, string> }>(
      `select c.props from site_sections c join site_pages p on p.id = c.page_id join site_versions v on v.id = p.site_version_id
        where c.organization_id = $1 and v.site_id = (select id from sites where organization_id = $1 and slug = 'main') and v.status = 'draft' and p.page_key = 'home' and c.section_key = 'hero'`,
      [workerTenant.organizationId],
    )).rows[0].props;
    const token = randomBytes(3).toString("hex");
    const [saved, published] = await Promise.all([
      replay(api, calls.save, withFirstArgument(calls.save, (args) => (args.sections = { hero: { visible: true, props: { ...hero, headline: `Race ${token}`, primaryCta: "Call now" } } }))),
      replay(api, calls.publish),
    ]);
    expect(ok(await saved.text())).toBe(true);
    expect(ok(await published.text())).toBe(true);
    const live = (await db.query<{ props: Record<string, string> }>(
      `select c.props from sites s join site_versions v on v.id = s.published_version_id join site_pages p on p.site_version_id = v.id join site_sections c on c.page_id = p.id
        where s.organization_id = $1 and s.slug = 'main' and p.page_key = 'home' and c.section_key = 'hero'`,
      [workerTenant.organizationId],
    )).rows[0].props;
    const whole = (live.headline === hero.headline && live.primaryCta === hero.primaryCta) || (live.headline === `Race ${token}` && live.primaryCta === "Call now");
    expect(whole).toBe(true);
  });
});
