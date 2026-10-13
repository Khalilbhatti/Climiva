/**
 * Phase 17: replacing a Draft with a Template, as the application's database layer and Server Action do it, asked directly.
 *
 * Part one runs the data functions committing, on each worker's own copy of the Apex business: the revision check (a stale replacement is
 * refused whole), what is kept (the business's choice of Services) and what is replaced, every Template applied and then published, a
 * business with two Sites, and what an invalid, inactive or unknown Template does (nothing, in a transaction that is rolled back so the
 * shared Template table is never touched). Part two captures one real call of the action from the screen and replays it as a visitor,
 * as a member who may only look, as the owner with arguments the screen would never send, and as the owner of another business.
 *
 * The standing Apex and Northstar sites are only ever read here (other workers read them in parallel).
 */
import { and, eq } from "drizzle-orm";
import { expect } from "playwright/test";
import { Pool } from "pg";
import { adminDb } from "../scripts/db/lib";
import { findTemplateRecord, TEMPLATE_KEYS } from "../src/db/site-templates";
import {
  createDraftFromTemplate,
  createSite,
  listActiveTemplates,
  listPublishedVersions,
  publishSite,
  replaceDraftWithTemplate,
  type SiteContext,
} from "../src/db/site-queries";
import { siteSections, siteTemplates, siteVersions, sites } from "../src/db/schema";
import { Refusal } from "../src/lib/refusal";
import { setServiceDisplay } from "../src/lib/site-builder";
import { STALE_DRAFT } from "../src/lib/site-builder-rules";
import { editDraft, readDraft } from "./draft-edits";
import { captureAction, replay, withFirstArgument } from "./replay";
import { test } from "./saas";
import { chooseTemplate, contentOf, mainSiteId, must, openGallery, operate, pageContent, stored, type Tenant } from "./website-templates-ui";

const NOT_ALLOWED = "Only an owner or admin can change the website.";
const NOT_AVAILABLE = "That website template is not available.";
const CONFIRM = "Replacing the draft with a template discards its pages. Confirm to continue.";

