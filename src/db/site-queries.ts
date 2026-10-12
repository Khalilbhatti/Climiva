/**
 * Sites, Site Versions, Pages and Sections: the data access the Website module uses, inside an open tenant transaction.
 *
 * This is the ONE place that reads and writes a Site's content; no component, page or action builds its own query. Every function takes
 * the transaction and the verified organization (never an organization from a request) and resolves every site it names INSIDE that
 * organization, so a site of another business is indistinguishable from one that does not exist. PostgreSQL's Row Level Security applies
 * on top (src/db/tenant.ts): this code is never the only check.
 *
 * The lifecycle it implements:
 *
 *   createSite                  a Site (an organization may have many); the first is its primary site
 *   createDraftFromTemplate     the Site's one Draft, from an application template: theme, settings, pages, sections
 *   replaceDraftWithTemplate    the same, over an existing Draft, only when the caller says the Draft may be replaced
 *   saveSiteDraft               save the whole Draft the Builder edited (theme, settings, pages, sections) in one transaction, against a revision
 *   publishSite                 validate the whole Draft, then copy it into a NEW immutable Published version and point the site at it
 *   unpublishSite               the site is private again; its versions are kept
 *   connect/remove a custom domain, choose the primary address
 *
 * Every write that changes a site first locks the site row (`FOR UPDATE`), so two requests for one site queue up instead of
 * interleaving: two publishes get two different version numbers (or the second finds nothing left to publish), and an edit never lands
 * halfway through a snapshot.
 *
 * No `server-only` import on purpose (the data layer is shared with scripts and tests); nothing under src/ that is a Client Component
 * may import this file (a test enforces it).
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { hasUnpublishedChanges, type CustomDomainStatus, type DomainState, type PageModel, type PageType, type SectionModel, type VersionModel, type VersionSettings, type WebsiteState } from "@/data/website";
import { refuse } from "@/lib/refusal";
import { normalizeDomain, DOMAIN_PROBLEM } from "@/lib/site-domain";
import { problemFields } from "@/lib/site-builder-fields";
import { PAGE_RULES, STALE_DRAFT } from "@/lib/site-builder-rules";
import { isSectionType, readProps } from "@/lib/site-sections";
import { validateContent, validateTemplateDefinition, type ContentPage, type SiteContent } from "@/lib/site-template";
import { readTheme } from "@/lib/site-theme";
import type { Tx } from "./index";
import { siteTemplates, sitePages, siteSections, sites, siteVersions, type SitePageRow, type SiteRow, type SiteSectionRow, type SiteVersionRow } from "./schema";
import { stableId } from "./stable-id";

export type SiteContext = { tx: Tx; organizationId: string };

/** Names the id a seeded row gets, so a rebuilt database gives a sample site the same identity. Absent: a random id. */
export type IdMaker = (kind: "version" | "page" | "section", key: string) => string;

/** The deterministic ids of the sample sites' rows: stable across rebuilds, distinct per organization, site and version. */
export const stableSiteIds = (organizationId: string, siteSlug: string, versionTag: string): IdMaker => (kind, key) =>
  stableId(organizationId, `site-${kind}`, `${siteSlug}:${versionTag}:${key}`);

/* ───────────────────────── reading ───────────────────────── */

export async function findSite(tx: Tx, organizationId: string, siteId: string): Promise<SiteRow | undefined> {
  const rows = await tx.select().from(sites).where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId))).limit(1);
  return rows[0];
}

/** The organization's primary site: the one the Website module edits. */
export async function findPrimarySite(tx: Tx, organizationId: string): Promise<SiteRow | undefined> {
  const rows = await tx.select().from(sites).where(and(eq(sites.organizationId, organizationId), eq(sites.isPrimary, true))).limit(1);
  return rows[0];
}

export async function listSites(tx: Tx, organizationId: string): Promise<SiteRow[]> {
  return tx.select().from(sites).where(eq(sites.organizationId, organizationId)).orderBy(asc(sites.createdAt), asc(sites.slug));
}

function readSettings(raw: unknown): VersionSettings {
  const empty: VersionSettings = { serviceDisplay: { order: [], hidden: [] } };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return empty;
  const display = (raw as Record<string, unknown>).serviceDisplay;
  if (typeof display !== "object" || display === null || Array.isArray(display)) return empty;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  return { serviceDisplay: { order: strings((display as Record<string, unknown>).order), hidden: strings((display as Record<string, unknown>).hidden) } };
}

