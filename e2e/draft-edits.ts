/**
 * Draft edits for the specs that need a saved Draft, made the way the Website Builder makes them: read the stored Draft as content, change
 * it, and store the whole of it with `saveSiteDraft` against the revision it was read at. (The Builder is the only editor of a Draft; there
 * is no separate "save one page" path any more.)
 */
import { findSite, loadWebsiteState, saveSiteDraft, type DraftSave, type SiteContext } from "../src/db/site-queries";
import { contentOf } from "../src/lib/site-builder";
import type { SiteContent } from "../src/lib/site-template";

/** The Draft of `siteId` as content, with the revision it is at. Reads inside the caller's transaction. */
export async function readDraft(ctx: SiteContext, siteId: string): Promise<{ content: SiteContent; revision: number }> {
  const site = await findSite(ctx.tx, ctx.organizationId, siteId);
  const website = site ? await loadWebsiteState(ctx.tx, ctx.organizationId, site, { reveal: false, routingTarget: null }) : null;
  if (!website) throw new Error("The site has no website state.");
  return { content: contentOf(website.draft), revision: website.draft.revision };
}

/** Read the Draft, apply `edit` and save the result against the revision that was read. */
export async function editDraft(ctx: SiteContext, siteId: string, edit: (content: SiteContent) => SiteContent): Promise<DraftSave> {
  const { content, revision } = await readDraft(ctx, siteId);
  return saveSiteDraft(ctx, siteId, { expectedRevision: revision, content: edit(content) });
}

/** Save arbitrary content (valid or not) against the Draft's current revision, to ask what the save does with it. */
export async function saveContent(ctx: SiteContext, siteId: string, content: unknown): Promise<DraftSave> {
  const { revision } = await readDraft(ctx, siteId);
  return saveSiteDraft(ctx, siteId, { expectedRevision: revision, content });
}

/** The content with one section changed: its visibility and/or texts (merged over the ones it has). */
export function editSection(content: SiteContent, pageKey: string, sectionKey: string, patch: { visible?: boolean; props?: Record<string, string> }): SiteContent {
  return {
    ...content,
    pages: content.pages.map((page) =>
      page.key !== pageKey
        ? page
        : {
            ...page,
            sections: page.sections.map((section) =>
              section.key !== sectionKey ? section : { ...section, visible: patch.visible ?? section.visible, props: { ...section.props, ...patch.props } },
            ),
          },
    ),
  };
}

/** The home page's hero headline changed: the smallest visible edit to a Draft. */
export const withHeadline = (content: SiteContent, headline: string): SiteContent => editSection(content, "home", "hero", { props: { headline } });

export const setHeadlineOf = (ctx: SiteContext, siteId: string, headline: string): Promise<DraftSave> => editDraft(ctx, siteId, (content) => withHeadline(content, headline));
