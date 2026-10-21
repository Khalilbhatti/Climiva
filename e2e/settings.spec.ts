import type { Page } from "playwright/test";
import { picture } from "./assets-helpers";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const settingsTabs = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });
const unsaved = (page: Page) => page.getByRole("region", { name: "Unsaved changes" });
const confirm = (page: Page) => page.getByRole("dialog", { name: "Discard unsaved changes?" });
const topBar = (page: Page) => page.locator("header");
const discard = (page: Page) => page.getByRole("button", { name: "Discard changes", exact: true });
const saveButton = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });
const toast = (page: Page) => page.getByRole("status");
/** A form field by its label, whether or not it is marked required (" *"). */
const field = (page: Page, label: string) => page.getByLabel(new RegExp("^" + label + "( [*])?$"));

/** Client-side navigation: keeps the session's in-memory state, as clicking a link does. */
async function go(page: Page, href: string) {
  await page.evaluate((target) => (window as unknown as { next: { router: { push: (to: string) => void } } }).next.router.push(target), href);
  await expect(page).toHaveURL(new RegExp(`${href.split("?")[0]}`));
}

/** Click a Save button that is expected to be accepted, and wait for the server to take it (the form is clean again once it has). */
async function saveAndWait(page: Page, label: string) {
  await saveButton(page, label).click();
  await expect(unsaved(page)).toHaveCount(0);
}

async function saveBusinessName(page: Page, name: string) {
  await page.goto("/settings");
  await page.getByLabel("Business name").fill(name);
  await saveAndWait(page, "Save changes");
}

test.describe("Settings: structure", () => {
  test("has the approved header and exactly the five section tabs, each its own route", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByText("Manage your business information and workspace preferences.")).toBeVisible();
    await expect(settingsTabs(page).getByRole("link")).toHaveText(["Business information", "Business hours", "Branding", "Workspace preferences", "My profile"]);
    const routes: [string, string, string][] = [
      ["/settings", "Business information", "Business information"],
      ["/settings/hours", "Business hours", "Business hours"],
      ["/settings/branding", "Branding", "Branding"],
      ["/settings/preferences", "Workspace preferences", "Workspace preferences"],
      ["/settings/profile", "My profile", "My profile"],
    ];
    for (const [path, tabName, heading] of routes) {
      await page.goto(path);
      await expect(settingsTabs(page).getByRole("link", { name: tabName, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
      await expect(primaryNav(page).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    }
  });

  test("the top bar's workspace switcher and user menus lead to Settings", async ({ page }) => {
    await page.goto("/");
    await topBar(page).getByRole("button", { name: /Apex Climate Heating & Air/ }).click();
    await expect(page.getByRole("region", { name: "Workspaces" }).getByRole("link", { name: "Business settings" })).toHaveAttribute("href", "/settings");
    await topBar(page).getByRole("button", { name: /Alex Morgan/ }).click();
    await expect(page.getByRole("region", { name: "Account" }).getByRole("link", { name: "My profile" })).toHaveAttribute("href", "/settings/profile");
  });

  test("Help is a finished page that points at Settings among the other areas", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Settings", exact: true }).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });
});

test.describe("Business information", () => {
  test("opens on the canonical business record, with only the approved fields", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByLabel("Business name")).toHaveValue("Apex Climate Heating & Air");
    await expect(field(page, "Phone")).toHaveValue("(555) 392-8100");
    await expect(field(page, "Email")).toHaveValue("service@apexclimate.com");
    await expect(page.getByLabel("Street address")).toHaveValue("4820 East Riverside Dr, Suite 110");
    await expect(field(page, "City")).toHaveValue("Austin");
    await expect(field(page, "State")).toHaveValue("TX");
    await expect(page.getByLabel("ZIP code")).toHaveValue("78741");
    await expect(page.getByText("Used as your business name throughout Climvia.")).toBeVisible();
    await expect(page.getByText("Used where your business phone is shown to customers.")).toBeVisible();
    await expect(page.getByText("Used as the primary public business email.")).toBeVisible();
    await expect(page.getByText("Connected Climvia features use these business details where applicable.")).toBeVisible();
    // Nothing beyond name, phone, email and the address.
    const form = page.getByRole("form", { name: "Business information" });
    await expect(form.getByRole("textbox")).toHaveCount(6);
    await expect(form.getByRole("combobox")).toHaveCount(1);
    for (const banned of ["dispatch", "hotline", "headquarters", "alternate", "verification", "verified", "website"]) expect((await form.innerText()).toLowerCase()).not.toContain(banned);
    const details = page.getByRole("region", { name: "Business details" });
    await expect(details).toContainText("Apex Climate Heating & Air");
    await expect(details).toContainText("(555) 392-8100");
    await expect(details).toContainText("4820 East Riverside Dr, Suite 110, Austin, TX 78741");
  });

  test("starts clean: Save and Discard are off until something changes", async ({ page }) => {
    await page.goto("/settings");
    await expect(unsaved(page)).toHaveCount(0);
    await expect(saveButton(page, "Save changes")).toBeDisabled();
    await expect(discard(page)).toBeDisabled();
    await field(page, "City").fill("Round Rock");
    await expect(unsaved(page)).toContainText("You have unsaved changes to your business information.");
    await expect(saveButton(page, "Save changes")).toBeEnabled();
    await expect(discard(page)).toBeEnabled();
    // Putting the value back is no longer a change.
    await field(page, "City").fill("Austin");
    await expect(unsaved(page)).toHaveCount(0);
  });

  test("each field is checked, with its error tied to the field and focus moved to the first one to fix", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("Business name").fill("");
    await field(page, "Phone").fill("392-8100");
    await field(page, "Email").fill("not-an-email");
    await page.getByLabel("Street address").fill("");
    await field(page, "City").fill("");
    await field(page, "State").selectOption("");
    await page.getByLabel("ZIP code").fill("78");
    await saveButton(page, "Save changes").click();

    for (const [label, message] of [
      ["Business name", "Enter your business name."],
      ["Phone", "Enter a ten-digit phone number, for example (555) 010-0100."],
      ["Email", "Enter a valid email address."],
      ["Street address", "Enter a street address."],
      ["City", "Enter a city."],
      ["State", "Select a state."],
      ["ZIP code", "Enter a 5-digit ZIP code."],
    ] as const) {
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await expect(field(page, label)).toHaveAttribute("aria-invalid", "true");
    }
    await expect(page.getByLabel("Business name")).toBeFocused();
    await expect(toast(page)).not.toContainText("saved");
    // Nothing was saved: the details card still shows the baseline.
    await expect(page.getByRole("region", { name: "Business details" })).toContainText("(555) 392-8100");
  });

  test("saving shows a confirmation, tidies the phone number and updates the details card", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("Business name").fill("  Apex Climate Heating & Air LLC ");
    await field(page, "Phone").fill("5125550142");
    await field(page, "Email").fill("hello@apexclimate.com");
    await page.getByLabel("Street address").fill("9000 Research Blvd");
    await field(page, "City").fill("Round Rock");
    await page.getByLabel("ZIP code").fill("78664");
    await saveAndWait(page, "Save changes");

    await expect(toast(page)).toContainText("Business information saved.");
    await expect(unsaved(page)).toHaveCount(0);
    await expect(page.getByLabel("Business name")).toHaveValue("Apex Climate Heating & Air LLC");
    await expect(field(page, "Phone")).toHaveValue("(512) 555-0142");
    const details = page.getByRole("region", { name: "Business details" });
    await expect(details).toContainText("Apex Climate Heating & Air LLC");
    await expect(details).toContainText("(512) 555-0142");
    await expect(details).toContainText("hello@apexclimate.com");
    await expect(details).toContainText("9000 Research Blvd, Round Rock, TX 78664");
  });

  test("a reload keeps what was saved: it is stored, not held in the browser", async ({ page }) => {
    await saveBusinessName(page, "Changed Name Co");
    await page.reload();
    await expect(page.getByLabel("Business name")).toHaveValue("Changed Name Co");
  });
});

