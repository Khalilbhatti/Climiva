import { SIGNED_OUT_STATE, sessionState } from "@/server/entry";

/**
 * What the public pages' header needs to know about the person looking at them, as three booleans: are they signed in, do they belong to a business's
 * workspace, are they a platform administrator. It is asked by the page AFTER it loads, so that the pages themselves stay the same for everyone (a public
 * page carries no session). It answers only about the caller, from the verified session; it names no business and no person, and it is never cached.
 * A cross-origin page cannot read it (no CORS headers are sent), and it takes no parameters: nothing in the request chooses whose state it is.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  try {
    return Response.json(await sessionState(), { headers: NO_STORE });
  } catch {
    // If the database cannot be reached the header simply shows the signed-out links; the page itself does not depend on this.
    return Response.json(SIGNED_OUT_STATE, { status: 503, headers: NO_STORE });
  }
}
