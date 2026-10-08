import type { AppHref } from "@/config/routes";
import type { PageId } from "@/data/website";

/**
 * Where the customer-facing preview of a page lives. The preview is the stand-in for the public site: it is
 * served by this app, outside the workspace shell, at /website/preview/… . `live` keeps the visitor on the
 * published version when they follow a link inside the preview.
 */
export function previewHref(target: PageId | `booking/${string}`, live = false): AppHref {
  const path = target === "home" ? "" : `/${target}`;
  return `/website/preview${path}${live ? "?view=live" : ""}` as AppHref;
}


/** The page-editor route for a page. */
export const editorHref = (page: PageId): AppHref => `/website/pages/${page}`;
