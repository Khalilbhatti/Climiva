import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

/**
 * The customer-facing pages: the PUBLISHED sites (/sites/<address>), the public Marketplace listings (/listings/<address>), and the
 * signed-in previews of the saved Draft (/website/preview, /marketplace/preview). None of them has the workspace shell.
 *
 * This layout checks nothing, on purpose: the public pages are for anyone, and the previews check the caller themselves, in their own
 * layout AND in each page (a layout is not re-run when you move between pages beneath it, so it is never the only check). They are
 * dynamic: a published site is read from the database on every request, and nothing about it is cached or prerendered where a change of
 * what is published could be missed or one business's page could be served for another.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return children;
}
