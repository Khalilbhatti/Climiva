import type { Page } from "playwright/test";
import { business } from "../scripts/db/seed-data/apex";
import { insertActiveClaim, uniqueHost } from "./domain-helpers";
import { expect, test } from "./saas";
import { SERVICES } from "./apex-data";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const main = (page: Page) => page.getByRole("main");
/** The toast region (the unsaved-changes notices are role="status" too, but are paragraphs, not this live region). */
const toast = (page: Page) => page.locator('div[role="status"]');
const preview = (page: Page) => page.getByRole("region", { name: "Directory preview" });
const summary = (page: Page) => page.getByRole("region", { name: "Listing summary" });

/**
 * Press Save on the listing editor and return only once the save is STORED. Two things that look like that are not:
 * the "Listing changes saved." toast of an EARLIER save lasts three seconds and outlives a move between pages, so a second save can see a toast at
 * once; and Save is disabled while a save is still in flight as well as when it is done. What is true only after the server has answered is that the
 * form is clean again (the provider changes the working copy only with the listing as stored), so the "Unsaved changes" badge is gone. A link followed
 * before that is, correctly, stopped by the unsaved-changes prompt.
 */
async function saveAndWaitUntilStored(page: Page) {
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  await expect(toast(page)).toContainText("Listing changes saved.");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
}

const FIVE = [
  "AC Repair & Diagnostics",
  "Annual Cooling Tune-Up & Maintenance",
  "Heat Pump Diagnostics & Repair",
  "Ductless Mini-Split Installation & Estimate",
  "Furnace Safety Inspection & Tune-Up",
];
const EMERGENCY = "Emergency No-Heat / No-Cool Service";

/** Service names listed in a listing view (the picture inside the workspace, or the public page). */
const listed = (scope: ReturnType<Page["locator"]>) => scope.getByRole("region", { name: "Services" }).getByRole("listitem").locator("p.text-sm.font-semibold");

