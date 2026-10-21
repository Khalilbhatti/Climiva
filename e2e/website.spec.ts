import type { Page } from "playwright/test";
import { business } from "../scripts/db/seed-data/apex";
import { expect, siteAddress, test } from "./fixtures";
import { SERVICES } from "./apex-data";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const main = (page: Page) => page.getByRole("main");
/** The toast region (the Builder's drag-and-drop announcer is a status region too, but it is not a polite one). */
const toast = (page: Page) => page.locator('div[role="status"][aria-live="polite"]');
const websiteTabs = (page: Page) => page.getByRole("navigation", { name: "Website sections" });
const card = (page: Page, name: string) => page.getByRole("region", { name });

test.describe("Website overview", () => {
  test("Published: header, tabs, status tiles, publishing, address and checklist", async ({ page, workerTenant }) => {
    const host = siteAddress(workerTenant.platformSlug);
    await page.goto("/website");
    await expect(page.getByRole("heading", { level: 1, name: "Website" })).toBeVisible();
    await expect(page.getByText("Your public website: what visitors see, how they book, and the address they use.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Website/ })).toHaveAttribute("aria-current", "page");
    await expect(main(page).getByText("Published").first()).toBeVisible();

    await expect(websiteTabs(page).getByRole("link")).toHaveText(["Overview", "Pages & content", "Booking", "Domain"]);
    await expect(websiteTabs(page).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    // The four status tiles.
    await expect(main(page)).toContainText(`Live at ${host}`);
    await expect(main(page)).toContainText("5 pages");
    await expect(main(page)).toContainText("6 Services");
    await expect(main(page)).toContainText("Enabled");

    const publishing = card(page, "Publishing");
    await expect(publishing).toContainText("Your website is live and open to visitors.");
    // Looking at the live site is one of the header's actions, not repeated in the card.
    await expect(page.getByRole("link", { name: /View live website/ })).toBeVisible();
    await expect(publishing.getByRole("link", { name: /View live website/ })).toHaveCount(0);
    await expect(publishing.getByRole("button", { name: "Unpublish" })).toBeVisible();
    await expect(publishing).toContainText("Unpublishing makes the website private without deleting any pages or content.");

    const address = card(page, "Website address");
    await expect(address).toContainText(host);
    // Nothing is seeded as a custom domain: the business has the Climvia address, and a way to add one.
    await expect(address.getByRole("link", { name: "Connect custom domain" })).toBeVisible();

    const checklist = card(page, "Website checklist");
    for (const item of ["Business information", "Services", "Business hours", "Booking experience"]) await expect(checklist).toContainText(item);
    await expect(checklist).toContainText("Custom domain");

    // No analytics, traffic, SEO scores or AI anywhere on the website module.
    for (const banned of [/analytics/i, /traffic/i, /seo/i, /\bAI\b/, /visitors this/i, /conversion/i, /page speed/i]) await expect(main(page)).not.toContainText(banned);
  });

  test("connected business content links back to the records the website reads", async ({ page }) => {
    await page.goto("/website");
    const connected = card(page, "Connected business content");
    await expect(connected).toContainText(business.name);
    await expect(connected).toContainText("6 Services linked from your Service catalog");
    await expect(connected).toContainText(business.hours[0].hours);
    await connected.getByRole("link", { name: /Manage/ }).first().click();
    await expect(page).toHaveURL("/services");
  });

  test("the empty state offers one primary action and no tabs", async ({ page }) => {
    await page.goto("/website?state=empty");
    await expect(page.getByRole("heading", { name: "No website created yet" })).toBeVisible();
    await expect(page.getByText("Not published")).toBeVisible();
    await expect(page.getByText("Uses your existing business setup")).toBeVisible();
    await expect(websiteTabs(page)).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: "Create website" })).toHaveCount(1);
    await main(page).getByRole("link", { name: "Create website" }).click();
    await expect(page).toHaveURL("/website");
    await expect(page.getByText("5 pages")).toBeVisible();
  });
});

