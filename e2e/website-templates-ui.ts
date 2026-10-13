/**
 * Helpers for the Template specs: a version of the worker's main Site as stored (revision, Template and whole content, without ids or
 * times), what a Template says in that shape, and the Gallery's controls by the names a person (and a screen reader) sees.
 */
import type { Page } from "playwright/test";
import type { Pool } from "pg";
import { publishSite, replaceDraftWithTemplate, type SiteContext } from "../src/db/site-queries";
import { findTemplateRecord } from "../src/db/site-templates";
import { withTenant } from "../src/db/tenant";
import { Refusal } from "../src/lib/refusal";
import { readDraft } from "./draft-edits";
import { expect } from "./saas";
import { toasts } from "./website-builder-ui";

export type State = "draft" | "live" | number;
export type Stored = { revision: number; templateKey: string | null; theme: unknown; settings: unknown; pages: unknown[] };

/** A version of the worker's main Site as stored: its revision, its Template, and its whole content without ids or times. */
export async function stored(db: Pool, organizationId: string, state: State): Promise<Stored> {
  const which = state === "draft" ? "v.status = 'draft'" : state === "live" ? "v.id = st.published_version_id" : `v.version_number = ${Number(state)}`;
  const row = (
    await db.query<{ revision: number; template_key: string | null; theme: unknown; settings: unknown; pages: unknown[] }>(
      `select v.revision, t.key as template_key, v.theme, v.settings, coalesce((
          select jsonb_agg(jsonb_build_object('key', p.page_key, 'title', p.title, 'slug', p.slug, 'type', p.page_type, 'visible', p.is_visible,
            'sections', coalesce((select jsonb_agg(jsonb_build_object('key', s.section_key, 'label', s.label, 'type', s.type, 'variant', s.variant, 'visible', s.is_visible, 'props', s.props) order by s.sort_order)
                                    from site_sections s where s.page_id = p.id), '[]'::jsonb)) order by p.sort_order)
            from site_pages p where p.site_version_id = v.id), '[]'::jsonb) as pages
         from site_versions v join sites st on st.id = v.site_id left join site_templates t on t.id = v.template_id
        where st.organization_id = $1 and st.slug = 'main' and ${which}`,
      [organizationId],
    )
  ).rows[0];
  return { revision: row.revision, templateKey: row.template_key, theme: row.theme, settings: row.settings, pages: row.pages };
}

/** What a Template says, in the shape `stored` reads back (the Draft keeps the business's own Service choices, so the settings are passed in). */
export const contentOf = (key: string, settings: unknown) => {
  const { definition } = findTemplateRecord(key)!;
  return { theme: definition.theme, settings, pages: definition.pages.map((page) => ({ key: page.key, title: page.title, slug: page.slug, type: page.type, visible: page.visible, sections: page.sections })) };
};
export const pageContent = ({ theme, settings, pages }: Stored) => ({ theme, settings, pages });

export const HEADLINES: Record<string, string> = {
  "climvia-starter": "Heating & cooling service when you need it.",
  precision: "Clear, scheduled heating and cooling service.",
  comfort: "Heating and cooling that keeps your home comfortable.",
  airflow: "Heating and cooling service you can count on.",
};

export const card = (page: Page, key: string) => page.locator(`[data-template="${key}"]`);
export const useButton = (page: Page, name: string) => page.getByRole("button", { name: `Use the ${name} template` });

export async function openGallery(page: Page) {
  await page.goto("/website/templates");
  await expect(page.getByRole("heading", { level: 1, name: "Website templates" })).toBeVisible();
}

export async function chooseTemplate(page: Page, name: string) {
  await useButton(page, name).click();
  const dialog = page.getByRole("dialog", { name: `Replace your draft with ${name}?` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Use a Template: choose it, confirm, and land on the Builder with the new Draft. */
export async function applyTemplate(page: Page, name: string) {
  const dialog = await chooseTemplate(page, name);
  await dialog.getByRole("button", { name: `Replace draft with ${name}` }).click();
  await expect(page).toHaveURL(/\/website\/builder/);
  await expect(toasts(page)).toContainText(`Draft replaced with ${name}. Your published website has not changed.`);
}

export const publicHtml = async (page: Page, platformSlug: string, path = "") => (await page.request.get(`/sites/${platformSlug}${path}`, { headers: { cookie: "" } })).text();


/* ───────────────────────── changing the Draft in the data layer, committing ───────────────────────── */

export type Tenant = { userId: string; organizationId: string; platformSlug: string };

/** Run `work` as the tenant's owner in one transaction. A refused change is returned as `{ refused }` (and rolls the transaction back). */
export async function operate<T>(tenant: Tenant, work: (ctx: SiteContext) => Promise<T>): Promise<{ value: T } | { refused: string }> {
  try {
    return { value: await withTenant({ userId: tenant.userId, organizationId: tenant.organizationId }, (tx) => work({ tx, organizationId: tenant.organizationId })) };
  } catch (error) {
    if (error instanceof Refusal) return { refused: error.message };
    throw error;
  }
}

export const must = async <T>(tenant: Tenant, work: (ctx: SiteContext) => Promise<T>): Promise<T> => {
  const result = await operate(tenant, work);
  if ("refused" in result) throw new Error(`Unexpectedly refused: ${result.refused}`);
  return result.value;
};

export const mainSiteId = async (db: Pool, tenant: Tenant): Promise<string> => (await db.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [tenant.organizationId])).rows[0].id;

/** Put a Template on the Draft (as the Gallery does, against the revision the Draft is at) and, if asked, publish it. Faster than the screens, for specs that are about the result. */
export async function useTemplate(db: Pool, tenant: Tenant, key: string, options: { publish?: boolean } = {}): Promise<void> {
  const site = await mainSiteId(db, tenant);
  const { revision } = await must(tenant, (ctx) => readDraft(ctx, site));
  await must(tenant, (ctx) => replaceDraftWithTemplate(ctx, site, key, { confirmReplace: true, expectedRevision: revision }));
  if (options.publish) await must(tenant, async (ctx) => publishSite(ctx, site, tenant.userId, { expectedRevision: (await readDraft(ctx, site)).revision }));
}
