"use client";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * A page's create flow can be opened by a link ("+ New" in the top bar goes to `/customers?new=1`): while the flag is on the address `asked` is true, and
 * `done()` takes it off again, so closing the flow leaves a clean address and the same link opens it the next time. `allowed` is only what the screen shows;
 * the server asks again when anything is saved.
 */
export function useOpenedByLink(path: Route, allowed = true, flag = "new") {
  const router = useRouter();
  const flagged = useSearchParams().get(flag) === "1";
  const asked = allowed && flagged;
  return { asked, done: () => asked && router.replace(path) };
}