test.describe("Business information reaches the rest of the workspace", () => {
  test("the top bar, Overview, Bookings link and detail pages use the saved name", async ({ page }) => {
    await saveBusinessName(page, "Summit HVAC Services");
    await expect(topBar(page).getByRole("button", { name: /Summit HVAC Services/ })).toBeVisible();

    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(page.getByText("What needs your attention today at Summit HVAC Services.")).toBeVisible();
    const card = page.getByRole("region", { name: "Business information" });
    await expect(card).toContainText("Summit HVAC Services");
    await expect(card).not.toContainText("Apex Climate");

    await go(page, "/quotes-invoices/invoices/INV-1044");
    await expect(page.getByText("Billed by")).toBeVisible();
    await expect(page.locator("main")).toContainText("Summit HVAC Services");
    await go(page, "/payments/PAY-1008");
    await expect(page.locator("main")).toContainText("Summit HVAC Services");
  });

  test("the Overview card reads phone, email and address from Settings, and its link goes to Settings", async ({ page }) => {
    await page.goto("/settings");
    await field(page, "Phone").fill("(737) 555-0100");
    await field(page, "Email").fill("office@summit.test");
    await page.getByLabel("Street address").fill("1 Congress Ave");
    await page.getByLabel("ZIP code").fill("78701");
    await saveAndWait(page, "Save changes");
    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    const card = page.getByRole("region", { name: "Business information" });
    await expect(card).toContainText("(737) 555-0100");
    await expect(card).toContainText("office@summit.test");
    await expect(card).toContainText("1 Congress Ave");
    await expect(card).toContainText("Austin, TX 78701");
    await expect(card.getByRole("link", { name: "Phone" }).or(card.getByRole("link", { name: "(737) 555-0100" }))).toHaveAttribute("href", "tel:7375550100");
    await expect(card.getByRole("link", { name: /Manage Settings/ })).toHaveAttribute("href", "/settings");
  });

  test("the Website (editor connected content, and the public preview) and the Marketplace listing show the saved details", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("Business name").fill("Summit HVAC Services");
    await field(page, "Phone").fill("(737) 555-0100");
    await saveAndWait(page, "Save changes");

    await go(page, "/website/pages");
    await expect(page.locator("main")).toContainText("Summit HVAC Services");
    await expect(page.locator("main")).toContainText("(737) 555-0100");

    await go(page, "/website/preview/contact");
    await expect(page.locator("header").first()).toContainText("Summit HVAC Services");
    await expect(page.getByRole("link", { name: "(737) 555-0100" })).toBeVisible();
    // The header, footer and contact card are the saved record. (Page headings are the Website's own authored copy.)
    await expect(page.getByTestId("site-frame").locator("header")).not.toContainText("Apex Climate");
    await expect(page.getByTestId("site-frame").locator("footer")).toContainText("Summit HVAC Services");
    await expect(page.getByTestId("site-frame").locator("footer")).not.toContainText("Apex Climate");
    // The public preview is the customer's page: no workspace sidebar or top bar.
    await expect(primaryNav(page)).toHaveCount(0);

    await go(page, "/marketplace-listing/preview");
    await expect(page.getByTestId("directory-frame")).toContainText("Summit HVAC Services");
    await expect(page.getByTestId("directory-frame")).toContainText("(737) 555-0100");
    await expect(page.getByTestId("directory-frame")).not.toContainText("Apex Climate");
    await expect(primaryNav(page)).toHaveCount(0);
  });

  test("the Marketplace editor's contact choices show the saved values, and Edit business information goes to Settings", async ({ page }) => {
    await page.goto("/settings");
    await field(page, "Email").fill("office@summit.test");
    await saveAndWait(page, "Save changes");
    await go(page, "/marketplace-listing/edit");
    await expect(page.locator("main")).toContainText("office@summit.test");
    await expect(page.getByRole("link", { name: "Edit business information" }).first()).toHaveAttribute("href", "/settings");
  });
});

