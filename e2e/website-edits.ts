/**
 * Small pure builders for the Website specs: the same content the seed writes, as the browser holds it (a Draft and a Published snapshot),
 * and the edits a person makes to it, so a spec can ask the comparison rules "what if this page were edited?" without a database.
 */
import { orderedPages, type PageModel, type SectionModel, type VersionModel, type WebsiteState } from "../src/data/website";
import type { SiteContent } from "../src/lib/site-template";

/** A version as the browser holds it, from content (synthetic ids, the order of the arrays as the order on the site). */
export function versionOf(content: SiteContent, status: "draft" | "published" = "draft", number: number | null = null): VersionModel {
  return {
    id: `version-${status}-${number ?? 0}`,
    number,
    status,
    revision: 1,
    templateKey: "climvia-starter",
    theme: content.theme,
    settings: content.settings,
    publishedAt: status === "published" ? "2024-10-01T12:00:00.000Z" : null,
    pages: content.pages.map(
      (page, pageIndex): PageModel => ({
        id: `page-${page.key}`,
        key: page.key,
        title: page.title,
        slug: page.slug,
        type: page.type,
        visible: page.visible,
        sortOrder: pageIndex,
        sections: page.sections.map(
          (section, index): SectionModel => ({
            id: `section-${page.key}-${section.key}`,
            key: section.key,
            label: section.label,
            type: section.type,
            variant: section.variant,
            props: { ...section.props },
            visible: section.visible,
            sortOrder: index,
          }),
        ),
      }),
    ),
  };
}

/** A website whose Draft and Published snapshot are the same content: nothing to publish. */
export function websiteOf(content: SiteContent, options: { published?: boolean; platformSlug?: string } = {}): WebsiteState {
  const published = options.published ?? true;
  return {
    site: { id: "site-main", name: "Main", platformSlug: options.platformSlug ?? "apexclimate" },
    published,
    draft: versionOf(content),
    live: published ? versionOf(content, "published", 1) : null,
    domain: { domains: [], routingTarget: null },
  };
}

/** The same website with one section's text edited in the Draft (a saved edit, not yet published). */
export function withEditedSection(state: WebsiteState, pageKey: string, sectionKey: string, props: Record<string, string>): WebsiteState {
  return {
    ...state,
    draft: {
      ...state.draft,
      pages: state.draft.pages.map((page) =>
        page.key !== pageKey ? page : { ...page, sections: page.sections.map((section) => (section.key !== sectionKey ? section : { ...section, props: { ...section.props, ...props } })) },
      ),
    },
  };
}

/** The same website with its Draft published: the snapshot is a copy of the Draft, numbered next. */
export function withPublished(state: WebsiteState): WebsiteState {
  const number = (state.live?.number ?? 0) + 1;
  return { ...state, published: true, live: { ...state.draft, id: `version-published-${number}`, status: "published", number, publishedAt: "2024-10-02T12:00:00.000Z" } };
}

export const pagesOf = (state: WebsiteState) => orderedPages(state.draft).map((page) => page.key);
