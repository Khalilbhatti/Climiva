import type { AppHref } from "@/config/routes";

/**
 * Where the signed-in preview of the website lives. The preview is the Draft, drawn outside the workspace shell at /website/preview,
 * for people who are signed in to the business. The PUBLISHED site a visitor opens is a different route (/sites/<platform address>,
 * see lib/site-domain `publicSiteHref`), served from the published snapshot only.
 */
export const PREVIEW_BASE = "/website/preview";

/** A page of the Draft preview by its address segment ("" is the home page): `previewHref("services")`, `previewHref("booking/ac-repair")`. */
export function previewHref(path = ""): AppHref {
  return (path === "" ? PREVIEW_BASE : `${PREVIEW_BASE}/${path}`) as AppHref;
}

/** The page-editor route for a page, by its key. */
export const editorHref = (pageKey: string): AppHref => `/website/pages/${pageKey}`;
