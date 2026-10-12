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
 *   saveDraftPage / saveServiceDisplay   edit the Draft; a Published version is never touched
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
import { isSectionType, readProps, validateProps, type Props, type SectionType } from "@/lib/site-sections";
import { validateContent, validateTemplateDefinition, type SiteContent } from "@/lib/site-template";
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

export type SectionEdit = { visible: boolean; props: unknown };
export type PageEdit = { sections: Record<string, SectionEdit> };

/**
 * Save one page of the Draft: for each section the edit names, its visibility and its text. Every section's text is validated against
 * its type and variant (lib/site-sections) before anything is written, and a section the page does not have is refused. Sections the
 * edit does not name are left as they are. Nothing but the Draft can be reached: a Published page is not selectable here.
 */
export async function saveDraftPage(ctx: SiteContext, siteId: string, pageKey: string, edit: PageEdit): Promise<void> {
  const { tx, organizationId } = ctx;
  await lockSite(tx, organizationId, siteId);
  const draft = await findDraft(tx, organizationId, siteId);
  if (!draft) return refuse("This website has no draft yet.");
  const pageRows = await tx
    .select()
    .from(sitePages)
    .where(and(eq(sitePages.organizationId, organizationId), eq(sitePages.siteVersionId, draft.id), eq(sitePages.pageKey, pageKey)))
    .limit(1);
  const page = pageRows[0];
  if (!page) return refuse("That page no longer exists. Reload the page and try again.");
  const existing = await tx.select().from(siteSections).where(and(eq(siteSections.organizationId, organizationId), eq(siteSections.pageId, page.id)));

  const changes: { row: SiteSectionRow; props: Props; visible: boolean }[] = [];
  const problems: Record<string, string> = {};
  for (const [key, change] of Object.entries(edit.sections)) {
    const row = existing.find((candidate) => candidate.sectionKey === key);
    if (!row) return refuse("That section no longer exists. Reload the page and try again.");
    if (typeof change.visible !== "boolean") return refuse("The section's visibility was not understood.");
    const checked = validateProps(row.type, row.variant, change.props);
    if (!checked.ok) {
      if (Object.keys(checked.fields).length === 0) return refuse(checked.error);
      for (const [field, message] of Object.entries(checked.fields)) problems[`${key}.${field}`] = message;
      continue;
    }
    changes.push({ row, props: checked.props, visible: change.visible });
  }
  if (Object.keys(problems).length > 0) return refuse("Check the highlighted fields.", problems);

  for (const { row, props, visible } of changes) {
    // validateProps accepted the type, so it is a registered one.
    if (visible === row.isVisible && JSON.stringify(props) === JSON.stringify(readProps(row.type as SectionType, row.variant, row.props))) continue;
    await tx
      .update(siteSections)
      .set({ props, isVisible: visible })
      .where(and(eq(siteSections.organizationId, organizationId), eq(siteSections.id, row.id)));
  }
}

const SERVICE_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Which Services the Draft shows and in what order: references by Service slug, resolved against the business's own Services when drawn. */
export async function saveServiceDisplay(ctx: SiteContext, siteId: string, display: unknown): Promise<void> {
  const { tx, organizationId } = ctx;
  if (typeof display !== "object" || display === null || Array.isArray(display)) return refuse("The list of Services was not understood.");
  const { order, hidden } = display as Record<string, unknown>;
  const list = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.length <= 200 && value.every((item) => typeof item === "string" && SERVICE_REF.test(item) && item.length <= 80) ? [...new Set(value as string[])] : undefined;
  const cleanOrder = list(order);
  const cleanHidden = list(hidden);
  if (!cleanOrder || !cleanHidden) return refuse("The list of Services was not understood.");
  await lockSite(tx, organizationId, siteId);
  const draft = await findDraft(tx, organizationId, siteId);
  if (!draft) return refuse("This website has no draft yet.");
  const settings = { ...(typeof draft.settings === "object" && draft.settings !== null ? (draft.settings as Record<string, unknown>) : {}), serviceDisplay: { order: cleanOrder, hidden: cleanHidden } };
  await tx.update(siteVersions).set({ settings }).where(and(eq(siteVersions.organizationId, organizationId), eq(siteVersions.id, draft.id)));
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
export async function publishSite(ctx: SiteContext, siteId: string, userId: string): Promise<Published> {
  const { tx, organizationId } = ctx;
  const site = await lockSite(tx, organizationId, siteId);
  const draftRow = await findDraft(tx, organizationId, siteId);
  if (!draftRow) return refuse("This website has no draft to publish.");
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