function sectionModel(row: SiteSectionRow): SectionModel | undefined {
  // A row whose type or variant this application does not know is not drawn (and a Publish refuses it): it fails safely.
  if (!isSectionType(row.type)) return undefined;
  return {
    id: row.id,
    key: row.sectionKey,
    label: row.label,
    type: row.type,
    variant: row.variant,
    props: readProps(row.type, row.variant, row.props),
    visible: row.isVisible,
    sortOrder: row.sortOrder,
  };
}

function versionModel(version: SiteVersionRow, templateKey: string | null, pages: SitePageRow[], sectionRows: SiteSectionRow[]): VersionModel {
  const byPage = new Map<string, SiteSectionRow[]>();
  for (const row of sectionRows) byPage.set(row.pageId, [...(byPage.get(row.pageId) ?? []), row]);
  return {
    id: version.id,
    number: version.versionNumber,
    revision: version.revision,
    status: version.status as VersionModel["status"],
    templateKey,
    theme: readTheme(version.theme),
    settings: readSettings(version.settings),
    publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    pages: pages
      .map((page): PageModel => ({
        id: page.id,
        key: page.pageKey,
        title: page.title,
        slug: page.slug,
        type: page.pageType as PageType,
        visible: page.isVisible,
        sortOrder: page.sortOrder,
        sections: (byPage.get(page.id) ?? []).map(sectionModel).filter((section): section is SectionModel => section !== undefined).sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

async function loadVersionModels(tx: Tx, organizationId: string, siteId: string, wanted: readonly SiteVersionRow[]): Promise<VersionModel[]> {
  if (wanted.length === 0) return [];
  const ids = wanted.map((version) => version.id);
  const [pages, sectionRows, templates] = await Promise.all([
    tx.select().from(sitePages).where(and(eq(sitePages.organizationId, organizationId), eq(sitePages.siteId, siteId), inArray(sitePages.siteVersionId, ids))),
    tx.select().from(siteSections).where(and(eq(siteSections.organizationId, organizationId), eq(siteSections.siteId, siteId), inArray(siteSections.siteVersionId, ids))),
    tx.select({ id: siteTemplates.id, key: siteTemplates.key }).from(siteTemplates),
  ]);
  const templateKey = new Map(templates.map((template) => [template.id, template.key]));
  return wanted.map((version) =>
    versionModel(
      version,
      version.templateId ? (templateKey.get(version.templateId) ?? null) : null,
      pages.filter((page) => page.siteVersionId === version.id),
      sectionRows.filter((section) => section.siteVersionId === version.id),
    ),
  );
}

export function domainOf(site: Pick<SiteRow, "customDomain" | "customDomainStatus" | "primaryDomain">): DomainState {
  const custom = site.customDomain ?? undefined;
  return {
    custom,
    customStatus: custom ? ((site.customDomainStatus as CustomDomainStatus | null) ?? "pending_verification") : undefined,
    primary: custom && site.primaryDomain === custom ? "custom" : "climvia",
  };
}

/**
 * What the Website module holds for one site: its Draft and, while it is published, the Published snapshot visitors see. Null when the
 * site has no Draft yet (a site made before this phase, or one the business has not created a website for).
 */
export async function loadWebsiteState(tx: Tx, organizationId: string, site: SiteRow): Promise<WebsiteState | null> {
  const versions = await tx
    .select()
    .from(siteVersions)
    .where(and(eq(siteVersions.organizationId, organizationId), eq(siteVersions.siteId, site.id)));
  const draft = versions.find((version) => version.status === "draft");
  if (!draft) return null;
  const live = site.publishedVersionId ? versions.find((version) => version.id === site.publishedVersionId) : undefined;
  const [draftModel, liveModel] = await loadVersionModels(tx, organizationId, site.id, live ? [draft, live] : [draft]);
  return {
    site: { id: site.id, name: site.name, platformSlug: site.platformSlug },
    published: site.status === "published" && liveModel !== undefined,
    draft: draftModel,
    live: liveModel ?? null,
    domain: domainOf(site),
  };
}

/** The primary site's website state, or null (no primary site, or no Draft yet). */
export async function loadPrimaryWebsite(tx: Tx, organizationId: string): Promise<WebsiteState | null> {
  const site = await findPrimarySite(tx, organizationId);
  return site ? loadWebsiteState(tx, organizationId, site) : null;
}

/** Every published version of a site, newest first: the history a rollback would read. */
export async function listPublishedVersions(tx: Tx, organizationId: string, siteId: string): Promise<{ id: string; number: number; publishedAt: Date | null }[]> {
  const rows = await tx
    .select({ id: siteVersions.id, number: siteVersions.versionNumber, publishedAt: siteVersions.publishedAt })
    .from(siteVersions)
    .where(and(eq(siteVersions.organizationId, organizationId), eq(siteVersions.siteId, siteId), eq(siteVersions.status, "published")))
    .orderBy(sql`${siteVersions.versionNumber} desc`);
  return rows.map((row) => ({ id: row.id, number: row.number ?? 0, publishedAt: row.publishedAt }));
}

/* ───────────────────────── creating ───────────────────────── */

export type NewSite = { name: string; slug: string; platformSlug: string; isPrimary?: boolean };

/** A Site for the organization. The first one is its primary site unless the caller says otherwise. */
export async function createSite(tx: Tx, organizationId: string, input: NewSite): Promise<string> {
  const existing = await tx.select({ id: sites.id }).from(sites).where(eq(sites.organizationId, organizationId)).limit(1);
  const [row] = await tx
    .insert(sites)
    .values({ organizationId, name: input.name, slug: input.slug, platformSlug: input.platformSlug, isPrimary: input.isPrimary ?? existing.length === 0, status: "draft" })
    .returning({ id: sites.id });
  return row.id;
}

/** The ACTIVE template with this key, validated. A template that does not validate is refused, never drawn. */
export async function loadTemplate(tx: Tx, key: string): Promise<{ id: string; key: string; definition: SiteContent }> {
  const rows = await tx.select().from(siteTemplates).where(and(eq(siteTemplates.key, key), eq(siteTemplates.isActive, true))).limit(1);
  const row = rows[0];
  if (!row) return refuse("That website template is not available.");
  const checked = validateTemplateDefinition(row.definition);
  if (!checked.ok) {
    console.error("[sites] template does not validate:", row.key, JSON.stringify(checked.problems).slice(0, 500));
    return refuse("That website template is not available.");
  }
  const { schema: _schema, ...content } = checked.definition;
  void _schema;
  return { id: row.id, key: row.key, definition: content };
}

async function insertContent(tx: Tx, organizationId: string, siteId: string, versionId: string, content: SiteContent, ids?: IdMaker): Promise<void> {
  const pages = content.pages.map((page, index) => ({ page, row: { id: ids ? ids("page", `${page.key}`) : randomUUID(), sortOrder: index } }));
  if (pages.length === 0) return;
  await tx.insert(sitePages).values(
    pages.map(({ page, row }) => ({
      id: row.id,
      organizationId,
      siteId,
      siteVersionId: versionId,
      pageKey: page.key,
      title: page.title,
      slug: page.slug,
      pageType: page.type,
      sortOrder: row.sortOrder,
      isVisible: page.visible,
    })),
  );
  const sectionRows = pages.flatMap(({ page, row }) =>
    page.sections.map((section, index) => ({
      id: ids ? ids("section", `${page.key}.${section.key}`) : randomUUID(),
      organizationId,
      siteId,
      siteVersionId: versionId,
      pageId: row.id,
      sectionKey: section.key,
      label: section.label,
      type: section.type,
      variant: section.variant,
      props: section.props,
      sortOrder: index,
      isVisible: section.visible,
    })),
  );
  if (sectionRows.length > 0) await tx.insert(siteSections).values(sectionRows);
}

async function lockSite(tx: Tx, organizationId: string, siteId: string): Promise<SiteRow> {
  const rows = await tx.select().from(sites).where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId))).limit(1).for("update");
  const site = rows[0];
  if (!site) return refuse("That website no longer exists. Reload the page and try again.");
  return site;
}

async function findDraft(tx: Tx, organizationId: string, siteId: string): Promise<SiteVersionRow | undefined> {
  const rows = await tx
    .select()
    .from(siteVersions)
    .where(and(eq(siteVersions.organizationId, organizationId), eq(siteVersions.siteId, siteId), eq(siteVersions.status, "draft")))
    .limit(1);
  return rows[0];
}

/**
 * The site's one Draft, made from an application template: the theme, the settings, every page and every section. Refused when the site
 * already has a Draft (use replaceDraftWithTemplate, which is deliberate). Returns the Draft's id.
 */
export async function createDraftFromTemplate(ctx: SiteContext, siteId: string, templateKey: string, options: { ids?: IdMaker; content?: SiteContent } = {}): Promise<string> {
  const { tx, organizationId } = ctx;
  await lockSite(tx, organizationId, siteId);
  if (await findDraft(tx, organizationId, siteId)) return refuse("This website already has a draft.");
  const template = await loadTemplate(tx, templateKey);
  const content = options.content ?? template.definition;
  const checked = validateContent(content);
  if (!checked.ok) return refuse("The website content is not valid.", { content: checked.problems[0]?.message ?? "Not valid." });
  const versionId = options.ids ? options.ids("version", "draft") : randomUUID();
  await tx.insert(siteVersions).values({
    id: versionId,
    organizationId,
    siteId,
    versionNumber: null,
    status: "draft",
    templateId: template.id,
    theme: checked.content.theme,
    settings: checked.content.settings,
  });
  await insertContent(tx, organizationId, siteId, versionId, checked.content, options.ids);
  await tx.update(sites).set({ selectedTemplateId: template.id }).where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)));
  return versionId;
}

