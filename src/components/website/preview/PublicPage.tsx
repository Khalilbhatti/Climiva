"use client";

import type { PageId } from "@/data/website";
import { SiteRenderer } from "../SiteRenderer";
import { usePreview } from "./PreviewShell";

/** One page of the customer-facing website, from the saved draft (Preview) or the published version (live view). */
export function PublicPage({ page }: { page: PageId }) {
  const { content, live } = usePreview();
  return <SiteRenderer page={page} content={content} live={live} />;
}
