import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

/**
 * The customer-facing pages: the PUBLISHED sites (/sites/<address>) and the public Marketplace listings (/listings/<address>). They have no
 * shell, and **no workspace providers and no session**: nothing in this group reads who is signed in, so a signed-in member is served exactly
 * what a visitor is, and no private workspace data (a Draft included) is read for, or sent with, a public page. The signed-in previews of the
 * Draft are in `(signed-in)/(preview)`, whose layout verifies the caller and mounts the providers.
 *
 * This layout checks nothing, on purpose: the public pages are for anyone. They are dynamic: a published site is read from the database on
 * every request, and nothing about it is cached or prerendered where a change of what is published could be missed or one business's page
 * could be served for another.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return children;
}
