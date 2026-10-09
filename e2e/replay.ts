/**
 * Server Action replay for the specs that ask the server's own checks directly.
 *
 * A screen sends a Server Action as a POST with a `next-action` id and the arguments as JSON. Capturing one real call gives the
 * id and the shape; replaying it with different arguments, as a different person, with no session, or several times at once,
 * asks the server the questions a forged or racing request would.
 */
import type { APIRequestContext, Page } from "playwright/test";
import { ORIGIN } from "./saas";

/** What a Server Action call sends. */
export type Captured = { url: string; headers: Record<string, string>; body: string };

/** Run `trigger` (which makes the screen send an action) and capture the request it sent. The request still goes through. */
export async function captureAction(page: Page, trigger: () => Promise<void>): Promise<Captured> {
  const pending = page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
  await trigger();
  const request = await pending;
  const headers = request.headers();
  return {
    url: request.url(),
    headers: Object.fromEntries(["next-action", "content-type", "accept", "next-router-state-tree"].filter((name) => headers[name]).map((name) => [name, headers[name]])),
    body: request.postData() ?? "",
  };
}

export const replay = (api: APIRequestContext, captured: Captured, body = captured.body, options: { maxRedirects?: number } = {}) =>
  api.post(captured.url, { headers: { ...captured.headers, origin: ORIGIN }, data: body, ...options });

/** The same call with its argument list changed: `change` receives the array the screen sent and returns the one to send. */
export function withArguments(captured: Captured, change: (args: unknown[]) => unknown[]): string {
  const parsed = JSON.parse(captured.body) as unknown[];
  return JSON.stringify(change([...parsed]));
}

/** The same call with the first argument (an object) changed in place. */
export function withFirstArgument(captured: Captured, change: (args: Record<string, unknown>) => void): string {
  return withArguments(captured, (args) => {
    const first = { ...(args[0] as Record<string, unknown>) };
    change(first);
    return [first, ...args.slice(1)];
  });
}
