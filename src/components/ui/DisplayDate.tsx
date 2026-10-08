"use client";

import { formatDate } from "@/lib/format";

/**
 * A date in the workspace's saved date style. Pages rendered on the server cannot see the preference chosen in
 * Settings, so they use this to have the date written in the browser instead.
 */
export function DisplayDate({ value }: { value: string }) {
  return <>{formatDate(value)}</>;
}
