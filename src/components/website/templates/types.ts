import type { SiteContent } from "@/lib/site-template";

/**
 * A Template as the Gallery's browser code receives it: the display metadata the application lists it with, and its content (pages,
 * sections, theme) for the preview. Built on the server from the application's own Templates (src/db/site-templates), so it carries no
 * organization and no private data; it is handed to the page as props.
 */
export type GalleryTemplate = {
  key: string;
  name: string;
  description: string;
  /** A short label for its style ("Structured"), and at most two tags. */
  style: string;
  tags: readonly string[];
  content: SiteContent;
};