test.describe("Marketplace listing", () => {
  test("renders the approved header, Published badge, four summary tiles and the Marketplace sidebar state", async ({ page, workerTenant }) => {
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible();
    await expect(page.getByText("Manage how your business appears in the Climvia directory.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Marketplace/ })).toHaveAttribute("aria-current", "page");
    await expect(main(page).getByText("Published").first()).toBeVisible();

    const tiles = summary(page);
    await expect(tiles).toContainText("Listing status");
    await expect(tiles).toContainText("Published");
    await expect(tiles).toContainText("Visible in Climvia Marketplace");
    await expect(tiles).toContainText("Public services");
    await expect(tiles).toContainText("5 of 6 eligible Services shown");
    await expect(tiles).toContainText("Contact details");
    await expect(tiles).toContainText("Shown");
    await expect(tiles).toContainText("Booking");
    await expect(tiles).toContainText("Enabled");
    await expect(tiles).toContainText("Customers can open your Booking page");

    await expect(page.getByRole("link", { name: "Edit listing" })).toHaveAttribute("href", "/marketplace/edit");
    // The public listing is its own page, at the listing's public address.
    await expect(page.getByRole("link", { name: "View public listing" })).toHaveAttribute("href", `/listings/${workerTenant.listingSlug}`);
  });

  test("business information comes from the organization's record, in the preview and beside it", async ({ page, workerTenant }) => {
    await page.goto("/marketplace");
    const card = page.getByRole("region", { name: "Business information" });
    await expect(card).toContainText(business.name);
    await expect(card).toContainText(business.phone);
    await expect(card).toContainText(business.email);
    await expect(card).toContainText("4820 East Riverside Dr, Suite 110, Austin, TX 78741");
    await expect(card).toContainText(`${workerTenant.platformSlug}.climvia.com`);
    await expect(card).toContainText("Information shown here is connected to your primary Business Settings.");

    const listing = preview(page);
    await expect(listing).toContainText(business.name);
    await expect(listing).toContainText(business.phone);
    await expect(listing).toContainText(business.email);
    await expect(listing).toContainText("Mon–Fri 7:30 AM–6:00 PM");
    await expect(listing).toContainText("Sat 8:00 AM–2:00 PM");
    await expect(listing).toContainText("Sun Closed");
    await card.getByRole("link", { name: /Edit in Settings/ }).click();
    await expect(page).toHaveURL("/settings");
  });

  test("exactly 5 of the 6 canonical Services are selected; Emergency No-Heat / No-Cool Service is not selected", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(listed(preview(page))).toHaveText(FIVE);
    await expect(preview(page)).not.toContainText(EMERGENCY);
    const shown = page.getByRole("region", { name: "Services shown" });
    await expect(shown).toContainText("5 services");
    await expect(shown).toContainText("1 service not selected");
    await expect(shown).toContainText(`${EMERGENCY} — Not selected for the directory.`);

    await page.goto("/marketplace/edit");
    const services = page.getByRole("region", { name: "Services shown" });
    await expect(services).toContainText("5 of 6 eligible Services selected");
    for (const name of FIVE) await expect(services.getByRole("checkbox", { name: `Show ${name}` })).toBeChecked();
    await expect(services.getByRole("checkbox", { name: `Show ${EMERGENCY}` })).not.toBeChecked();
    await expect(services.getByRole("listitem").filter({ hasText: EMERGENCY })).toContainText("Not selected");
    // Services come from the catalog: price and booking method are shown, never edited here.
    await expect(services.getByRole("listitem").filter({ hasText: "AC Repair" })).toContainText("$89 diagnostic fee · Request appointment");
    await expect(services.getByRole("textbox")).toHaveCount(0);
  });

  test("the six public Services are the only choices: maintenance plan coverage is never offered", async ({ page }) => {
    for (const path of ["/marketplace", "/marketplace/edit"]) {
      await page.goto(path);
      await expect(main(page)).not.toContainText("Cooling maintenance");
      await expect(main(page)).not.toContainText("Heating maintenance");
    }
    await page.goto("/marketplace/edit");
    await expect(page.getByRole("region", { name: "Services shown" }).getByRole("listitem")).toHaveCount(SERVICES.length);
  });
});

test.describe("Edit listing", () => {
  test("opens with the approved fields, Save disabled until something changes", async ({ page }) => {
    await page.goto("/marketplace");
    await page.getByRole("link", { name: "Edit listing" }).click();
    await expect(page).toHaveURL("/marketplace/edit");
    await expect(page.getByRole("heading", { level: 1, name: "Edit Marketplace listing" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Marketplace/ })).toHaveAttribute("aria-current", "page");
    for (const heading of ["Listing details", "Contact information", "Services shown", "Customer actions", "Listing visibility"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    // The business name is locked to Business Settings.
    await expect(page.getByText("Apex Climate Heating & Air").first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Business name/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit business information" }).first()).toHaveAttribute("href", "/settings");
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Preview listing" })).toHaveAttribute("href", "/marketplace/preview");
    await expect(page.getByLabel(/^Business description/)).toHaveValue(/^HVAC maintenance, diagnostics, repair, and installation services/);
  });

  test("editing the description shows Unsaved changes, previews live, and saves to the database", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByLabel(/^Business description/).fill("Austin heating and cooling, done right.");
    await expect(page.getByText("Unsaved changes").first()).toBeVisible();
    await expect(page.getByText("You have unsaved changes to your Marketplace listing.")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Listing preview" })).toContainText("Austin heating and cooling, done right.");
    // The public preview shows only what is saved.
    await expect(page.getByRole("button", { name: "Preview listing" })).toBeDisabled();

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Listing changes saved.");
    await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

    // The listing is stored: it is still there after navigating and after a reload.
    await primaryNav(page).getByRole("link", { name: /^Marketplace/ }).click();
    await expect(preview(page)).toContainText("Austin heating and cooling, done right.");
    await page.reload();
    await expect(preview(page)).toContainText("Austin heating and cooling, done right.");
  });

  test("the description is required, and a listing needs at least one Service", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByLabel(/^Business description/).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter a description for your listing.")).toBeVisible();
    await page.getByLabel(/^Business description/).fill("Back again.");
    for (const name of FIVE) await page.getByRole("checkbox", { name: `Show ${name}` }).uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator('[role="alert"]', { hasText: "Select at least one Service to show." })).toBeVisible();
  });

  test("changing Service order and selection changes only the listing, never the Services", async ({ page }) => {
    await page.goto("/marketplace/edit");
    const services = page.getByRole("region", { name: "Services shown" });
    // Furnace starts last of six; three moves put it ahead of Heat Pump.
    for (let move = 0; move < 3; move += 1) await services.getByRole("button", { name: "Move Furnace Safety Inspection & Tune-Up up" }).click();
    await services.getByRole("checkbox", { name: `Show ${EMERGENCY}` }).check();
    await expect(services).toContainText("6 of 6 eligible Services selected");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Listing changes saved.");

    await primaryNav(page).getByRole("link", { name: /^Marketplace/ }).click();
    await expect(summary(page)).toContainText("6 of 6 eligible Services shown");
    const names = await listed(preview(page)).allTextContents();
    expect(names).toHaveLength(6);
    expect(names.indexOf("Furnace Safety Inspection & Tune-Up")).toBeLessThan(names.indexOf("Heat Pump Diagnostics & Repair"));
    expect(names).toContain(EMERGENCY);

    // The Services catalog is exactly as it was: same six, same order, same prices, Emergency still active.
    await primaryNav(page).getByRole("link", { name: /^Services/ }).click();
    const rows = page.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText("AC Repair & Diagnostics");
    await expect(rows.filter({ hasText: EMERGENCY })).toContainText("$149 call fee");
    await expect(rows.filter({ hasText: EMERGENCY })).toContainText("Active");
  });

  test("each contact detail can be hidden, and the tile follows", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByRole("switch", { name: "Show phone" }).click();
    await expect(page.getByRole("complementary", { name: "Listing preview" })).not.toContainText(business.phone);
    await expect(page.getByRole("complementary", { name: "Listing preview" })).toContainText(business.email);
    await saveAndWaitUntilStored(page);
    await primaryNav(page).getByRole("link", { name: /^Marketplace/ }).click();
    await expect(preview(page)).not.toContainText(business.phone);
    await expect(summary(page)).toContainText("Shown");

    await page.getByRole("link", { name: "Edit listing" }).click();
    for (const toggle of ["Show email", "Show address", "Show business hours", "Show website"]) await page.getByRole("switch", { name: toggle }).click();
    await saveAndWaitUntilStored(page);
    await primaryNav(page).getByRole("link", { name: /^Marketplace/ }).click();
    await expect(summary(page)).toContainText("Not shown");
    await expect(summary(page)).toContainText("Contact details are off");
    // The business record itself is untouched.
    await expect(page.getByRole("region", { name: "Business information" })).toContainText(business.phone);
  });

  test("the Book service action can be switched off: the Booking tile and the public listing follow", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByRole("switch", { name: 'Show "Book service"' }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Listing changes saved.");
    await primaryNav(page).getByRole("link", { name: /^Marketplace/ }).click();
    await expect(summary(page)).toContainText("Not shown");
    await expect(summary(page)).toContainText('The "Book service" button is off');
    await page.getByRole("link", { name: "View public listing" }).click();
    await expect(page.getByRole("link", { name: "Book service" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View website" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact business" })).toBeVisible();
  });

  test("the cover is a choice of built-in treatments and can be removed", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await expect(page.getByRole("radio", { name: /^Teal horizon/ })).toBeChecked();
    await page.getByRole("radio", { name: /^Warm linen/ }).check();
    await page.getByRole("radio", { name: /^No cover image/ }).check();
    await expect(page.getByRole("radio", { name: /^No cover image/ })).toBeChecked();
    await expect(page.getByRole("complementary", { name: "Listing preview" }).locator("[aria-hidden].relative")).toHaveCount(0);
  });
});

