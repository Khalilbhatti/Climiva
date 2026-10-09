import type { ActionResult } from "./action-result";

/** What a person reads when the server cannot be reached. */
export const UNREACHABLE = "We couldn't reach the server, so nothing was saved. Check your connection and try again.";

/**
 * Run a server action; if the server cannot be reached (offline, a dropped connection) the caller gets words to show, not an
 * uncaught exception. Used by every provider that saves through a server action.
 */
export async function send<T>(call: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