/**
 * Put a template's content over the site's Draft. This DESTROYS the Draft's pages and sections, so the caller must say so
 * (`confirmReplace: true`); a Published version is never touched.
 */
export async function replaceDraftWithTemplate(ctx: SiteContext, siteId: string, templateKey: string, options: { confirmReplace: boolean }): Promise<string> {
  const { tx, organizationId } = ctx;
  if (options.confirmReplace !== true) return refuse("Replacing the draft with a template discards its pages. Confirm to continue.");
  await lockSite(tx, organizationId, siteId);
  const draft = await findDraft(tx, organizationId, siteId);
  if (!draft) return refuse("This website has no draft to replace.");
  const template = await loadTemplate(tx, templateKey);
  const checked = validateContent(template.definition);
  if (!checked.ok) return refuse("That website template is not available.");
  await tx.delete(siteSections).where(and(eq(siteSections.organizationId, organizationId), eq(siteSections.siteVersionId, draft.id)));
  await tx.delete(sitePages).where(and(eq(sitePages.organizationId, organizationId), eq(sitePages.siteVersionId, draft.id)));
  await tx
    .update(siteVersions)
    .set({ theme: checked.content.theme, settings: checked.content.settings, templateId: template.id })
    .where(and(eq(siteVersions.organizationId, organizationId), eq(siteVersions.id, draft.id)));
  await insertContent(tx, organizationId, siteId, draft.id, checked.content);
  await tx.update(sites).set({ selectedTemplateId: template.id }).where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)));
  return draft.id;
}