test.describe("Unsaved changes", () => {
  test("leaving by any link asks first; Keep editing keeps the edits and Discard and leave drops them", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByLabel(/^Business description/).fill("Not saved yet.");
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();

    const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toContainText("You have unsaved changes. If you leave now, your edits to this listing will be lost.");
    await expect(page).toHaveURL("/marketplace/edit");
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByLabel(/^Business description/)).toHaveValue("Not saved yet.");

    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Marketplace" }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(page).toHaveURL("/marketplace");
    await expect(preview(page)).not.toContainText("Not saved yet.");
  });

  test("Discard in the header asks first and restores the saved listing; saved edits leave without a prompt", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByLabel(/^Business description/).fill("Draft words.");
    await page.getByRole("button", { name: "Discard" }).click();
    const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toContainText("The saved listing is not affected.");
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await page.getByRole("button", { name: "Discard" }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByLabel(/^Business description/)).toHaveValue(/^HVAC maintenance/);
    await expect(toast(page)).toContainText("Unsaved changes discarded.");

    await page.getByLabel(/^Business description/).fill("Saved words.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Listing changes saved.");
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    await expect(page).toHaveURL("/bookings");
  });
});

test.describe("Hide and publish", () => {
  test("Hide listing explains what happens, asks first, and keeps everything saved", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByLabel(/^Business description/).fill("Kept while hidden.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Listing changes saved.");

    const hideButton = page.getByRole("button", { name: "Hide listing" });
    await hideButton.click();
    const dialog = page.getByRole("dialog", { name: "Hide Marketplace listing?" });
    await expect(dialog).toContainText("Customers will no longer be able to discover your business in the Climvia Marketplace. Your listing content and configuration will remain saved.");
    // Focus is inside the dialog; Escape closes it and focus returns to the button.
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(hideButton).toBeFocused();
    await expect(page.getByText("Published").first()).toBeVisible();

    await hideButton.click();
    await page.getByRole("dialog", { name: "Hide Marketplace listing?" }).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Hide listing" })).toBeVisible();

    await hideButton.click();
    await page.getByRole("dialog", { name: "Hide Marketplace listing?" }).getByRole("button", { name: "Hide listing" }).click();
    await expect(toast(page)).toContainText("Marketplace listing hidden.");
    await expect(page.getByRole("button", { name: "Publish listing" })).toBeVisible();
    await expect(page.getByText("Hidden").first()).toBeVisible();
    await expect(page.getByLabel(/^Business description/)).toHaveValue("Kept while hidden.");
  });

  test("the Hidden state: banner, tiles and a preview of what customers will see once published", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByRole("switch", { name: "Listing visible" }).click();
    await page.getByRole("dialog", { name: "Hide Marketplace listing?" }).getByRole("button", { name: "Hide listing" }).click();
    await primaryNav(page).getByRole("link", { name: /^Marketplace/ }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Marketplace" }).locator("..")).toContainText("Hidden");
    await expect(summary(page)).toContainText("Not discoverable in directory");
    await expect(summary(page)).toContainText("5 of 6 eligible Services configured");
    await expect(page.getByRole("heading", { name: "Your Marketplace listing is hidden" })).toBeVisible();
    await expect(page.getByText("Your listing content remains saved while the listing is hidden.")).toBeVisible();
    await expect(page.getByText("Listing currently hidden")).toBeVisible();
    await expect(page.getByRole("link", { name: "View public listing" })).toHaveCount(0);
    await expect(listed(preview(page))).toHaveText(FIVE);
    // Business and Services are unchanged.
    await expect(page.getByRole("region", { name: "Business information" })).toContainText(business.name);
  });

  test("Publish listing shows the listing again with its saved configuration", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByLabel(/^Business description/).fill("Restored after hiding.");
    await page.getByRole("switch", { name: 'Show "Contact business"' }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Listing changes saved.");
    await page.getByRole("button", { name: "Hide listing" }).click();
    await page.getByRole("dialog", { name: "Hide Marketplace listing?" }).getByRole("button", { name: "Hide listing" }).click();

    await primaryNav(page).getByRole("link", { name: /^Marketplace/ }).click();
    await page.getByRole("button", { name: "Publish listing" }).click();
    await expect(toast(page)).toContainText("Marketplace listing published.");
    await expect(summary(page)).toContainText("Visible in Climvia Marketplace");
    await expect(page.getByRole("link", { name: "View public listing" })).toBeVisible();
    await expect(preview(page)).toContainText("Restored after hiding.");
    await expect(preview(page)).not.toContainText("Contact business");
    await expect(preview(page)).toContainText("Book service");
  });

  test("the listing can be published again from the editor's visibility switch", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByRole("switch", { name: "Listing visible" }).click();
    await page.getByRole("dialog", { name: "Hide Marketplace listing?" }).getByRole("button", { name: "Hide listing" }).click();
    await expect(page.getByRole("switch", { name: "Listing visible" })).toHaveAttribute("aria-checked", "false");
    await page.getByRole("switch", { name: "Listing visible" }).click();
    await expect(page.getByRole("switch", { name: "Listing visible" })).toHaveAttribute("aria-checked", "true");
    await expect(toast(page)).toContainText("Marketplace listing published.");
  });
});