test.describe("replacing a Draft with a Template: the data layer", () => {
  test("a replacement made from a Draft that has moved on is refused whole; one made at the current revision replaces, moves the revision and keeps the Draft's identity", async ({ workerTenant }) => {
    const db = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
    try {
      const site = await mainSiteId(db, workerTenant);
      const draftId = (await db.query<{ id: string }>("select id from site_versions where site_id = $1 and status = 'draft'", [site])).rows[0].id;
      const before = await stored(db, workerTenant.organizationId, "draft");

      // One revision behind (or a number that was never the Draft's): refused, and not one row changed.
      for (const behind of [before.revision - 1, 0, 1, before.revision + 1]) {
        const result = await operate(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, "precision", { confirmReplace: true, expectedRevision: behind }));
        expect(result, `at ${behind}`).toMatchObject({ refused: STALE_DRAFT });
      }
      expect(await stored(db, workerTenant.organizationId, "draft")).toEqual(before);

      expect(await must(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, "precision", { confirmReplace: true, expectedRevision: before.revision }))).toBe(draftId);
      const after = await stored(db, workerTenant.organizationId, "draft");
      expect(after.templateKey).toBe("precision");
      expect(after.revision).toBeGreaterThan(before.revision);
      expect(pageContent(after)).toEqual(contentOf("precision", before.settings));
      // The selected Template of the Site is recorded with it.
      expect((await db.query("select t.key from sites s join site_templates t on t.id = s.selected_template_id where s.id = $1", [site])).rows[0].key).toBe("precision");

      // The same request again is now behind: it cannot be replayed.
      expect(await operate(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, "comfort", { confirmReplace: true, expectedRevision: before.revision }))).toMatchObject({ refused: STALE_DRAFT });
      expect(await stored(db, workerTenant.organizationId, "draft")).toEqual(after);
    } finally {
      await db.end();
    }
  });

  test("which Services the website shows, hides and in what order is the business's choice and survives a change of design; the theme, pages and sections are replaced", async ({ workerTenant }) => {
    const db = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
    try {
      const site = await mainSiteId(db, workerTenant);
      const display = { order: ["emergency-no-heat-no-cool", "ac-repair"], hidden: ["heat-pump-diagnostics-repair"] };
      await must(workerTenant, (ctx) => editDraft(ctx, site, (content) => setServiceDisplay(content, display)));
      const worked = await stored(db, workerTenant.organizationId, "draft");
      expect(worked.settings).toEqual({ serviceDisplay: display });

      for (const key of ["precision", "comfort", "airflow", "climvia-starter"]) {
        const { revision } = await must(workerTenant, (ctx) => readDraft(ctx, site));
        await must(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, key, { confirmReplace: true, expectedRevision: revision }));
        const draft = await stored(db, workerTenant.organizationId, "draft");
        expect(draft.settings, key).toEqual({ serviceDisplay: display });
        expect(pageContent(draft), key).toEqual(contentOf(key, { serviceDisplay: display }));
        expect(draft.templateKey).toBe(key);
      }
    } finally {
      await db.end();
    }
  });

  test("every Template can be applied to a Draft and then published: the Published versions are numbered one after another, and each keeps what it was", async ({ workerTenant }) => {
    const db = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
    try {
      const site = await mainSiteId(db, workerTenant);
      const published: unknown[] = [await stored(db, workerTenant.organizationId, "live")];
      for (const [index, key] of ["precision", "comfort", "airflow", "climvia-starter"].entries()) {
        const { revision } = await must(workerTenant, (ctx) => readDraft(ctx, site));
        await must(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, key, { confirmReplace: true, expectedRevision: revision }));
        const next = await must(workerTenant, async (ctx) => publishSite(ctx, site, workerTenant.userId, { expectedRevision: (await readDraft(ctx, site)).revision }));
        expect(next.number, key).toBe(index + 2);
        expect(next.changed, key).toBe(true);
        published.push(await stored(db, workerTenant.organizationId, "live"));
        expect(pageContent((await stored(db, workerTenant.organizationId, "live")) as Awaited<ReturnType<typeof stored>>), key).toEqual(contentOf(key, { serviceDisplay: { order: [], hidden: [] } }));
      }
      const numbers = await must(workerTenant, (ctx) => listPublishedVersions(ctx.tx, ctx.organizationId, site));
      expect(numbers.map((version) => version.number)).toEqual([5, 4, 3, 2, 1]);
      // Every earlier version is exactly what was published then: later replacements never reached back into them.
      for (const [index, snapshot] of published.entries()) expect(await stored(db, workerTenant.organizationId, index + 1), `version ${index + 1}`).toEqual(snapshot);
    } finally {
      await db.end();
    }
  });

  test("a business with two Sites: each Site's Draft is replaced on its own, by the Site named in the verified business", async ({ workerTenant }) => {
    const db = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
    try {
      const primary = await mainSiteId(db, workerTenant);
      const primaryBefore = await stored(db, workerTenant.organizationId, "draft");
      const second = await must(workerTenant, (ctx) => createSite(ctx.tx, ctx.organizationId, { name: "Second", slug: "second", platformSlug: `${workerTenant.platformSlug}-second` }));
      await must(workerTenant, (ctx) => createDraftFromTemplate(ctx, second, "climvia-starter"));
      const revision = (await db.query<{ revision: number }>("select revision from site_versions where site_id = $1 and status = 'draft'", [second])).rows[0].revision;
      await must(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, second, "airflow", { confirmReplace: true, expectedRevision: revision }));
      const secondDraft = (await db.query<{ key: string; theme: { look?: string } }>("select t.key, v.theme from site_versions v join site_templates t on t.id = v.template_id where v.site_id = $1 and v.status = 'draft'", [second])).rows[0];
      expect(secondDraft.key).toBe("airflow");
      expect(secondDraft.theme.look).toBe("airflow");
      expect(await stored(db, workerTenant.organizationId, "draft")).toEqual(primaryBefore);
      expect(primary).not.toBe(second);
    } finally {
      await db.end();
    }
  });

  test("a Site of another business cannot be named: it is indistinguishable from one that does not exist, and the other business's Draft is untouched", async ({ workerTenant }) => {
    const db = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
    try {
      const northstar = (await db.query<{ id: string; org: string }>("select s.id, s.organization_id as org from sites s join organizations o on o.id = s.organization_id where o.slug = 'northstar-heating-cooling' and s.slug = 'main'")).rows[0];
      const before = await stored(db, northstar.org, "draft");
      const result = await operate(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, northstar.id, "precision", { confirmReplace: true }));
      expect(result).toMatchObject({ refused: "That website no longer exists. Reload the page and try again." });
      expect(await stored(db, northstar.org, "draft")).toEqual(before);
    } finally {
      await db.end();
    }
  });
});