test.describe("Pages & content", () => {
  test("lists exactly Home, Services, About, Contact and Booking, each published", async ({ page }) => {
    await page.goto("/website/pages");
    await expect(websiteTabs(page).getByRole("link", { name: "Pages & content" })).toHaveAttribute("aria-current", "page");
    const pages = page.getByRole("region", { name: "Website pages" }).getByRole("listitem");
    await expect(pages).toHaveCount(5);
    for (const [title, path] of [
      ["Home", "/"],
      ["Services", "/services"],
      ["About", "/about"],
      ["Contact", "/contact"],
      ["Booking", "/booking"],
    ] as const) {
      const row = pages.filter({ hasText: title }).first();
      await expect(row).toContainText(path);
      await expect(row).toContainText("Published");
      await expect(row.getByRole("link", { name: `Edit ${title} page` })).toHaveAttribute("href", `/website/builder?page=${title.toLowerCase()}`);
    }
    await expect(page.getByRole("button", { name: /add page|new page/i })).toHaveCount(0);
  });

  test("shows the business details the website reads, never a second copy", async ({ page }) => {
    await page.goto("/website/pages");
    const aside = page.getByRole("complementary", { name: "Connected business content" });
    await expect(aside).toContainText(business.name);
    await expect(aside).toContainText(business.phone);
    await expect(aside).toContainText(business.email);
    await expect(aside).toContainText("4820 East Riverside Dr, Suite 110, Austin, TX 78741");
    await expect(aside).toContainText("Mon–Fri 7:30 AM–6:00 PM");
    await expect(aside).toContainText("6 active catalog services");
  });
});

test.describe("Page copy", () => {
  test("About never invents a founding date, awards or licensing", async ({ page }) => {
    await page.goto("/website/preview/about");
    const body = page.locator("body");
    for (const invented of [/founded/i, /since (19|20)\d\d/i, /award/i, /licensed/i, /insured/i, /certified/i, /years of experience/i]) await expect(body).not.toContainText(invented);
    await expect(body).toContainText("About Apex Climate Heating & Air");
  });

  test("the pages are edited in the Website Builder, in the workspace shell: each page opens with its own sections, and the old editor address leads there", async ({ page }) => {
    for (const [id, title, sections] of [
      ["home", "Home", ["Hero", "Services", "Why choose us", "Business hours", "Contact", "Booking CTA"]],
      ["services", "Services", ["Page intro", "Service catalog", "Booking CTA"]],
      ["about", "About", ["Page intro", "Our business", "What matters to us", "Business details", "Booking CTA"]],
      ["contact", "Contact", ["Page intro", "Contact details", "Business hours", "Contact form", "Booking CTA"]],
      ["booking", "Booking", ["Page intro", "Booking experience", "Contact alternative"]],
    ] as const) {
      await page.goto(`/website/pages/${id}`);
      await expect(page).toHaveURL(`/website/builder?page=${id}`);
      await expect(page.getByRole("heading", { level: 1, name: "Website Builder" })).toBeVisible();
      await expect(primaryNav(page).getByRole("link", { name: /^Website/ })).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId(`builder-page-${id}`)).toContainText(title);
      const list = page.getByRole("region", { name: "Sections" });
      for (const section of sections) await expect(list.getByRole("listitem").filter({ hasText: new RegExp(`^${section}`) }).first()).toBeVisible();
      await expect(list.getByRole("listitem")).toHaveCount(sections.length);
      // The editor is the Builder only: no SEO, meta or debug controls, and no free-form page building.
      for (const banned of [/\bseo\b/i, /\bmeta\b/i, /debug/i, /custom (html|css|code)/i]) await expect(main(page)).not.toContainText(banned);
    }
  });

  test("an unknown page shows a not-found state in the shell", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    await page.goto("/website/pages/pricing");
    await expect(primaryNav(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  });
});