test.describe("Directory preview", () => {
  test("is the public listing: no workspace sidebar, top bar, internal controls or state labels", async ({ page, workerTenant }) => {
    await page.goto("/marketplace");
    await page.getByRole("link", { name: "View public listing" }).click();
    await expect(page).toHaveURL(`/listings/${workerTenant.listingSlug}`);

    await expect(primaryNav(page)).toHaveCount(0);
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveCount(0);
    for (const internal of ["Edit listing", "Hide listing", "Publish listing", "Save changes", "Unsaved", "Not selected", "Listing status", "Draft"]) {
      await expect(page.getByText(internal, { exact: false })).toHaveCount(0);
    }
    await expect(page.getByText("MARKETPLACE", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: business.name })).toBeVisible();
    await expect(page.getByTestId("directory-frame")).toContainText(business.phone);
    await expect(listed(page.getByTestId("directory-frame"))).toHaveText(FIVE);
    await expect(page.getByTestId("directory-frame")).toContainText("© 2025 Apex Climate Heating & Air · Listed on Climvia Marketplace");
  });

  test("makes no claims it cannot back: no verified, licensed, ranking or sponsored labels, no analytics", async ({ page }) => {
    await page.goto("/marketplace/preview");
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const claim of ["verified", "licensed", "insured", "certified", "ranking", "sponsored", "top rated", "rating", "analytics", "wake county", "north carolina", "dispatch"]) {
      expect(text, claim).not.toContain(claim);
    }
  });

  test("its buttons lead to the Website's real Booking, contact and service pages", async ({ page }) => {
    await page.goto("/marketplace/preview");
    await expect(page.getByRole("link", { name: "Book service" })).toHaveAttribute("href", "/website/preview/booking");
    await expect(page.getByRole("link", { name: "View website" })).toHaveAttribute("href", "/website/preview");
    await expect(page.getByRole("link", { name: "Contact business" })).toHaveAttribute("href", "/website/preview/contact");
    await expect(page.getByRole("link", { name: "Book a time" }).first()).toHaveAttribute("href", /\/website\/preview\/booking\/(annual-cooling-tune-up|furnace-safety-inspection)$/);
    await page.getByRole("link", { name: "Request a quote" }).click();
    await expect(page).toHaveURL("/website/preview/booking/ductless-mini-split-estimate");
  });

  test("the Desktop / Mobile switch narrows the page", async ({ page }) => {
    await page.goto("/marketplace/preview");
    const frame = page.getByTestId("directory-frame");
    const wide = (await frame.boundingBox())!.width;
    await page.getByRole("button", { name: "Mobile" }).click();
    await expect(page.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");
    const narrow = (await frame.boundingBox())!.width;
    expect(narrow).toBeLessThanOrEqual(390);
    expect(narrow).toBeLessThan(wide);
  });

  test("a hidden listing is not available publicly: the page a visitor opens is not found, the signed-in preview says so", async ({ page, workerTenant, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    await page.goto(`/listings/${workerTenant.listingSlug}`);
    await expect(page.getByRole("heading", { level: 1, name: business.name })).toBeVisible();
    await page.goto("/marketplace/edit");
    await page.getByRole("button", { name: "Hide listing" }).click();
    await page.getByRole("dialog", { name: "Hide Marketplace listing?" }).getByRole("button", { name: "Hide listing" }).click();
    await expect(toast(page)).toContainText("Marketplace listing hidden.");
    await expect(page.getByRole("button", { name: "Preview listing" })).toBeDisabled();

    // The visitor's page no longer exists...
    const gone = await page.goto(`/listings/${workerTenant.listingSlug}`);
    expect(gone?.status()).toBe(404);
    await expect(page.getByText(business.phone)).toHaveCount(0);
    // ...and the signed-in preview of the saved listing says it is not listed.
    await page.goto("/marketplace/preview");
    await expect(page.getByRole("heading", { name: "This listing isn't available" })).toBeVisible();
    await expect(page.getByText(business.phone)).toHaveCount(0);
    await expect(primaryNav(page)).toHaveCount(0);
  });

  test("the listing's Website row is the Climvia address; an active custom domain does not replace it", async ({ page, db, workerTenant }) => {
    const host = uniqueHost("listing");
    await insertActiveClaim(db, workerTenant.organizationId, host);
    await page.goto("/marketplace");
    await expect(page.getByRole("region", { name: "Business information" })).toContainText(`${workerTenant.platformSlug}.climvia.com`);
    await expect(page.getByRole("region", { name: "Business information" })).not.toContainText(host);
    await expect(preview(page)).toContainText(`${workerTenant.platformSlug}.climvia.com`);
  });
});