test.describe("what cannot be applied", () => {
  class Rollback extends Error {}

  /** Run `work` against the database as the owner inside a transaction that is always rolled back, so no row it writes is ever seen by another test. */
  async function rolledBack(work: (ctx: SiteContext) => Promise<void>, tenant: Tenant) {
    const { pool, db } = adminDb();
    try {
      await db
        .transaction(async (tx) => {
          await work({ tx, organizationId: tenant.organizationId });
          throw new Rollback();
        })
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await pool.end();
    }
  }

  const validDefinition = () => JSON.parse(JSON.stringify(findTemplateRecord("precision")!.definition));

  test("an unknown, inactive or invalid Template is refused before anything is deleted, and the Gallery never lists it", async ({ workerTenant }) => {
    await rolledBack(async (ctx) => {
      const site = (await ctx.tx.select().from(sites).where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.slug, "main"))))[0];
      const draft = (await ctx.tx.select().from(siteVersions).where(and(eq(siteVersions.siteId, site.id), eq(siteVersions.status, "draft"))))[0];
      const sections = async () => (await ctx.tx.select().from(siteSections).where(eq(siteSections.siteVersionId, draft.id))).length;
      const count = await sections();
      const refusal = async (key: string) => {
        try {
          await ctx.tx.transaction((inner) => replaceDraftWithTemplate({ tx: inner, organizationId: ctx.organizationId }, site.id, key, { confirmReplace: true, expectedRevision: draft.revision }));
          return "applied";
        } catch (error) {
          return error instanceof Refusal ? error.message : String(error);
        }
      };

      const invalidVariant = validDefinition();
      invalidVariant.pages[0].sections[0].variant = "does-not-exist";
      const invalidProps = validDefinition();
      invalidProps.pages[0].sections[0].props.headline = "<script>alert(1)</script>";
      const noHome = validDefinition();
      noHome.pages = noHome.pages.slice(1);
      const futureSchema = { ...validDefinition(), schema: 2 };
      await ctx.tx.insert(siteTemplates).values([
        { key: "test-retired", name: "Retired", category: "hvac", schemaVersion: 1, definition: validDefinition(), isActive: false },
        { key: "test-bad-variant", name: "Bad variant", category: "hvac", schemaVersion: 1, definition: invalidVariant, isActive: true },
        { key: "test-bad-props", name: "Bad props", category: "hvac", schemaVersion: 1, definition: invalidProps, isActive: true },
        { key: "test-no-home", name: "No home", category: "hvac", schemaVersion: 1, definition: noHome, isActive: true },
        { key: "test-future", name: "Future", category: "hvac", schemaVersion: 2, definition: futureSchema, isActive: true },
      ]);

      for (const key of ["no-such-template", "test-retired", "test-bad-variant", "test-bad-props", "test-no-home", "test-future", "", "Precision", "../precision"]) {
        expect(await refusal(key), key).toBe(NOT_AVAILABLE);
        expect(await sections(), `${key} left the Draft's sections alone`).toBe(count);
      }
      // A Template that does not validate is not offered either: the listing has the four good ones and nothing else.
      expect((await listActiveTemplates(ctx.tx)).map((template) => template.key)).toEqual([...TEMPLATE_KEYS]);
    }, workerTenant);
  });

  test("it needs the confirmation, whatever else is right", async ({ workerTenant }) => {
    const { pool } = adminDb();
    try {
      const site = await mainSiteId(pool, workerTenant);
      const before = await stored(pool, workerTenant.organizationId, "draft");
      for (const options of [{ confirmReplace: false }, {} as never, { confirmReplace: "true" } as never, { confirmReplace: 1 } as never, { confirmReplace: undefined } as never]) {
        const result = await operate(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, "precision", { ...options, expectedRevision: before.revision }));
        expect(result).toMatchObject({ refused: CONFIRM });
      }
      expect(await stored(pool, workerTenant.organizationId, "draft")).toEqual(before);
    } finally {
      await pool.end();
    }
  });
});