/* ───────────────────────── editing the Draft ───────────────────────── */

/** Two JSON values are the same when their keys and values are, whatever order the database or the caller wrote the keys in. */
function canonical(value: unknown): string {
  const sorted = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(sorted)
      : typeof input === "object" && input !== null
        ? Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sorted(item)]))
        : input;
  return JSON.stringify(sorted(value));
}

export type DraftSave = { revision: number; changed: boolean };

/**
 * Save the whole Draft the Website Builder edited: its theme, its settings and every page with its sections, in order. One transaction,
 * and the Site is locked first, so two saves (or a save and a publish) queue up and never interleave.
 *
 *   - `expectedRevision` is the revision the editor opened the Draft at. If the stored Draft has moved on (another tab saved), nothing is
 *     written and the answer is STALE_DRAFT: a copy that is behind never overwrites a newer one.
 *   - The content is validated as a whole (`validateContent`: every section against its registered type and variant, plain text only,
 *     addresses unique and not reserved, the home page present and visible, the booking page keeping its list of Services) before anything
 *     is written, and the structural rules that depend on what is stored are checked here: the home page and the booking page cannot be
 *     deleted, and no page changes kind.
 *   - Rows are matched by KEY (a page by its `page_key`, a section by its key within its page), never by an id from the request, so the
 *     request cannot name another site's or another business's row. Rows the content no longer has are deleted, new ones are inserted
 *     with new ids, changed ones are updated (only the columns that changed), unchanged ones are left alone. Only the Draft's rows are
 *     reachable: a Published version's rows are not selectable here and PostgreSQL refuses to write them anyway.
 *
 * Returns the new revision. Saving what is already stored writes nothing and does not move the revision.
 */
