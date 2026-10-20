"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { keepListingSuspended, setListingModeration, setReviewModeration, updateListingMessage } from "@/db/platform-queries";
import { isUuid } from "@/db/tenant";
import { requirePlatformAdmin } from "../platform-admin";

/** Where a form came from, as long as it is the page of the console it belongs to (with its own search, filter and page). Anything else goes to the page itself. */
const BACK = /^\/platform-admin\/(marketplace|reviews)(\?[A-Za-z0-9=&%_.+-]{0,200})?$/;

function backTo(value: FormDataEntryValue | null, notice: string, fallback: "/platform-admin/marketplace" | "/platform-admin/reviews"): Route {
  const base = typeof value === "string" && BACK.test(value) && value.startsWith(fallback) ? value : fallback;
  const [path, query = ""] = base.split("?");
  const params = new URLSearchParams(query);
  params.set("notice", notice);
  return `${path}?${params.toString()}` as Route;
}

/** A text field of a form, trimmed. Anything that is not text is empty. */
const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const MAX = 500;

/**
 * Suspend a Marketplace listing, or allow it again. Only a platform administrator may: the session is verified and the database asked FIRST, before
 * anything is read from the form, and the database function checks the same thing again. The form carries a listing id, a word, an INTERNAL reason and
 * a message for the business; it carries no organization, because the platform's decision is about one listing and never reaches into the business's own
 * settings. The reason is never shown to the business; the message is what it reads.
 */
export async function setListingModerationAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const listingId = formData.get("listingId");
  const state = formData.get("state");
  const reason = field(formData, "reason");
  const message = field(formData, "tenantMessage");

  let notice = "invalid";
  if (typeof listingId === "string" && isUuid(listingId) && (state === "suspended" || state === "allowed")) {
    if (reason.length > MAX) {
      notice = "reason-too-long";
    } else if (message.length > MAX) {
      notice = "message-too-long";
    } else {
      const outcome = await setListingModeration(admin.id, listingId, state, state === "suspended" && reason ? reason : null, state === "suspended" && message ? message : null);
      notice = !outcome.found ? "missing" : outcome.changed ? state : "unchanged";
    }
  }
  redirect(backTo(formData.get("back"), notice, "/platform-admin/marketplace"));
}

/** Change (or clear) what the business is told about a suspension that stands. The internal reason is not on this form and is not touched. */
export async function updateListingMessageAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const listingId = formData.get("listingId");
  const message = field(formData, "tenantMessage");

  let notice = "invalid";
  if (typeof listingId === "string" && isUuid(listingId)) {
    if (message.length > MAX) {
      notice = "message-too-long";
    } else {
      const outcome = await updateListingMessage(admin.id, listingId, message || null);
      notice = !outcome.found ? "missing" : outcome.changed ? "message-updated" : "unchanged";
    }
  }
  redirect(backTo(formData.get("back"), notice, "/platform-admin/marketplace"));
}

/** Answer the business's request for a second look by keeping the suspension, optionally saying why in the message it reads. Lifting it is "Allow again". */
export async function keepListingSuspendedAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const listingId = formData.get("listingId");
  const message = field(formData, "tenantMessage");

  let notice = "invalid";
  if (typeof listingId === "string" && isUuid(listingId)) {
    if (message.length > MAX) {
      notice = "message-too-long";
    } else {
      const outcome = await keepListingSuspended(admin.id, listingId, message || null);
      notice = !outcome.found ? "missing" : outcome.changed ? "kept" : "unchanged";
    }
  }
  redirect(backTo(formData.get("back"), notice, "/platform-admin/marketplace"));
}

/**
 * Hide a public review from the Marketplace, or restore it. The review itself is never changed or removed, and the business keeps it exactly as it was.
 * The reason is internal.
 */
export async function setReviewModerationAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const reviewId = formData.get("reviewId");
  const state = formData.get("state");
  const reason = field(formData, "reason");

  let notice = "invalid";
  if (typeof reviewId === "string" && isUuid(reviewId) && (state === "hidden" || state === "visible")) {
    if (reason.length > MAX) {
      notice = "reason-too-long";
    } else {
      const outcome = await setReviewModeration(admin.id, reviewId, state, state === "hidden" && reason ? reason : null);
      notice = !outcome.found ? "missing" : outcome.reason === "not_public" ? "not-public" : outcome.changed ? state : "unchanged";
    }
  }
  redirect(backTo(formData.get("back"), notice, "/platform-admin/reviews"));
}