test.describe("Business hours", () => {
  test("opens on the canonical weekly hours with a live preview", async ({ page }) => {
    await page.goto("/settings/hours");
    await expect(page.getByText("Set the standard hours customers may see across your public business experiences.")).toBeVisible();
    await expect(page.getByText(/These are your standard business hours\./)).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(7);
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      await expect(page.getByRole("switch", { name: `${day} open` })).toBeChecked();
      await expect(page.getByLabel(`${day} opening time`)).toHaveValue("07:30");
      await expect(page.getByLabel(`${day} closing time`)).toHaveValue("18:00");
    }
    await expect(page.getByLabel("Saturday opening time")).toHaveValue("08:00");
    await expect(page.getByLabel("Saturday closing time")).toHaveValue("14:00");
    await expect(page.getByRole("switch", { name: "Sunday open" })).not.toBeChecked();
    await expect(page.getByText("Closed all day")).toBeVisible();
    const preview = page.getByRole("region", { name: "Hours preview" });
    await expect(preview).toContainText(/Mon–Fri\s*7:30 AM–6:00 PM/);
    await expect(preview).toContainText(/Sat\s*8:00 AM–2:00 PM/);
    await expect(preview).toContainText(/Sun\s*Closed/);
  });

  test("switching a day on or off, and changing times, updates the preview and marks the form unsaved", async ({ page }) => {
    await page.goto("/settings/hours");
    await page.getByRole("switch", { name: "Sunday open" }).click();
    await expect(page.getByLabel("Sunday opening time")).toHaveValue("09:00");
    await expect(page.getByLabel("Sunday closing time")).toHaveValue("17:00");
    await expect(page.getByRole("region", { name: "Hours preview" })).toContainText(/Sun\s*9:00 AM–5:00 PM/);
    await expect(unsaved(page)).toContainText("You have unsaved changes to your business hours.");

    await page.getByLabel("Saturday closing time").selectOption("16:00");
    await expect(page.getByRole("region", { name: "Hours preview" })).toContainText(/Sat\s*8:00 AM–4:00 PM/);

    // A day switched off and on again gets its hours back.
    await page.getByRole("switch", { name: "Saturday open" }).click();
    await page.getByRole("switch", { name: "Saturday open" }).click();
    await expect(page.getByLabel("Saturday closing time")).toHaveValue("16:00");
  });

  test("Copy Monday to weekdays copies Monday into Tuesday to Friday and leaves the weekend", async ({ page }) => {
    await page.goto("/settings/hours");
    await page.getByLabel("Monday opening time").selectOption("08:00");
    await page.getByLabel("Monday closing time").selectOption("17:00");
    await page.getByLabel("Thursday closing time").selectOption("20:00");
    await page.getByRole("button", { name: "Copy Monday to weekdays" }).click();
    for (const day of ["Tuesday", "Wednesday", "Thursday", "Friday"]) {
      await expect(page.getByLabel(`${day} opening time`)).toHaveValue("08:00");
      await expect(page.getByLabel(`${day} closing time`)).toHaveValue("17:00");
    }
    await expect(page.getByLabel("Saturday opening time")).toHaveValue("08:00");
    await expect(page.getByLabel("Saturday closing time")).toHaveValue("14:00");
    await expect(page.getByRole("switch", { name: "Sunday open" })).not.toBeChecked();
    await expect(page.getByRole("region", { name: "Hours preview" })).toContainText(/Mon–Fri\s*8:00 AM–5:00 PM/);
  });

  test("a closing time that is not after the opening time is refused, on that day, until fixed", async ({ page }) => {
    await page.goto("/settings/hours");
    await page.getByLabel("Tuesday closing time").selectOption("07:30");
    await saveButton(page, "Save hours").click();
    await expect(page.getByText("Closing time must be after opening time.")).toBeVisible();
    await expect(page.getByLabel("Tuesday closing time")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Tuesday opening time")).toHaveAttribute("aria-invalid", "true");
    await expect(toast(page)).not.toContainText("saved");
    await page.getByLabel("Tuesday closing time").selectOption("17:00");
    await expect(page.getByText("Closing time must be after opening time.")).toHaveCount(0);
    await saveAndWait(page, "Save hours");
    await expect(toast(page)).toContainText("Business hours saved.");
  });

  test("has no shifts, on-call or holiday controls", async ({ page }) => {
    await page.goto("/settings/hours");
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const banned of ["shift", "on-call", "on call", "holiday", "break", "overtime", "emergency hours"]) expect(text, banned).not.toContain(banned);
  });
});

