import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

/** Addresses that match no route. Mounts nothing: its "not found" decides, for this one case only, whether someone signed in gets the workspace's shell. */
export default function UnmatchedLayout({ children }: { children: ReactNode }) {
  return children;
}
