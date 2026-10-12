import { PlainNotFound } from "@/components/shell/PlainNotFound";

/**
 * The last-resort "not found", for the few places no route group has its own (a page missing from Log in or set-up, for example). It is plain and
 * static on purpose: a layout's not-found is part of the page tree sent with EVERY response under that layout, so one that read the session or the
 * workspace would put them in the payload of routes that have nothing to do with them. The places that show "not found" inside a workspace's shell
 * each have their own, scoped to routes that are already the workspace's: `(signed-in)/(workspace)/not-found.tsx`, `(signed-in)/(preview)/not-found.tsx` and, for an address
 * that matches no route at all, `(unmatched)/not-found.tsx`. The published Sites and listings have `(public)/not-found.tsx`.
 */
export default function NotFound() {
  return <PlainNotFound />;
}