test.describe("Business hours reach the rest of the workspace", () => {
  test("the Overview card, the Website, the Marketplace and Team availability read the saved hours", async ({ page }) => {
    await page.goto("/settings/hours");
    await page.getByLabel("Monday opening time").selectOption("08:00");
    await page.getByLabel("Monday closing time").selectOption("17:00");
    await page.getByRole("button", { name: "Copy Monday to weekdays" }).click();
    await page.getByRole("switch", { name: "Saturday open" }).click();
    await saveAndWait(page, "Save hours");
    await expect(toast(page)).toContainText("Business hours saved");

    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    const card = page.getByRole("region", { name: "Business information" });
    await expect(card).toContainText("Mon–Fri: 8:00 AM–5:00 PM");
    await expect(card).toContainText("Sat–Sun: Closed");

    await go(page, "/website/pages");
    await expect(page.locator("main")).toContainText("Mon–Fri 8:00 AM–5:00 PM · Sat–Sun Closed");
    await go(page, "/website/preview/contact");
    await expect(page.getByTestId("site-frame")).toContainText(/Mon–Fri\s*8:00 AM–5:00 PM/);
    await expect(page.getByTestId("site-frame")).toContainText(/Sat–Sun\s*Closed/);
    await go(page, "/marketplace-listing/preview");
    await expect(page.getByTestId("directory-frame")).toContainText("Mon–Fri 8:00 AM–5:00 PM");

    await go(page, "/team/alex-morgan");
    await expect(page.locator("main")).toContainText("Mon–Fri 8:00 AM–5:00 PM");
    await go(page, "/team/alex-morgan/availability");
    await expect(page.getByLabel("Saturday start")).toHaveCount(0); // business-hours mode is read-only
    await expect(page.locator("main")).toContainText("Not working");
  });

  test("the Schedule follows the saved hours: a day with no work is Closed or open, and booked work is never moved", async ({ page }) => {
    await page.goto("/settings/hours");
    await page.getByRole("switch", { name: "Sunday open" }).click();
    await page.getByRole("switch", { name: "Saturday open" }).click();
    await saveAndWait(page, "Save hours");
    await go(page, "/schedule");
    const week = page.getByRole("list", { name: "Week schedule" });
    // Sunday is open now, so it is no longer labelled Closed.
    await expect(week.getByRole("listitem", { name: "Sun, Oct 27" })).not.toContainText("Closed");
    // Work already booked on Saturday, now a closed day, stays exactly where it was.
    await expect(week.getByRole("listitem", { name: "Sat, Oct 26" })).toContainText("2 items");
    await expect(page.locator("#event-JB-195")).toContainText("9:00 AM – 10:00 AM");
    await expect(page.locator("#event-JB-189")).toContainText("2:00 PM – 4:00 PM");
  });

  test("booking times follow the saved hours, and bookings already made are not rewritten", async ({ page }) => {
    await page.goto("/settings/hours");
    await page.getByRole("switch", { name: "Saturday open" }).click();
    await page.getByRole("switch", { name: "Sunday open" }).click();
    await saveAndWait(page, "Save hours");

    await go(page, "/website/preview/booking/annual-cooling-tune-up");
    await page.getByLabel("Date", { exact: true }).fill("2024-10-26");
    await expect(page.getByText(/The business is closed on Sats\./)).toBeVisible();
    await page.getByLabel("Date", { exact: true }).fill("2024-10-27");
    await expect(page.getByRole("radio", { name: /^9:00 AM/ })).toBeEnabled();

    // Bookings that were made when Saturday was open stay exactly as they were.
    await go(page, "/bookings?tab=upcoming");
    await expect(page.getByRole("table", { name: "Upcoming bookings" }).locator("tbody tr").filter({ hasText: "Bradley Cooper" })).toContainText("Sat, Oct 26");
    await expect(page.getByRole("table", { name: "Upcoming bookings" }).locator("tbody tr").filter({ hasText: "Hannah Wright" })).toContainText("Sat, Oct 26");
  });
});