test.describe("First-time setup and empty state", () => {
  test("the empty state offers one primary action, and no second business onboarding", async ({ page }) => {
    await page.goto("/marketplace?state=empty");
    await expect(page.getByRole("heading", { name: "Set up your Marketplace listing" })).toBeVisible();
    await expect(page.getByText("Create a public business profile using the information and Services already configured in Climvia.")).toBeVisible();
    await expect(summary(page)).toContainText("Not configured");
    await expect(summary(page)).toContainText("Not selected");
    await expect(summary(page)).toContainText("No services selected");
    await expect(summary(page)).toContainText("Booking link unassigned");
    await expect(page.getByText("Your Marketplace listing can use existing Business information and public Services. You choose what customers see.")).toBeVisible();
    await expect(main(page).getByRole("link", { name: /Set up listing/ })).toHaveCount(2); // header action + the empty state's own
    for (const promo of [/upgrade/i, /learn more/i, /free trial/i, /onboarding/i]) await expect(main(page)).not.toContainText(promo);
  });

  test("Set up listing opens the setup form; Save & publish listing publishes it and shows the clean success state", async ({ page }) => {
    await page.goto("/marketplace?state=empty");
    await main(page).getByRole("link", { name: /Set up listing/ }).first().click();
    await expect(page).toHaveURL("/marketplace/edit?setup=1");
    await expect(page.getByRole("heading", { level: 1, name: "Set up Marketplace listing" })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByText("Nothing is publicly discoverable until you click Save & publish listing.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Listing visibility" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Services shown" })).toContainText("5 of 6 eligible Services selected");

    await page.getByRole("button", { name: "Save & publish listing" }).click();
    await expect(page).toHaveURL("/marketplace");
    await expect(toast(page)).toContainText("Marketplace listing published.");
    // Stored: the listing survives a reload.
    await page.reload();
    await expect(summary(page)).toContainText("Visible in Climvia Marketplace");
    await expect(summary(page)).toContainText("Visible in Climvia Marketplace");
    await expect(summary(page)).toContainText("5 of 6 eligible Services shown");
    // The success state is the page itself: nothing overlays the directory preview.
    await expect(preview(page).getByRole("dialog")).toHaveCount(0);
    await expect(preview(page)).not.toContainText("published successfully");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Back to Marketplace leaves setup without publishing", async ({ page }) => {
    await page.goto("/marketplace/edit?setup=1");
    await page.getByRole("link", { name: "Back to Marketplace" }).click();
    await expect(page).toHaveURL("/marketplace");
  });
});

test.describe("Marketplace content rules", () => {
  test("no other business identity, location or claim appears on any Marketplace page", async ({ page }) => {
    for (const path of ["/marketplace", "/marketplace?state=empty", "/marketplace/edit", "/marketplace/edit?setup=1", "/marketplace/preview"]) {
      await page.goto(path);
      await page.locator("h1, h2").first().waitFor();
      await page.waitForLoadState("networkidle");
      const text = (await page.locator("body").innerText()).toLowerCase();
      for (const banned of ["north carolina", "wake county", "raleigh", "verified experience", "verified provider", "licensed", "dispatch", "rostova"]) {
        expect(text, `${path}: ${banned}`).not.toContain(banned);
      }
      if (!path.includes("state=empty") && !path.includes("setup=1")) expect(text, path).toContain("austin");
    }
  });
});
