"use server";

import type { MarketplaceState } from "@/data/marketplace";
import { loadServices } from "@/db/core-queries";
import type { Tx } from "@/db/index";
import { loadMarketplace, requestListingReview, saveListing, setListingStatus } from "@/db/marketplace-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_MARKETPLACE, failure, ok, type ActionResult } from "@/lib/action-result";
import { serverTimerMs } from "@/lib/business-time";
import { parseListingConfig } from "@/lib/marketplace-rules";
import { Refusal, refuse } from "@/lib/refusal";
import { isRecord } from "@/lib/validation";
import { authorize } from "../authorize";
import { constraintOf, isIntegrityViolation } from "../db-errors";

/**
 * Marketplace writes: save the listing, set it up (save and publish), publish it, hide it. Each action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "marketplace:manage" capability (owner or admin),
 *   3. only then reads its arguments, and parses and validates them again (the screen's checks are a convenience, these are the
 *      enforcement),
 *   4. opens a tenant transaction, so Row Level Security checks the same rules a second time, locks the listing, resolves every Service
 *      it selects INSIDE the verified organization (another business's Service is "not in your catalog") and writes,
 *   5. answers with the listing as stored.
 * No argument names an organization or a listing: the listing is the verified organization's own.
 */

type Answer = { marketplace: MarketplaceState };

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = constraintOf(error);
  if (constraint === "marketplace_listing_services_public") return failure("Only active, public Services can be shown on a listing.", { services: "Only active, public Services can be shown on a listing." });
  if (constraint === "marketplace_listings_public_slug_unique" || constraint === "marketplace_listings_org_unique") return failure("Someone else just changed this, so your change was not saved. Reload the page to see the latest, then try again.");
  if (isIntegrityViolation(error)) return failure("This change can't be saved as entered, and nothing was changed. Reload the page, check what you entered and try again.");
  console.error("[marketplace] could not save:", error instanceof Error ? error.message : error);
  return failure("We couldn't save your Marketplace Listing. Your changes weren't saved. Try again.");
}

type Work = { tx: Tx; organizationId: string; organizationSlug: string };

async function mutate(change: (work: Work) => Promise<void>): Promise<ActionResult<Answer>> {
  const auth = await authorize("marketplace:manage", NOT_ALLOWED_MARKETPLACE);
  if (!auth.ok) return auth.result;
  const { userId, organizationId, organization } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      await change({ tx, organizationId, organizationSlug: organization.slug });
      return ok({ marketplace: await loadMarketplace(tx, organizationId, await loadServices(tx, organizationId), organization.timezone) });
    });
  } catch (error) {
    return translate(error);
  }
}

function config(input: unknown) {
  const request = isRecord(input) ? input : refuse("The listing details were not understood.");
  const parsed = parseListingConfig(request.config);
  return parsed.ok ? parsed.value : refuse(parsed.error, parsed.fields);
}

/** Save the listing's configuration. The published or hidden status is unchanged. */
export async function saveListingAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (work) => saveListing(work, config(input), { publish: false }));
}

/** First-time setup: save the configuration and publish the listing in one step. */
export async function setUpListingAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (work) => saveListing(work, config(input), { publish: true }));
}

/** Publish a saved listing again. */
export async function publishListingAction(): Promise<ActionResult<Answer>> {
  return mutate(async (work) => setListingStatus(work, "published"));
}

/** Hide the listing from the directory. Its configuration stays exactly as it was. */
export async function hideListingAction(): Promise<ActionResult<Answer>> {
  return mutate(async (work) => setListingStatus(work, "hidden"));
}

const NOTE_MAX = 500;

/**
 * Ask Climvia to look at a suspension again. Owners and admins only (the same capability and the same helper as every other write here). The note is the
 * member's own words (optional, up to 500 characters); the request records who asked and when, changes nothing about whether the listing is public, and
 * cannot be repeated while one waits. A business cannot lift a suspension itself: only the platform does that.
 */
export async function requestListingReviewAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx }) => {
    const note = isRecord(input) && typeof input.note === "string" ? input.note.trim() : isRecord(input) && input.note === undefined ? "" : refuse("Your note was not understood.");
    if (note.length > NOTE_MAX) refuse(`Keep your note to ${NOTE_MAX} characters or fewer.`, { note: `Keep your note to ${NOTE_MAX} characters or fewer.` });
    const asked = await requestListingReview(tx, note === "" ? null : note);
    if (asked.result === "not_suspended") refuse("Your listing isn't suspended any more. Reload the page.");
    if (asked.result === "too_soon") {
      const hours = asked.retryAfter ? Math.max(Math.ceil((asked.retryAfter.getTime() - serverTimerMs()) / 3_600_000), 1) : 24;
      refuse(`Climvia answered your last request recently. You can ask again in about ${hours} ${hours === 1 ? "hour" : "hours"}.`);
    }
    // "already_requested" is the state the business wanted: a request is waiting.
  });
}
