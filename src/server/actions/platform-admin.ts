"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { setListingModeration } from "@/db/platform-queries";
import { isUuid } from "@/db/tenant";
import { requirePlatformAdmin } from "../platform-admin";

/** Where the form came from, as long as it is the Marketplace page of the console (with its own search and page). Anything else goes to the page itself. */
const BACK = /^\/platform-admin\/marketplace(\?[A-Za-z0-9=&%_.+-]{0,200})?$/;

function backTo(value: FormDataEntryValue | null, notice: string): Route {
  const base = typeof value === "string" && BACK.test(value) ? value : "/platform-admin/marketplace";
  const [path, query = ""] = base.split("?");
  const params = new URLSearchParams(query);
  params.set("notice", notice);
  return `${path}?${params.toString()}` as Route;
}

/**
 * Suspend a Marketplace listing, or allow it again. Only a platform administrator may: the session is verified and the database asked FIRST, before
 * anything is read from the form, and the database function checks the same thing again. The form carries a listing id, a word and a reason; it
 * carries no organization, because the platform's decision is about one listing and never reaches into the business's own settings.
 */
export async function setListingModerationAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const listingId = formData.get("listingId");
  const state = formData.get("state");
  const rawReason = formData.get("reason");
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";

  let notice = "invalid";
  if (typeof listingId === "string" && isUuid(listingId) && (state === "suspended" || state === "allowed")) {
    if (reason.length > 500) {
      notice = "reason-too-long";
    } else {
      const outcome = await setListingModeration(admin.id, listingId, state, state === "suspended" && reason ? reason : null);
      notice = !outcome.found ? "missing" : outcome.changed ? state : "unchanged";
    }
  }
  redirect(backTo(formData.get("back"), notice));
}
