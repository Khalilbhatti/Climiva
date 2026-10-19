import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

/**
 * Climvia's own administration: the platform console and its sign-in page. A route group of its own, next to (signed-in), (public) and (auth) and
 * mounting none of their providers: no workspace, no active business, no shell of the product. It is never indexed, and nothing about it is linked
 * from a business's workspace, a published Site or the Marketplace.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PlatformAdminGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