export async function saveSiteDraft(ctx: SiteContext, siteId: string, input: { expectedRevision: unknown; content: unknown }): Promise<DraftSave> {
  const { tx, organizationId } = ctx;
  await lockSite(tx, organizationId, siteId);
  const draftRow = await findDraft(tx, organizationId, siteId);
  if (!draftRow) return refuse("This website has no draft yet.");
  if (typeof input.expectedRevision !== "number" || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) return refuse("The website was not understood.");
  if (draftRow.revision !== input.expectedRevision) return refuse(STALE_DRAFT);

  const checked = validateContent(input.content);
  if (!checked.ok) return refuse(`The website can't be saved yet. ${checked.problems[0]?.message ?? ""}`.trim(), problemFields(checked.problems));
  const content = checked.content;

  const stored = await loadRawDraft(tx, organizationId, draftRow);
  const storedByKey = new Map(stored.pages.map((row) => [row.pageKey, row]));
  const keptKeys = new Set(content.pages.map((page) => page.key));

  // What cannot change, whatever the request says.
  for (const row of stored.pages) {
    const rule = PAGE_RULES[row.pageType as PageType];
    if (!keptKeys.has(row.pageKey) && !(rule?.removable ?? false)) return refuse(rule?.reason ?? "That page can't be deleted.");
  }
  for (const page of content.pages) {
    const row = storedByKey.get(page.key);
    if (row && row.pageType !== page.type) return refuse("The kind of a page can't change.");
  }

  let changed = false;
  const where = {
    page: (id: string) => and(eq(sitePages.organizationId, organizationId), eq(sitePages.id, id)),
    section: (id: string) => and(eq(siteSections.organizationId, organizationId), eq(siteSections.id, id)),
  };

  // 1. Pages the content no longer has go, with their sections.
  const goneIds = stored.pages.filter((row) => !keptKeys.has(row.pageKey)).map((row) => row.id);
  if (goneIds.length > 0) {
    await tx.delete(siteSections).where(and(eq(siteSections.organizationId, organizationId), inArray(siteSections.pageId, goneIds)));
    await tx.delete(sitePages).where(and(eq(sitePages.organizationId, organizationId), inArray(sitePages.id, goneIds)));
    changed = true;
  }

  // 2. Sections a kept page no longer has (or has with another type: a section's type is its identity, so it is replaced) go.
  const sectionsOf = (pageId: string) => stored.sections.filter((row) => row.pageId === pageId);
  for (const page of content.pages) {
    const row = storedByKey.get(page.key);
    if (!row) continue;
    const gone = sectionsOf(row.id).filter((section) => {
      const next = page.sections.find((candidate) => candidate.key === section.sectionKey);
      return !next || next.type !== section.type;
    });
    if (gone.length > 0) {
      await tx.delete(siteSections).where(and(eq(siteSections.organizationId, organizationId), inArray(siteSections.id, gone.map((section) => section.id))));
      changed = true;
    }
  }

  // 3. A page's address is unique within the Draft, and two kept pages may swap addresses: park the ones that change under a temporary one first.
  const slugChanged = content.pages.filter((page) => {
    const row = storedByKey.get(page.key);
    return row !== undefined && row.slug !== page.slug;
  });
  for (const page of slugChanged) {
    await tx.update(sitePages).set({ slug: `tmp-${randomUUID()}` }).where(where.page(storedByKey.get(page.key)!.id));
    changed = true;
  }

  // 4. Kept pages: the columns that changed.
  const order = new Map(content.pages.map((page, index) => [page.key, index]));
  for (const page of content.pages) {
    const row = storedByKey.get(page.key);
    if (!row) continue;
    const patch: Partial<typeof sitePages.$inferInsert> = {};
    if (row.title !== page.title) patch.title = page.title;
    if (row.slug !== page.slug) patch.slug = page.slug;
    if (row.isVisible !== page.visible) patch.isVisible = page.visible;
    if (row.sortOrder !== order.get(page.key)) patch.sortOrder = order.get(page.key)!;
    if (Object.keys(patch).length > 0) {
      await tx.update(sitePages).set(patch).where(where.page(row.id));
      changed = true;
    }
  }

  // 5. New pages, with their sections.
  const insertSections = async (pageId: string, page: ContentPage, only?: Set<string>) => {
    const rows = page.sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) => !only || only.has(section.key))
      .map(({ section, index }) => ({
        id: randomUUID(),
        organizationId,
        siteId,
        siteVersionId: draftRow.id,
        pageId,
        sectionKey: section.key,
        label: section.label,
        type: section.type,
        variant: section.variant,
        props: section.props,
        sortOrder: index,
        isVisible: section.visible,
      }));
    if (rows.length > 0) {
      await tx.insert(siteSections).values(rows);
      changed = true;
    }
  };
  for (const page of content.pages) {
    if (storedByKey.has(page.key)) continue;
    const id = randomUUID();
    await tx.insert(sitePages).values({
      id,
      organizationId,
      siteId,
      siteVersionId: draftRow.id,
      pageKey: page.key,
      title: page.title,
      slug: page.slug,
      pageType: page.type,
      sortOrder: order.get(page.key)!,
      isVisible: page.visible,
    });
    changed = true;
    await insertSections(id, page);
  }

  // 6. Kept pages' sections: changed ones are updated, new (and replaced) ones are inserted.
  for (const page of content.pages) {
    const row = storedByKey.get(page.key);
    if (!row) continue;
    const existing = new Map(sectionsOf(row.id).map((section) => [section.sectionKey, section]));
    const fresh = new Set<string>();
    for (const [index, section] of page.sections.entries()) {
      const before = existing.get(section.key);
      if (!before || before.type !== section.type) {
        fresh.add(section.key);
        continue;
      }
      const patch: Partial<typeof siteSections.$inferInsert> = {};
      if (before.label !== section.label) patch.label = section.label;
      if (before.variant !== section.variant) patch.variant = section.variant;
      if (canonical(before.props) !== canonical(section.props)) patch.props = section.props;
      if (before.sortOrder !== index) patch.sortOrder = index;
      if (before.isVisible !== section.visible) patch.isVisible = section.visible;
      if (Object.keys(patch).length > 0) {
        await tx.update(siteSections).set(patch).where(where.section(before.id));
        changed = true;
      }
    }
    await insertSections(row.id, page, fresh);
  }

  // 7. The theme and the site-wide settings live on the version.
  if (canonical(draftRow.theme) !== canonical(content.theme) || canonical(draftRow.settings) !== canonical(content.settings)) {
    await tx
      .update(siteVersions)
      .set({ theme: content.theme, settings: content.settings })
      .where(and(eq(siteVersions.organizationId, organizationId), eq(siteVersions.id, draftRow.id)));
    changed = true;
  }

  const [{ revision }] = await tx.select({ revision: siteVersions.revision }).from(siteVersions).where(and(eq(siteVersions.organizationId, organizationId), eq(siteVersions.id, draftRow.id)));
  return { revision, changed };
}