test.describe("Services on the website", () => {
  test("the Builder shows, hides and orders services without touching the catalog, and Pages & content says which pages now differ from the published site", async ({ page }) => {
    await page.goto("/website/builder?page=services");
    await page.getByTestId("builder-section-catalog").getByTestId("section-select").click();
    for (const service of SERVICES) await expect(page.getByRole("switch", { name: `Show ${service.name} on the website` })).toBeChecked();

    await page.getByRole("switch", { name: "Show Furnace Safety Inspection & Tune-Up on the website" }).click();
    await page.getByRole("button", { name: "Move Annual Cooling Tune-Up & Maintenance up" }).click();
    const canvas = page.getByTestId("builder-canvas");
    await expect(canvas).not.toContainText("Furnace Safety Inspection & Tune-Up");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Draft saved.");

    // Every page that lists services is now saved-but-unpublished; the others are not.
    await page.goto("/website/pages");
    const rows = page.getByRole("region", { name: "Website pages" }).getByRole("listitem");
    for (const title of ["Home", "Services", "Booking"]) await expect(rows.filter({ hasText: title }).first()).toContainText("Saved · unpublished changes");
    for (const title of ["About", "Contact"]) await expect(rows.filter({ hasText: title }).first()).toContainText("Published");

    // The preview follows the new order; the Services module is unchanged.
    await rows.filter({ hasText: "Services" }).first().getByRole("link", { name: "Preview Services page" }).click();
    const names = page.getByRole("heading", { level: 2 });
    await expect(names.first()).toHaveText("Annual Cooling Tune-Up & Maintenance");
    await expect(page.getByRole("heading", { level: 2, name: "Furnace Safety Inspection & Tune-Up" })).toHaveCount(0);

    await page.getByRole("link", { name: "Back to editor" }).click();
    await expect(page).toHaveURL("/website/builder?page=services");
    await primaryNav(page).getByRole("link", { name: /^Services/ }).click();
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(6);
    await expect(main(page)).toContainText("Furnace Safety Inspection & Tune-Up");
  });
});