/* ───────────────────────── the Server Action, asked directly ───────────────────────── */

test.describe("the Server Action asked directly", () => {
  test("it is authorized, validated and confined to the caller's own website: nothing a forged request names reaches another business", async ({ page, db, workerTenant, apiAs }) => {
    const org = workerTenant.organizationId;
    const ids = async (slug: string) => (await db.query<{ id: string }>("select id from organizations where slug = $1", [slug])).rows[0].id;
    const apex = await ids("apex-climate-heating-air");
    const northstar = await ids("northstar-heating-cooling");
    const standing = async () => JSON.stringify([await stored(db, apex, "draft"), await stored(db, apex, "live"), await stored(db, northstar, "draft"), await stored(db, northstar, "live")]);
    const standingBefore = await standing();
    const northstarSite = (await db.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [northstar])).rows[0].id;

    // One real call, made through the screen.
    await openGallery(page);
    const dialog = await chooseTemplate(page, "Precision");
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Replace draft with Precision" }).click());
    await expect(page).toHaveURL(/\/website\/builder/);
    const sent = JSON.parse(captured.body)[0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["confirmReplace", "expectedRevision", "templateKey"]);
    expect(sent).toMatchObject({ templateKey: "precision", confirmReplace: true });
    const done = await stored(db, org, "draft");
    expect(done.templateKey).toBe("precision");

    const owner = page.context().request;
    const unchanged = async (label: string) => expect(await stored(db, org, "draft"), label).toEqual(done);
    const text = async (api: typeof owner, body: string) => (await replay(api, captured, body)).text();
    const current = () => done.revision;

    // A visitor with no session, and a member who may only look, are refused before the arguments are read.
    const visitor = await apiAs(null);
    const visitorResponse = await replay(visitor, captured, captured.body, { maxRedirects: 0 });
    expect(visitorResponse.status() === 307 || visitorResponse.status() === 401 || !(await visitorResponse.text()).includes('"ok":true')).toBe(true);
    await unchanged("visitor");
    const jamie = await apiAs("jamie");
    expect(await text(jamie, withFirstArgument(captured, (args) => ((args.templateKey = "comfort"), (args.expectedRevision = current()))))).toContain(NOT_ALLOWED);
    await unchanged("member who may only look");

    // The owner, with arguments the screen would never send: each is refused and none changes anything.
    const cases: [string, (args: Record<string, unknown>) => void, string][] = [
      ["an unknown template", (args) => (args.templateKey = "nope"), NOT_AVAILABLE],
      ["a retired-looking key", (args) => (args.templateKey = "Precision"), NOT_AVAILABLE],
      ["a path as the key", (args) => (args.templateKey = "../comfort"), NOT_AVAILABLE],
      ["a key that is not text", (args) => (args.templateKey = 7), NOT_AVAILABLE],
      ["a key with no characters", (args) => (args.templateKey = ""), NOT_AVAILABLE],
      ["a very long key", (args) => (args.templateKey = "a".repeat(61)), NOT_AVAILABLE],
      ["no confirmation", (args) => delete args.confirmReplace, CONFIRM],
      ["a confirmation that is false", (args) => (args.confirmReplace = false), CONFIRM],
      ["a confirmation that is text", (args) => (args.confirmReplace = "true"), CONFIRM],
      ["a revision that is behind", (args) => (args.expectedRevision = current() - 1), STALE_DRAFT],
      ["a revision from the future", (args) => (args.expectedRevision = current() + 5), STALE_DRAFT],
      ["no revision", (args) => delete args.expectedRevision, "The website was not understood."],
      ["a revision that is text", (args) => (args.expectedRevision = String(current())), "The website was not understood."],
      ["a revision that is not whole", (args) => (args.expectedRevision = current() + 0.5), "The website was not understood."],
      ["a revision of zero", (args) => (args.expectedRevision = 0), "The website was not understood."],
    ];
    for (const [label, change, message] of cases) {
      const answer = await text(owner, withFirstArgument(captured, (args) => ((args.templateKey = "comfort"), (args.expectedRevision = current()), change(args))));
      expect(answer, label).toContain(message);
      await unchanged(label);
    }
    for (const body of ["[null]", '["precision"]', "[[]]", "[]", "[7]"]) {
      expect(await text(owner, body), body).toMatch(/The template was not understood\.|not understood/);
      await unchanged(body);
    }

    // A request that names another business's site and organization is read as the caller's own: the named ids are ignored.
    const forged = await text(owner, withFirstArgument(captured, (args) => {
      args.templateKey = "airflow";
      args.expectedRevision = current();
      args.siteId = northstarSite;
      args.organizationId = northstar;
      args.organization_id = northstar;
    }));
    expect(forged).not.toContain(NOT_AVAILABLE);
    const own = await stored(db, org, "draft");
    expect(own.templateKey).toBe("airflow");
    expect(pageContent(own)).toEqual(contentOf("airflow", done.settings));
    expect(await standing()).toBe(standingBefore);

    // The owner of another business, with a revision that is not theirs and with no confirmation, is refused and changes nothing anywhere.
    const taylor = await apiAs("taylor");
    for (const change of [(args: Record<string, unknown>) => (args.expectedRevision = 999_999), (args: Record<string, unknown>) => (args.confirmReplace = false)]) {
      const answer = await text(taylor, withFirstArgument(captured, (args) => ((args.templateKey = "comfort"), (args.expectedRevision = own.revision), (args.siteId = (change(args), northstarSite)))));
      expect(answer).toMatch(new RegExp(`${STALE_DRAFT.slice(0, 30)}|${CONFIRM.slice(0, 30)}`));
    }
    expect(await standing()).toBe(standingBefore);
    expect(await stored(db, org, "draft")).toEqual(own);
  });

  test("a replacement that races another is safe: of two at once, one wins and the other is refused as behind, and the Draft is exactly one Template", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openGallery(page);
    const dialog = await chooseTemplate(page, "Precision");
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Replace draft with Precision" }).click());
    await expect(page).toHaveURL(/\/website\/builder/);
    const revision = (await stored(db, org, "draft")).revision;
    const owner = page.context().request;
    const answers = await Promise.all(
      ["comfort", "airflow"].map(async (key) => (await replay(owner, captured, withFirstArgument(captured, (args) => ((args.templateKey = key), (args.expectedRevision = revision))))).text()),
    );
    const refused = answers.filter((answer) => answer.includes(STALE_DRAFT));
    expect(refused).toHaveLength(1);
    const draft = await stored(db, org, "draft");
    expect(["comfort", "airflow"]).toContain(draft.templateKey);
    expect(pageContent(draft)).toEqual(contentOf(draft.templateKey!, draft.settings));
  });
});