/* ───────────────────────── publishing ───────────────────────── */

type RawDraft = { version: SiteVersionRow; pages: SitePageRow[]; sections: SiteSectionRow[] };

async function loadRawDraft(tx: Tx, organizationId: string, version: SiteVersionRow): Promise<RawDraft> {
  const [pages, sections] = await Promise.all([
    tx.select().from(sitePages).where(and(eq(sitePages.organizationId, organizationId), eq(sitePages.siteVersionId, version.id))).orderBy(asc(sitePages.sortOrder)),
    tx.select().from(siteSections).where(and(eq(siteSections.organizationId, organizationId), eq(siteSections.siteVersionId, version.id))).orderBy(asc(siteSections.sortOrder)),
  ]);
  return { version, pages, sections };
}

/** The Draft as the content validator sees it, from the stored rows (nothing is dropped, so what is wrong can be said). */
function rawContent(draft: RawDraft): unknown {
  return {
    theme: draft.version.theme,
    settings: draft.version.settings,
    pages: draft.pages.map((page) => ({
      key: page.pageKey,
      title: page.title,
      slug: page.slug,
      type: page.pageType,
      visible: page.isVisible,
      sections: draft.sections
        .filter((section) => section.pageId === page.id)
        .map((section) => ({ key: section.sectionKey, label: section.label, type: section.type, variant: section.variant, visible: section.isVisible, props: section.props })),
    })),
  };
}

/** What stops a Draft from being published, in words: every problem the whole-site validation finds. */
export function publishProblems(draft: unknown): string[] {
  const checked = validateContent(draft);
  if (checked.ok) return [];
  return checked.problems.slice(0, 8).map((problem) => [problem.page, problem.section, problem.message].filter(Boolean).join(" · "));
}

export type Published = { versionId: string; number: number; changed: boolean };

/**
 * Publish: validate the whole Draft, then copy its theme, settings, pages and sections into a NEW Published version and point the site
 * at it. All in the caller's transaction, so a failure anywhere (an invalid section, a database error) leaves the site exactly as it was.
 *
 * The site row is locked first, so two publishes of one site queue up; the version number is the next one under that lock (and unique in
 * the database). If the site is already published with exactly the Draft's content there is nothing to publish: the current version is
 * returned and no copy is made. Editing the Draft afterwards never touches a Published version.
 */