test.describe("Customer-facing preview", () => {
  test("is its own layout: no workspace sidebar, header, search or shell", async ({ page }) => {
    await page.goto("/website/preview");
    await expect(primaryNav(page)).toHaveCount(0);
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Overview/ })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Website" })).toBeVisible();
    await expect(page.getByText(business.name).first()).toBeVisible();
    await expect(page.getByText("© 2025 Apex Climate Heating & Air. All rights reserved. | Powered by Climvia")).toBeVisible();
    await expect(page.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", { name: "Back to editor" })).toHaveAttribute("href", "/website/builder?page=home");
  });

  test("lists the six canonical services with their catalog price, duration and booking method", async ({ page }) => {
    await page.goto("/website/preview/services");
    const cards = page.getByRole("list").filter({ has: page.getByRole("heading", { level: 2 }) }).getByRole("listitem");
    await expect(cards).toHaveCount(6);
    await expect(cards.filter({ hasText: "AC Repair & Diagnostics" })).toContainText("$89 diagnostic fee");
    await expect(cards.filter({ hasText: "AC Repair & Diagnostics" })).toContainText("90 mins · Request appointment");
    await expect(cards.filter({ hasText: "Annual Cooling Tune-Up & Maintenance" })).toContainText("$129 fixed price");
    await expect(cards.filter({ hasText: "Annual Cooling Tune-Up & Maintenance" })).toContainText("Instant booking");
    await expect(cards.filter({ hasText: "Ductless Mini-Split" })).toContainText("Request quote");
    await expect(page.getByRole("link", { name: "Book a time" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Request appointment" })).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Request a quote" })).toHaveCount(1);
  });

  test("Contact shows the business record: phone, email, address and hours; the message form confirms without creating anything", async ({ page }) => {
    await page.goto("/website/preview/contact");
    const body = page.locator("body");
    await expect(body).toContainText(business.phone);
    await expect(body).toContainText(business.email);
    await expect(body).toContainText("4820 East Riverside Dr, Suite 110");
    await expect(body).toContainText("Austin, TX 78741");
    await expect(body).toContainText("Mon–Fri");
    await expect(body).toContainText("7:30 AM–6:00 PM");
    await expect(body).toContainText("Closed");

    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Enter a message.")).toBeVisible();
    await page.getByLabel(/^Full name/).fill("Jordan Miller");
    await page.getByLabel(/^Email/).fill("jordan@example.com");
    await page.getByLabel(/^Message/).fill("Do you service mini-splits?");
    await page.getByRole("button", { name: "Send message" }).click();
    const sent = page.locator('[role="status"]', { hasText: "Message sent" });
    await expect(sent).toContainText("Thanks, Jordan.");

    // Nothing was added to Bookings.
    await page.getByRole("link", { name: "Back to editor" }).click();
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    await expect(page.getByRole("tablist", { name: "Booking lists" }).getByRole("tab")).toHaveText([/^Requests\s*2$/, /^Upcoming\s*6$/, /^Past\s*6$/, /^Cancelled\s*0$/]);
  });

  test("Preview and the live site are different versions, and live follows publishing", async ({ page, workerTenant }) => {
    await page.goto("/website/builder?page=home");
    await page.getByTestId("builder-section-hero").getByTestId("section-select").click();
    await page.getByLabel("Headline", { exact: true }).fill("Cool homes, fair prices");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Draft saved.");
    await page.goto("/website/preview");
    await expect(page.getByRole("heading", { level: 1, name: "Cool homes, fair prices" })).toBeVisible();
    await expect(page.getByText("Preview", { exact: true }).first()).toBeVisible();

    // The saved draft is not live yet.
    await page.getByRole("link", { name: "Back to editor" }).click();
    await page.getByRole("link", { name: "Website" }).first().click();
    await expect(page).toHaveURL("/website");
    await page.getByRole("link", { name: "View live website" }).first().click();
    await expect(page).toHaveURL(`/sites/${workerTenant.platformSlug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Heating & cooling service when you need it." })).toBeVisible();
    // The published site has no preview toolbar: it is the website itself.
    await expect(page.getByText("Preview", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to editor" })).toHaveCount(0);
    // Links inside the live site stay on the live site.
    await page.getByRole("navigation", { name: "Website" }).getByRole("link", { name: "About" }).click();
    await expect(page).toHaveURL(`/sites/${workerTenant.platformSlug}/about`);
    // An older "live view" link of the preview leads to the published site.
    await page.goto("/website/preview/about?view=live");
    await expect(page).toHaveURL(`/sites/${workerTenant.platformSlug}/about`);
  });

  test("the Desktop / Mobile switch narrows the customer's page", async ({ page }) => {
    await page.goto("/website/preview");
    const frame = page.getByTestId("site-frame");
    await expect(frame).toBeVisible(); // boundingBox() does not wait for the page to finish streaming
    const wide = (await frame.boundingBox())!.width;
    await page.getByRole("button", { name: "Mobile" }).click();
    await expect(page.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");
    const narrow = (await frame.boundingBox())!.width;
    expect(narrow).toBeLessThanOrEqual(390);
    expect(narrow).toBeLessThan(wide);
  });
});

test.describe("Booking on the website", () => {
  test("the Booking page offers every Service and opens its own journey", async ({ page }) => {
    await page.goto("/website/preview/booking");
    await expect(page.getByRole("heading", { level: 1, name: "Book HVAC service" })).toBeVisible();
    for (const service of SERVICES) await expect(page.getByRole("link", { name: new RegExp(service.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
    await page.getByRole("link", { name: /Annual Cooling Tune-Up/ }).click();
    await expect(page).toHaveURL("/website/preview/booking/annual-cooling-tune-up");
    await expect(page.getByRole("heading", { level: 1, name: "Annual Cooling Tune-Up & Maintenance" })).toBeVisible();
  });

  test("an unknown service offers a way back and the business phone", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    await page.goto("/website/preview/booking/nothing-here");
    await expect(page.getByRole("heading", { name: "Service not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: business.phone })).toBeVisible();
  });

  test("a request-appointment Service (AC Repair) creates a pending Website request and nothing else", async ({ page }) => {
    await page.goto("/website/preview/booking/ac-repair-diagnostics");
    await expect(page.getByText("Request appointment · 90 mins")).toBeVisible();
    await expect(page.getByRole("list", { name: "Booking steps" }).getByRole("listitem")).toHaveText([/Service/, /Arrival window/, /Issue & address/, /Confirmation/]);
    await expect(page.getByRole("heading", { name: "Choose an arrival window" })).toBeVisible();

    // Needs a window first.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Select an available time.")).toBeVisible();
    await page.getByRole("radio", { name: /^Midday/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();

    // Then the details, each validated.
    await page.getByRole("button", { name: "Submit appointment request" }).click();
    for (const message of ["Enter your full name.", "Enter a valid email address.", "Enter a phone number we can reach you on.", "Enter the service address.", "Select an option."]) {
      await expect(page.getByText(message)).toBeVisible();
    }
    await page.getByLabel(/^Full name/).fill("Jordan Miller");
    await page.getByLabel(/^Phone number/).fill("(512) 555-0111");
    await page.getByLabel(/^Email address/).fill("jordan@example.com");
    await page.getByLabel(/^Service address/).fill("3205 Barton Creek Blvd, Austin, TX 78735");
    await page.getByLabel(/primary cooling issue/).selectOption("Blowing warm air");
    await expect(page.getByRole("complementary", { name: "Booking summary" })).toContainText("No payment is taken today.");
    await page.getByRole("button", { name: "Submit appointment request" }).click();

    const done = page.getByRole("region", { name: "Appointment request submitted" });
    await expect(done).toContainText("Thanks, Jordan.");
    await expect(done).toContainText("Request reference");
    await expect(done).toContainText("BK-1043");
    await expect(done).toContainText("Mon, Oct 28 · 10:00 AM – 12:00 PM");
    await expect(done).toContainText("$89 diagnostic fee");
    await expect(done).not.toContainText(/Rostova/);

    // It is in Bookings as a pending request from the website, with the details the customer gave.
    await page.getByRole("link", { name: "Back to editor" }).click();
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    await expect(page.getByRole("tablist", { name: "Booking lists" }).getByRole("tab")).toHaveText([/^Requests\s*3$/, /^Upcoming\s*6$/, /^Past\s*6$/, /^Cancelled\s*0$/]);
    const row = page.getByRole("table", { name: "Requests bookings" }).locator("tbody tr", { hasText: "Jordan Miller" });
    await expect(row).toContainText("AC Repair & Diagnostics");
    await expect(row).toContainText("Website");
    await expect(row).toContainText("Pending");
    await row.getByRole("button", { name: /^Review booking BK-1043/ }).click();
    const drawer = page.getByRole("complementary", { name: "Booking details" });
    await expect(drawer).toContainText("(512) 555-0111");
    await expect(drawer).toContainText("jordan@example.com");
    await expect(drawer).toContainText("3205 Barton Creek Blvd");
    await expect(drawer).toContainText("Blowing warm air");

    // No quote, invoice or payment was created.
    await primaryNav(page).getByRole("link", { name: /^Payments/ }).click();
    await expect(main(page)).toContainText("$2,130");
    await primaryNav(page).getByRole("link", { name: /^Overview/ }).click();
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$6,240");
  });

  test("an instant-booking Service (Annual Cooling Tune-Up) confirms the time straight away", async ({ page }) => {
    await page.goto("/website/preview/booking/annual-cooling-tune-up");
    await expect(page.getByText("Instant booking · 60 mins")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a date and time" })).toBeVisible();
    await page.getByLabel("Date", { exact: true }).fill("2024-10-29");
    await page.getByRole("radio", { name: /^11:30 AM/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Full name/).fill("Jordan Miller");
    await page.getByLabel(/^Phone number/).fill("(512) 555-0111");
    await page.getByLabel(/^Email address/).fill("jordan@example.com");
    await page.getByLabel(/^Service address/).fill("1402 South Congress Ave, Austin, TX 78704");
    await page.getByLabel("Access notes (optional)").fill("Condo unit 3B");
    await page.getByRole("button", { name: "Confirm booking" }).click();

    const done = page.getByRole("region", { name: "Instant booking confirmed" });
    await expect(done).toContainText("Booking reference");
    await expect(done).toContainText("Tue, Oct 29 · 11:30 AM – 12:30 PM");
    await expect(done).toContainText("$129 fixed price");
    await expect(done).toContainText("No payment is collected online.");

    await page.getByRole("link", { name: "Return to homepage" }).click();
    await expect(page).toHaveURL("/website/preview");
    await page.getByRole("link", { name: "Back to editor" }).click();
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    // Confirmed on the spot: an upcoming booking, not a request. No job came with it.
    await expect(page.getByRole("tablist", { name: "Booking lists" }).getByRole("tab")).toHaveText([/^Requests\s*2$/, /^Upcoming\s*7$/, /^Past\s*6$/, /^Cancelled\s*0$/]);
    await page.getByRole("tab", { name: /^Upcoming/ }).click();
    const row = page.getByRole("table", { name: "Upcoming bookings" }).locator("tbody tr", { hasText: "Jordan Miller" });
    await expect(row).toContainText("Confirmed");
    await expect(row).toContainText("Website");
    await primaryNav(page).getByRole("link", { name: /^Jobs/ }).click();
    await expect(main(page)).not.toContainText("Jordan Miller");
  });

  test("a request-quote Service (Mini-Split) is a quote request, still only a Booking", async ({ page }) => {
    await page.goto("/website/preview/booking/ductless-mini-split-estimate");
    await expect(page.getByRole("heading", { name: "Choose a consultation slot" })).toBeVisible();
    await page.getByRole("radio", { name: /^Morning consultation/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Full name/).fill("Jordan Miller");
    await page.getByLabel(/^Phone number/).fill("(512) 555-0111");
    await page.getByLabel(/^Email address/).fill("jordan@example.com");
    await page.getByLabel(/^Service address/).fill("2208 Barton Hills Dr, Austin, TX 78704");
    await page.getByRole("button", { name: "Submit quote request" }).click();
    await expect(page.getByRole("region", { name: "Quote request submitted" })).toContainText("Any repairs are quoted for your approval before work begins.");

    await page.getByRole("link", { name: "Back to editor" }).click();
    await primaryNav(page).getByRole("link", { name: /^Quotes & Invoices/ }).click();
    await expect(main(page)).not.toContainText("Jordan Miller");
  });

  test("a closed day offers no times and Change time goes back", async ({ page }) => {
    await page.goto("/website/preview/booking/annual-cooling-tune-up");
    await page.getByLabel("Date", { exact: true }).fill("2024-10-27");
    await expect(page.getByText(/The business is closed on Suns\./)).toBeVisible();
    await page.getByLabel("Date", { exact: true }).fill("2024-10-26");
    await expect(page.getByRole("radio", { name: /^2:00 PM/ })).toBeDisabled();
    await page.getByRole("radio", { name: /^9:00 AM/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Change date & time" }).click();
    // Going back keeps what was picked.
    await expect(page.getByRole("radio", { name: /^9:00 AM/ })).toBeChecked();
  });
});

test.describe("Publishing", () => {
  test("Unpublish asks first, makes the site private everywhere, and Publish restores it", async ({ page, workerTenant, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    await page.goto("/website");
    await card(page, "Publishing").getByRole("button", { name: "Unpublish" }).click();
    const dialog = page.getByRole("dialog", { name: "Unpublish website?" });
    await expect(dialog).toContainText("Pages and content are kept");
    await expect(dialog).toContainText("Bookings, Services, Customers, Jobs, Invoices and Payments are not changed.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(card(page, "Publishing")).toContainText("Your website is live");

    await card(page, "Publishing").getByRole("button", { name: "Unpublish" }).click();
    await page.getByRole("dialog", { name: "Unpublish website?" }).getByRole("button", { name: "Unpublish" }).click();
    await expect(toast(page)).toContainText("Website unpublished. It is now private.");
    await expect(main(page)).toContainText("Draft");
    await expect(main(page)).toContainText("Only you can see it until you publish");
    await expect(card(page, "Publishing")).toContainText("Your website is a draft that only you can see.");
    await expect(card(page, "Publishing")).toContainText("Publishing does not change your Bookings, Services, Customers, Jobs, Invoices, or Payments.");
    await expect(page.getByRole("link", { name: /View live website/ })).toHaveCount(0);
    // Visitors can no longer open it.
    const closed = await page.goto(`/sites/${workerTenant.platformSlug}`);
    expect(closed?.status()).toBe(404);
    await page.goto("/website");

    // Draft: the pages say so, the draft is still previewable, the live view is not available.
    await websiteTabs(page).getByRole("link", { name: "Pages & content" }).click();
    await expect(page.getByRole("region", { name: "Website pages" }).getByText("Draft", { exact: true })).toHaveCount(6); // five rows + the summary
    await page.getByRole("link", { name: "Preview website" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Heating & cooling service/ })).toBeVisible();
    await page.getByRole("link", { name: "Back to editor" }).click();
    await page.getByRole("link", { name: "Website" }).first().click();

    await page.getByRole("button", { name: "Publish website" }).first().click();
    await expect(toast(page)).toContainText("Website published.");
    await expect(main(page)).toContainText(`Live at ${siteAddress(workerTenant.platformSlug)}`);
    // And visitors can open it again.
    const open = await page.goto(`/sites/${workerTenant.platformSlug}`);
    expect(open?.status()).toBe(200);
  });

  test("a private site keeps its Draft: it can still be edited and previewed", async ({ page }) => {
    await page.goto("/website");
    await card(page, "Publishing").getByRole("button", { name: "Unpublish" }).click();
    await page.getByRole("dialog", { name: "Unpublish website?" }).getByRole("button", { name: "Unpublish" }).click();
    await expect(toast(page)).toContainText("Website unpublished.");
    await page.getByRole("link", { name: "Edit website" }).first().click();
    await expect(page).toHaveURL("/website/builder?page=home");
    await expect(page.getByTestId("builder-status")).toHaveText("Draft saved");
    await expect(page.getByRole("link", { name: "View published site" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Preview" })).toHaveAttribute("href", "/website/preview");
    await page.goto("/website/preview");
    await page.getByRole("link", { name: "Back to editor" }).click();
    await expect(page).toHaveURL("/website/builder?page=home");
  });
});

test.describe("Domain", () => {
  // The custom-domain claims themselves (add, verify, activate, disable, remove, primary) are in domains-ui.spec.ts.
  test("shows the Climvia address as the primary one, and the empty custom-domain state before any domain is added", async ({ page, workerTenant }) => {
    await page.goto("/website/domain");
    await expect(websiteTabs(page).getByRole("link", { name: "Domain" })).toHaveAttribute("aria-current", "page");
    const climvia = card(page, "Website address");
    await expect(climvia).toContainText(siteAddress(workerTenant.platformSlug));
    await expect(climvia).toContainText("Primary website address");
    await expect(climvia).toContainText("cannot be removed");
    await expect(card(page, "Custom domains")).toContainText("No custom domain connected");
    await expect(card(page, "Custom domains").getByRole("button", { name: "Connect custom domain" })).toBeVisible();
  });
});

test.describe("Booking tab", () => {
  test("reads each Service's booking method from the catalog and links to its customer preview", async ({ page }) => {
    await page.goto("/website/booking");
    await expect(websiteTabs(page).getByRole("link", { name: "Booking" })).toHaveAttribute("aria-current", "page");
    const rows = page.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(6);
    await expect(rows.filter({ hasText: "AC Repair & Diagnostics" })).toContainText("Request appointment");
    await expect(rows.filter({ hasText: "Annual Cooling Tune-Up & Maintenance" })).toContainText("Instant booking");
    await expect(rows.filter({ hasText: "Ductless Mini-Split" })).toContainText("Request quote / assessment");
    await rows.filter({ hasText: "Annual Cooling" }).getByRole("link", { name: /Preview booking for/ }).click();
    await expect(page).toHaveURL("/website/preview/booking/annual-cooling-tune-up");
  });
});

test.describe("Website navigation", () => {
  test("every website route keeps the real shell mounted except the customer preview", async ({ page }) => {
    await page.goto("/website");
    await page.evaluate(() => {
      (document.querySelector("header") as unknown as { __tag: string }).__tag = "mounted-once";
    });
    for (const [tab, url] of [
      ["Pages & content", "/website/pages"],
      ["Booking", "/website/booking"],
      ["Domain", "/website/domain"],
      ["Overview", "/website"],
    ] as const) {
      await websiteTabs(page).getByRole("link", { name: tab }).click();
      await expect(page).toHaveURL(url);
    }
    const tag = await page.evaluate(() => (document.querySelector("header") as unknown as { __tag?: string }).__tag);
    expect(tag).toBe("mounted-once");
    await expect(primaryNav(page)).toBeVisible();
  });
});