test.describe("Branding", () => {
  test("opens on the baseline logo reference and brand accent", async ({ page }) => {
    await page.goto("/settings/branding");
    await expect(page.getByText("Manage the core business identity used across supported Climvia customer-facing experiences.")).toBeVisible();
    await expect(page.getByText("Recommended high-resolution PNG with transparent backing. PNG, JPG or WebP.")).toBeVisible();
    await expect(page.getByText("apex-climate-crest-revised.svg")).toBeVisible();
    await expect(page.getByText("Used when no business logo is available.")).toBeVisible();
    await expect(page.getByText("Max size: 5MB")).toBeVisible();
    await expect(page.getByText("Optional", { exact: true })).toBeVisible();
    await expect(page.getByLabel("HEX")).toHaveValue("#0D5C63");
    const identity = page.getByRole("region", { name: "Brand identity" });
    await expect(identity).toContainText("Apex Climate Heating & Air");
    await expect(identity).toContainText("Logo: Active");
    await expect(identity).toContainText("#0D5C63");
    await expect(identity).toContainText("AC");
    // No AI, theme builder or asset library.
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const banned of [/generate/, /theme/, /library/, /ai/, /font/, /template/]) expect(text, String(banned)).not.toMatch(banned);
  });

  test("a chosen logo replaces the reference, can be saved, and Remove logo falls back to the initials", async ({ page }) => {
    await page.goto("/settings/branding");
    await page.getByLabel("Choose a logo file").setInputFiles({ name: "new-crest.png", mimeType: "image/png", buffer: await picture("png", 120, 80) });
    await expect(page.getByText("new-crest.png")).toBeVisible();
    await expect(unsaved(page)).toContainText("You have unsaved changes to your branding.");
    await saveButton(page, "Save branding").click();
    await expect(toast(page)).toContainText("Branding saved.");
    await expect(page.getByRole("region", { name: "Brand identity" })).toContainText("Logo: Active");

    await page.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByText("No logo. The initials below are shown instead.")).toBeVisible();
    await saveButton(page, "Save branding").click();
    await expect(page.getByRole("region", { name: "Brand identity" })).toContainText("Logo: Not set");
    await expect(page.getByRole("button", { name: "Add logo" })).toBeVisible();
  });

  test("only PNG, JPG or WebP up to 5 MB are accepted", async ({ page }) => {
    await page.goto("/settings/branding");
    await page.getByLabel("Choose a logo file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.getByRole("alert").filter({ hasText: "Choose a PNG, JPG or WebP image." })).toBeVisible();
    // SVG is refused on purpose: it is a document that can carry script.
    await page.getByLabel("Choose a logo file").setInputFiles({ name: "crest.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(page.getByRole("alert").filter({ hasText: "Choose a PNG, JPG or WebP image." })).toBeVisible();
    await page.getByLabel("Choose a logo file").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
    await expect(page.getByRole("alert").filter({ hasText: "That image is too large. Use a file up to 5 MB, no larger than 4096 × 4096 pixels." })).toBeVisible();
    await expect(unsaved(page)).toHaveCount(0);
    await expect(page.getByText("apex-climate-crest-revised.svg")).toBeVisible();
  });

  test("the accent must be a readable six-digit colour; swatches fill it in; empty keeps the Climvia teal", async ({ page }) => {
    await page.goto("/settings/branding");
    await page.getByLabel("HEX").fill("#12");
    await saveButton(page, "Save branding").click();
    await expect(page.getByText("Enter a 6-digit hex colour such as #0D5C63.")).toBeVisible();
    await expect(page.getByLabel("HEX")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("HEX").fill("#FFFF00");
    await saveButton(page, "Save branding").click();
    await expect(page.getByText("Choose a darker colour so white button text stays readable.")).toBeVisible();
    await page.getByRole("button", { name: "Use #8B3A1E" }).click();
    await expect(page.getByLabel("HEX")).toHaveValue("#8B3A1E");
    await expect(page.getByRole("button", { name: "Use #8B3A1E" })).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("HEX").fill("");
    await saveButton(page, "Save branding").click();
    await expect(page.getByRole("region", { name: "Brand identity" })).toContainText("Default");
  });

  test("a saved accent is used by customer-facing frames only: the Climvia shell does not change", async ({ page }) => {
    const shellColour = () => primaryNav(page).locator("a[aria-current='page']").evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.goto("/settings/branding");
    await page.getByLabel("HEX").fill("#8B3A1E");
    await saveAndWait(page, "Save branding");
    const settingsShell = await shellColour();
    expect(settingsShell).toBe("rgb(13, 92, 99)"); // still the Climvia teal

    await go(page, "/website/preview");
    const frame = page.getByTestId("site-frame");
    expect(await frame.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--color-primary").trim().toUpperCase())).toBe("#8B3A1E");
    expect(await frame.locator("header").getByRole("link", { name: "Book service" }).evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(139, 58, 30)");

    await go(page, "/marketplace-listing/preview");
    const listing = page.getByRole("article");
    expect(await listing.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--color-primary").trim().toUpperCase())).toBe("#8B3A1E");
    // The Climvia Marketplace header around the listing is Climvia's, not the business's.
    expect(await page.getByTestId("directory-frame").evaluate((element) => (element as HTMLElement).style.getPropertyValue("--color-primary"))).toBe("");

    await go(page, "/");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim())).toBe("#0d5c63");
    expect(await shellColour()).toBe("rgb(13, 92, 99)");
  });

  test("a saved logo is the logo of the Website and of the Marketplace listing, drawn from the stored file", async ({ page }) => {
    await page.goto("/settings/branding");
    await page.getByLabel("Choose a logo file").setInputFiles({ name: "new-crest.png", mimeType: "image/png", buffer: await picture("png", 120, 80) });
    await saveAndWait(page, "Save branding");
    const stored = await page.locator("section[aria-labelledby='logo-heading'] img").getAttribute("src");
    expect(stored).toMatch(/^\/assets\/[0-9a-f-]{36}$/);
    // The Website (the signed-in preview) and the listing draw the same stored logo, not a local copy and not the business's initials.
    await go(page, "/website/preview");
    await expect(page.getByTestId("site-frame").locator("header img[data-site-logo]")).toHaveAttribute("src", stored!);
    await go(page, "/marketplace-listing/preview");
    await expect(page.getByRole("article").locator("img[data-site-logo]")).toHaveAttribute("src", stored!);
    // And with the logo removed they fall back to the initials.
    await go(page, "/settings/branding");
    await page.getByRole("button", { name: "Remove logo" }).click();
    await saveAndWait(page, "Save branding");
    await go(page, "/website/preview");
    await expect(page.getByTestId("site-frame").locator("header img")).toHaveCount(0);
    await expect(page.getByTestId("site-frame").locator("header")).toContainText("AC");
    await go(page, "/marketplace-listing/preview");
    await expect(page.getByRole("article").locator("img")).toHaveCount(0);
    await expect(page.getByRole("article")).toContainText("AC");
  });
});

test.describe("Workspace preferences", () => {
  test("opens on America/Chicago, USD (read-only), MMM D, YYYY and 12-hour time", async ({ page }) => {
    await page.goto("/settings/preferences");
    await expect(page.getByText("Set basic formatting preferences for your Climvia workspace.")).toBeVisible();
    await expect(page.getByLabel("Time zone")).toHaveValue("America/Chicago");
    await expect(page.getByLabel("Time zone").locator("option")).toHaveCount(7);
    await expect(page.getByText("Shown as Central Time (CT).")).toBeVisible();
    await expect(page.getByLabel("Date format")).toHaveValue("mdy-short");
    await expect(page.getByLabel("Date format").locator("option")).toHaveText([
      "MMM D, YYYY (e.g., Oct 30, 2024)",
      "MM/DD/YYYY (e.g., 10/30/2024)",
      "DD/MM/YYYY (e.g., 30/10/2024)",
      "YYYY-MM-DD (e.g., 2024-10-30)",
    ]);
    await expect(page.getByText("Preview: Oct 30, 2024")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^12-hour/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^24-hour/ })).not.toBeChecked();
    const currency = page.getByLabel("Currency");
    await expect(currency).toHaveValue("USD — US Dollar ($)");
    await expect(currency).toHaveAttribute("readonly", "");
    await expect(page.getByText("Read-only")).toBeVisible();
    await expect(page.getByText("Used for prices, Quotes, Invoices, and Payments.")).toBeVisible();
    // Nothing about tax, clocks or servers.
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const banned of ["tax", "ntp", "server", "ledger", "sync"]) expect(text, banned).not.toContain(banned);
  });

  test("the date preview follows the choice before it is saved, and saving applies it to the workspace", async ({ page }) => {
    await page.goto("/settings/preferences");
    await page.getByLabel("Date format").selectOption("mdy-numeric");
    await expect(page.getByText("Preview: 10/30/2024")).toBeVisible();
    await expect(unsaved(page)).toContainText("You have unsaved changes to your workspace preferences.");
    // Unsaved: nothing outside the form has changed yet (the hours editor still writes times in the saved style).
    await page.getByRole("radio", { name: /^24-hour/ }).check();
    await expect(page.getByText("Preview: 10:45").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Business hours", exact: true })).toBeVisible();
  });

  test("a saved date style is used by every module's dates", async ({ page }) => {
    await page.goto("/settings/preferences");
    await page.getByLabel("Date format").selectOption("dmy-numeric");
    await saveAndWait(page, "Save preferences");
    await expect(toast(page)).toContainText("Workspace preferences saved.");

    await go(page, "/payments");
    await expect(page.getByRole("table", { name: "Payments" }).locator("tbody tr").filter({ hasText: "PAY-1008" })).toContainText("28/10/2024");
    await go(page, "/bookings?tab=upcoming");
    await expect(page.getByRole("table", { name: "Upcoming bookings" }).locator("tbody tr").filter({ hasText: "Bradley Cooper" })).toContainText("Sat, 26/10");
    await go(page, "/schedule");
    await expect(page.getByRole("list", { name: "Week schedule" }).getByRole("listitem", { name: "Fri, 25/10" })).toBeVisible();
    await go(page, "/customers/sarah-mitchell");
    await expect(page.getByText(/Updated 1\d\/10\/2024|Updated \d\d\/\d\d\/2024/).first()).toBeVisible();
  });

  test("the four date styles each write the same payment date", async ({ page }) => {
    const expected: Record<string, string> = { "mdy-short": "Oct 28, 2024", "mdy-numeric": "10/28/2024", "dmy-numeric": "28/10/2024", "ymd-iso": "2024-10-28" };
    for (const [id, text] of Object.entries(expected)) {
      await page.goto("/settings/preferences");
      await page.getByLabel("Date format").selectOption(id);
      if (id !== "mdy-short") await saveAndWait(page, "Save preferences");
      await go(page, "/payments");
      await expect(page.getByRole("table", { name: "Payments" }).locator("tbody tr").filter({ hasText: "PAY-1008" }), id).toContainText(text);
    }
  });

  test("24-hour time is used for times everywhere, including the hours editor", async ({ page }) => {
    await page.goto("/settings/preferences");
    await page.getByRole("radio", { name: /^24-hour/ }).check();
    await saveAndWait(page, "Save preferences");

    await go(page, "/schedule");
    await expect(page.locator("#event-JB-204")).toContainText("10:00 – 12:00");
    await expect(page.locator("#event-JB-204")).not.toContainText(/\d\s?(AM|PM)/);
    await go(page, "/settings/hours");
    await expect(page.getByLabel("Monday opening time").locator("option:checked")).toHaveText("07:30");
    await expect(page.getByRole("region", { name: "Hours preview" })).toContainText(/Mon–Fri\s*07:30–18:00/);
    await go(page, "/");
    await expect(page.getByRole("region", { name: "Business information" })).toContainText("Mon–Fri: 07:30–18:00");
  });

  test("the time zone labels the workspace's business-local times and never shifts a stored time", async ({ page }) => {
    await page.goto("/schedule");
    await expect(page.getByText("Central Time (CT)")).toBeVisible();
    const before = await page.locator("#event-JB-204").innerText();
    const bookingTime = await page.locator("#event-JB-201").innerText();

    await go(page, "/settings/preferences");
    await page.getByLabel("Time zone").selectOption("America/New_York");
    await expect(page.getByText("Shown as Eastern Time (ET).")).toBeVisible();
    await saveAndWait(page, "Save preferences");

    await go(page, "/schedule");
    await expect(page.getByText("Eastern Time (ET)")).toBeVisible();
    await expect(page.getByText("Central Time (CT)")).toHaveCount(0);
    // Historical and booked times are exactly as they were.
    expect(await page.locator("#event-JB-204").innerText()).toBe(before);
    expect(await page.locator("#event-JB-201").innerText()).toBe(bookingTime);
    await go(page, "/team/alex-morgan/availability");
    await expect(page.locator("main")).toContainText("America/New_York (workspace default)");
    await go(page, "/marketing/cmp-fall-maintenance-reminder");
    await expect(page.locator("main")).toContainText("Eastern Time (ET), your business local time");
  });

  test("the same preferences read the same in any browser timezone", async ({ browser, baseURL, storageState }) => {
    test.setTimeout(90_000);
    for (const timezoneId of ["Pacific/Auckland", "America/Los_Angeles", "America/Chicago"]) {
      const context = await browser.newContext({ baseURL, timezoneId, storageState });
      const page = await context.newPage();
      try {
        await page.goto("/settings/preferences");
        await page.getByLabel("Date format").selectOption("ymd-iso");
        await page.getByRole("radio", { name: /^24-hour/ }).check();
        // The first browser saves these preferences; they are stored, so the next two open on them already.
        if (await saveButton(page, "Save preferences").isEnabled()) await saveAndWait(page, "Save preferences");
        await go(page, "/schedule");
        await expect(page.locator("#event-JB-204")).toContainText("10:00 – 12:00");
        await expect(page.getByRole("list", { name: "Week schedule" }).getByRole("listitem", { name: "Fri, 10-25" })).toBeVisible();
        await go(page, "/payments");
        await expect(page.getByRole("table", { name: "Payments" }).locator("tbody tr").filter({ hasText: "PAY-1008" })).toContainText("2024-10-28");
      } finally {
        await context.close();
      }
    }
  });

  test("a reload keeps the saved style: it is stored, not held in the browser", async ({ page }) => {
    await page.goto("/settings/preferences");
    await page.getByLabel("Date format").selectOption("ymd-iso");
    await saveAndWait(page, "Save preferences");
    await page.goto("/payments");
    await expect(page.getByRole("table", { name: "Payments" }).locator("tbody tr").filter({ hasText: "PAY-1008" })).toContainText("2024-10-28");
  });
});

test.describe("My profile", () => {
  test("opens on Alex Morgan, Operations Lead, with the role read-only and no sign-in fields", async ({ page }) => {
    await page.goto("/settings/profile");
    await expect(page.getByText("Manage your personal display information.")).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue("Alex Morgan");
    await expect(page.getByText("Used with your profile across the Climvia workspace.")).toBeVisible();
    await expect(page.getByText("Operations Lead", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Role access is managed with your Team record.")).toBeVisible();
    // The role is shown, not edited; there is no email, password or account control.
    const form = page.getByRole("form", { name: "My profile" });
    await expect(form.getByRole("textbox")).toHaveCount(1);
    await expect(form.getByRole("combobox")).toHaveCount(0);
    const text = (await form.innerText()).toLowerCase();
    for (const banned of ["email", "password", "sign out", "sign in", "two-factor", "account"]) expect(text, banned).not.toContain(banned);
  });

  test("Manage Team opens the Team module", async ({ page }) => {
    await page.goto("/settings/profile");
    await page.getByRole("link", { name: /Manage Team/ }).click();
    await expect(page).toHaveURL(/\/team$/);
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
  });

  test("saving a new name updates the top bar and initials, and signs a review response", async ({ page }) => {
    await page.goto("/settings/profile");
    await page.getByLabel("Full name").fill("Alex Quinn Morgan");
    await expect(unsaved(page)).toContainText("You have unsaved changes to your profile.");
    await saveAndWait(page, "Save profile");
    await expect(toast(page)).toContainText("Profile updated.");
    await expect(unsaved(page)).toHaveCount(0);
    await expect(topBar(page).getByRole("button", { name: /Alex Quinn Morgan/ })).toContainText("Operations Lead");
    await expect(topBar(page)).toContainText("AQ");

    await go(page, "/reviews");
    await page.getByRole("button", { name: "Reply to review from Sarah Mitchell" }).click();
    await page.getByRole("dialog", { name: "Reply to review" }).getByRole("button", { name: "Post response" }).click();
    await go(page, "/reviews/rev-sarah-mitchell");
    await expect(page.getByText(/Responded by Alex Quinn Morgan/)).toBeVisible();
  });

  test("the name is required", async ({ page }) => {
    await page.goto("/settings/profile");
    await page.getByLabel("Full name").fill("   ");
    await saveButton(page, "Save profile").click();
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Full name")).toBeFocused();
  });

  test("a chosen photo is shown in the top bar once saved, and only PNG or JPG are accepted", async ({ page }) => {
    await page.goto("/settings/profile");
    await page.getByLabel("Choose a profile photo").setInputFiles({ name: "notes.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(page.getByRole("alert").filter({ hasText: "Choose a PNG or JPG image up to 4 MB." })).toBeVisible();
    await page.getByLabel("Choose a profile photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: Buffer.from("not-a-real-image") });
    await expect(unsaved(page)).toBeVisible();
    await saveAndWait(page, "Save profile");
    await expect(topBar(page).locator("img")).toHaveCount(1);
    await page.getByRole("button", { name: "Remove photo" }).click();
    await saveAndWait(page, "Save profile");
    await expect(topBar(page).locator("img")).toHaveCount(0);
  });
});

/* ───────────────────────── unsaved changes, discard, and leaving the page ───────────────────────── */

const SECTIONS: { path: string; what: string; edit: (page: Page) => Promise<unknown>; changed: (page: Page) => Promise<void>; baseline: (page: Page) => Promise<void> }[] = [
  {
    path: "/settings",
    what: "business information",
    edit: (page) => page.getByLabel("Business name").fill("Edited Name"),
    changed: (page) => expect(page.getByLabel("Business name")).toHaveValue("Edited Name"),
    baseline: (page) => expect(page.getByLabel("Business name")).toHaveValue("Apex Climate Heating & Air"),
  },
  {
    path: "/settings/hours",
    what: "business hours",
    edit: (page) => page.getByRole("switch", { name: "Sunday open" }).click(),
    changed: (page) => expect(page.getByRole("switch", { name: "Sunday open" })).toBeChecked(),
    baseline: (page) => expect(page.getByRole("switch", { name: "Sunday open" })).not.toBeChecked(),
  },
  {
    path: "/settings/branding",
    what: "branding",
    edit: (page) => page.getByLabel("HEX").fill("#8B3A1E"),
    changed: (page) => expect(page.getByLabel("HEX")).toHaveValue("#8B3A1E"),
    baseline: (page) => expect(page.getByLabel("HEX")).toHaveValue("#0D5C63"),
  },
  {
    path: "/settings/preferences",
    what: "workspace preferences",
    edit: (page) => page.getByLabel("Date format").selectOption("ymd-iso"),
    changed: (page) => expect(page.getByLabel("Date format")).toHaveValue("ymd-iso"),
    baseline: (page) => expect(page.getByLabel("Date format")).toHaveValue("mdy-short"),
  },
  {
    path: "/settings/profile",
    what: "profile",
    edit: (page) => page.getByLabel("Full name").fill("Edited Person"),
    changed: (page) => expect(page.getByLabel("Full name")).toHaveValue("Edited Person"),
    baseline: (page) => expect(page.getByLabel("Full name")).toHaveValue("Alex Morgan"),
  },
];

test.describe("Unsaved changes", () => {
  for (const section of SECTIONS) {
    test(`${section.what}: a change is flagged, Discard changes asks first, and Keep editing keeps it`, async ({ page }) => {
      await page.goto(section.path);
      await expect(unsaved(page)).toHaveCount(0);
      await section.edit(page);
      await expect(unsaved(page)).toContainText(`You have unsaved changes to your ${section.what}.`);

      await discard(page).click();
      const dialog = confirm(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`Changes made to your ${section.what} have not been saved. If you leave without saving, your recent edits will be lost.`);
      await dialog.getByRole("button", { name: "Keep editing" }).click();
      await expect(dialog).toBeHidden();
      await section.changed(page);
      await expect(unsaved(page)).toBeVisible();

      await discard(page).click();
      await confirm(page).getByRole("button", { name: "Discard changes" }).click();
      await expect(confirm(page)).toBeHidden();
      await section.baseline(page);
      await expect(unsaved(page)).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${section.path}$`));
    });

    test(`${section.what}: leaving through the sidebar or a Settings tab asks first, and a clean form leaves freely`, async ({ page }) => {
      await page.goto(section.path);
      // Clean: no prompt.
      await settingsTabs(page).getByRole("link", { name: section.path === "/settings/hours" ? "Branding" : "Business hours", exact: true }).click();
      await expect(confirm(page)).toBeHidden();
      await expect(page).not.toHaveURL(new RegExp(`${section.path}$`));

      await go(page, section.path);
      await section.edit(page);
      // The sidebar.
      await primaryNav(page).getByRole("link", { name: "Overview" }).click();
      await expect(confirm(page)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${section.path}$`));
      await confirm(page).getByRole("button", { name: "Keep editing" }).click();
      await section.changed(page);
      // A Settings tab.
      await settingsTabs(page).getByRole("link", { name: section.path === "/settings/profile" ? "Branding" : "My profile", exact: true }).click();
      await expect(confirm(page)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${section.path}$`));
      await confirm(page).getByRole("button", { name: "Keep editing" }).click();
      // Discard changes then leaves.
      await primaryNav(page).getByRole("link", { name: "Overview" }).click();
      await confirm(page).getByRole("button", { name: "Discard changes" }).click();
      await expect(page).toHaveURL(/\/overview$/);
      // The edit was dropped, not saved.
      await primaryNav(page).getByRole("link", { name: "Settings" }).click();
      await go(page, section.path);
      await section.baseline(page);
    });
  }

  test("saving clears the unsaved state, so leaving needs no confirmation", async ({ page }) => {
    await page.goto("/settings");
    await field(page, "City").fill("Round Rock");
    await saveAndWait(page, "Save changes");
    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(confirm(page)).toBeHidden();
    await expect(page).toHaveURL(/\/overview$/);
  });

  test("the dialog is labelled, traps focus and Escape means Keep editing", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("Business name").fill("Edited Name");
    await discard(page).click();
    await expect(confirm(page)).toBeVisible();
    await expect(confirm(page).locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(confirm(page)).toBeHidden();
    await expect(page.getByLabel("Business name")).toHaveValue("Edited Name");
    await expect(discard(page)).toBeFocused();
  });
});

test.describe("Settings: scope and boundaries", () => {
  test("Services, Team, Website and Marketplace content are not editable from Settings", async ({ page }) => {
    for (const path of ["/settings", "/settings/hours", "/settings/branding", "/settings/preferences", "/settings/profile"]) {
      await page.goto(path);
      // The signposts to where Team, Booking and Domains live are links, not settings: they are held to being links below, and left out of the words read here.
      const text = (await page.locator("main").evaluate((main) => {
        const copy = main.cloneNode(true) as HTMLElement;
        copy.querySelector('[aria-label="Other settings"]')?.remove();
        return copy.innerText;
      })).toLowerCase();
      await expect(page.getByRole("region", { name: "Other settings" }).locator("input, select, textarea, button")).toHaveCount(0);
      for (const banned of ["service price", "pricing", "booking method", "permissions", "invite", "domain", "marketplace listing", "page content", "dispatch", "fleet", "verification", "verified"]) expect(text, `${path}: ${banned}`).not.toContain(banned);
    }
  });

  test("every control is labelled", async ({ page }) => {
    for (const path of ["/settings", "/settings/hours", "/settings/branding", "/settings/preferences", "/settings/profile"]) {
      await page.goto(path);
      const unlabelled = await page.evaluate(() =>
        [...document.querySelectorAll("main input:not([type=file]):not([type=hidden]), main select, main textarea, main [role=switch]")]
          .filter((control) => {
            const element = control as HTMLInputElement;
            const named = element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || (element.id && document.querySelector(`label[for="${element.id}"]`)) || element.closest("label");
            return !named;
          })
          .map((control) => control.outerHTML.slice(0, 80)),
      );
      expect(unlabelled, path).toEqual([]);
    }
  });
});