export async function publishSite(ctx: SiteContext, siteId: string, userId: string, options: { expectedRevision?: number } = {}): Promise<Published> {
  const { tx, organizationId } = ctx;
  const site = await lockSite(tx, organizationId, siteId);
  const draftRow = await findDraft(tx, organizationId, siteId);
  if (!draftRow) return refuse("This website has no draft to publish.");
  // The Builder publishes the Draft it is showing: if the stored one has moved on, it is not the one the person looked at.
  if (options.expectedRevision !== undefined && draftRow.revision !== options.expectedRevision) return refuse(STALE_DRAFT);
  const draft = await loadRawDraft(tx, organizationId, draftRow);

  const problems = publishProblems(rawContent(draft));
  if (problems.length > 0) return refuse(`The website can't be published yet. ${problems.join(" ")}`);

  // Already live with exactly this content: nothing to publish.
  if (site.status === "published" && site.publishedVersionId) {
    const state = await loadWebsiteState(tx, organizationId, site);
    if (state && !hasUnpublishedChanges(state) && state.live) return { versionId: state.live.id, number: state.live.number ?? 0, changed: false };
  }

  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${siteVersions.versionNumber}), 0) + 1` })
    .from(siteVersions)
    .where(and(eq(siteVersions.organizationId, organizationId), eq(siteVersions.siteId, siteId)));

  // Touch the site row: the policies allow a Published version (and its pages and sections) to be written only in a transaction that
  // has just changed the site it belongs to, which is this one.
  await tx.update(sites).set({ status: sql`${sites.status}` }).where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)));

  const versionId = randomUUID();
  await tx.insert(siteVersions).values({
    id: versionId,
    organizationId,
    siteId,
    versionNumber: next,
    status: "published",
    templateId: draftRow.templateId,
    theme: draftRow.theme,
    settings: draftRow.settings,
    publishedAt: sql`now()`,
    publishedByUserId: userId,
  });

  const pageIds = new Map(draft.pages.map((page) => [page.id, randomUUID()]));
  if (draft.pages.length > 0) {
    await tx.insert(sitePages).values(
      draft.pages.map((page) => ({
        id: pageIds.get(page.id)!,
        organizationId,
        siteId,
        siteVersionId: versionId,
        pageKey: page.pageKey,
        title: page.title,
        slug: page.slug,
        pageType: page.pageType,
        sortOrder: page.sortOrder,
        isVisible: page.isVisible,
      })),
    );
  }
  if (draft.sections.length > 0) {
    await tx.insert(siteSections).values(
      draft.sections.map((section) => ({
        id: randomUUID(),
        organizationId,
        siteId,
        siteVersionId: versionId,
        pageId: pageIds.get(section.pageId)!,
        sectionKey: section.sectionKey,
        label: section.label,
        type: section.type,
        variant: section.variant,
        props: section.props,
        sortOrder: section.sortOrder,
        isVisible: section.isVisible,
      })),
    );
  }

  await tx
    .update(sites)
    .set({ status: "published", publishedVersionId: versionId })
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)));
  return { versionId, number: next, changed: true };
}

/** Make the site private. Its versions, pages and content are kept; visitors can no longer open it. */
export async function unpublishSite(ctx: SiteContext, siteId: string): Promise<void> {
  const { tx, organizationId } = ctx;
  await lockSite(tx, organizationId, siteId);
  await tx
    .update(sites)
    .set({ status: "draft", publishedVersionId: null })
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)));
}

/* ───────────────────────── the site's addresses ───────────────────────── */

/** Record a custom domain for the site. Nothing is verified: it is stored as pending verification and the platform address stays main. */
export async function connectCustomDomain(ctx: SiteContext, siteId: string, input: unknown): Promise<string> {
  const { tx, organizationId } = ctx;
  const host = typeof input === "string" && input.length <= 300 ? normalizeDomain(input) : undefined;
  if (!host) return refuse(DOMAIN_PROBLEM, { domain: DOMAIN_PROBLEM });
  await lockSite(tx, organizationId, siteId);
  // Recording a domain is a claim, not a verification: several businesses may name the same one, and nothing is revealed about any of them.
  await tx
    .update(sites)
    .set({ customDomain: host, customDomainStatus: "pending_verification", primaryDomain: null })
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)));
  return host;
}

export async function removeCustomDomain(ctx: SiteContext, siteId: string): Promise<void> {
  const { tx, organizationId } = ctx;
  await lockSite(tx, organizationId, siteId);
  await tx
    .update(sites)
    .set({ customDomain: null, customDomainStatus: null, primaryDomain: null })
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)));
}

/** Which address is the main one. The custom domain can be made main only while one is recorded. */
export async function setPrimaryAddress(ctx: SiteContext, siteId: string, primary: unknown): Promise<void> {
  const { tx, organizationId } = ctx;
  if (primary !== "climvia" && primary !== "custom") return refuse("The address was not understood.");
  const site = await lockSite(tx, organizationId, siteId);
  if (primary === "custom" && !site.customDomain) return refuse("There is no custom domain to make the main address.");
  await tx
    .update(sites)
    .set({ primaryDomain: primary === "custom" ? site.customDomain : null })
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)));
}

/* ───────────────────────── seeding and tests ───────────────────────── */

export type SeedSite = {
  name: string;
  slug: string;
  platformSlug: string;
  isPrimary: boolean;
  /** The template the site's content starts from. */
  template: string;
  /** The Draft's content (the template with the business's own authored copy over it). */
  draft: SiteContent;
  /** The content of each Published version, in order (1, 2 ...). The last one is the live one. Empty: the site is private. */
  published: readonly SiteContent[];
  customDomain?: { host: string; status: CustomDomainStatus; primary: boolean };
};

/**
 * Write a sample site complete with its history, as an owner connection (the seed): the Draft, each Published version in order, and the
 * pointer. Published rows are written directly; this is seed code, not the application.
 */
export async function insertSeedSite(tx: Tx, organizationId: string, seed: SeedSite): Promise<string> {
  const template = await loadTemplate(tx, seed.template);
  const existing = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.organizationId, organizationId), eq(sites.slug, seed.slug))).limit(1);
  let siteId = existing[0]?.id;
  if (!siteId) {
    const [row] = await tx
      .insert(sites)
      .values({ organizationId, name: seed.name, slug: seed.slug, platformSlug: seed.platformSlug, isPrimary: seed.isPrimary, status: "draft", selectedTemplateId: template.id })
      .returning({ id: sites.id });
    siteId = row.id;
  } else {
    await tx.update(sites).set({ name: seed.name, selectedTemplateId: template.id }).where(eq(sites.id, siteId));
  }

  const check = (content: SiteContent) => {
    const checked = validateContent(content);
    if (!checked.ok) throw new Error(`The seed content for site "${seed.slug}" is not valid: ${JSON.stringify(checked.problems[0])}`);
    return checked.content;
  };

  const draftIds = stableSiteIds(organizationId, seed.slug, "draft");
  const draft = check(seed.draft);
  const draftId = draftIds("version", "draft");
  await tx.insert(siteVersions).values({ id: draftId, organizationId, siteId, versionNumber: null, status: "draft", templateId: template.id, theme: draft.theme, settings: draft.settings });
  await insertContent(tx, organizationId, siteId, draftId, draft, draftIds);

  let lastVersionId: string | undefined;
  for (const [index, snapshot] of seed.published.entries()) {
    const number = index + 1;
    const ids = stableSiteIds(organizationId, seed.slug, `v${number}`);
    const content = check(snapshot);
    const versionId = ids("version", `v${number}`);
    await tx.insert(siteVersions).values({
      id: versionId,
      organizationId,
      siteId,
      versionNumber: number,
      status: "published",
      templateId: template.id,
      theme: content.theme,
      settings: content.settings,
      publishedAt: new Date(Date.UTC(2024, 9, 1 + index, 12, 0, 0)),
    });
    await insertContent(tx, organizationId, siteId, versionId, content, ids);
    lastVersionId = versionId;
  }

  await tx
    .update(sites)
    .set({
      status: lastVersionId ? "published" : "draft",
      publishedVersionId: lastVersionId ?? null,
      customDomain: seed.customDomain?.host ?? null,
      customDomainStatus: seed.customDomain?.status ?? null,
      primaryDomain: seed.customDomain?.primary ? seed.customDomain.host : null,
    })
    .where(eq(sites.id, siteId));
  return siteId;
}

/**
 * Remove a business's sites' versions, pages and sections: so a test copy can be written again. The sites themselves stay, except the ones
 * whose slug is not in `keep` when it is given (a test that created another site leaves nothing behind). Owner connection.
 */
export async function clearSiteContent(tx: Tx, organizationId: string, keep?: readonly string[]): Promise<void> {
  await tx.update(sites).set({ status: "draft", publishedVersionId: null, customDomain: null, customDomainStatus: null, primaryDomain: null }).where(eq(sites.organizationId, organizationId));
  await tx.delete(siteSections).where(eq(siteSections.organizationId, organizationId));
  await tx.delete(sitePages).where(eq(sitePages.organizationId, organizationId));
  await tx.delete(siteVersions).where(eq(siteVersions.organizationId, organizationId));
  if (keep) await tx.delete(sites).where(and(eq(sites.organizationId, organizationId), notInArray(sites.slug, [...keep])));
}
