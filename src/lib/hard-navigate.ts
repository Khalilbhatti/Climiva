/**
 * Leaves the current page with a full document load rather than a client-side transition.
 *
 * Signing in or out, finishing setup and switching workspace all change WHICH tenant the page belongs to. A client-side
 * transition would keep every in-memory provider (the saved settings, the demo stores, the router cache) alive from the
 * previous tenant; a real page load starts them from the server's answer for the new one, so nothing can carry over.
 */
export function hardNavigate(path: string): void {
  window.location.assign(new URL(path, window.location.origin));
}
