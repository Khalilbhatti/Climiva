import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const main = (page: Page) => page.getByRole("main");
const toast = (page: Page) => page.getByRole("status");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const totals = (page: Page) => page.getByRole("region", { name: "Review totals" });
const card = (page: Page, name: string) => page.getByRole("article", { name: `Review from ${name}` });

const SARAH_TEXT = "The technician explained the repair clearly and completed the work as scheduled.";
const SARAH_REPLY =
  "Thank you, Sarah. We appreciate your feedback and are glad the repair process was clear and completed as scheduled.";

test.describe("Reviews list", () => {
  test("renders the approved header, the 12 / 4.7 / 3 / 5 totals and the Reviews sidebar state", async ({ page }) => {
    await page.goto("/reviews");
    await expect(page.getByRole("heading", { level: 1, name: "Reviews" })).toBeVisible();
    await expect(page.getByText("View customer reviews and respond from one place.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Reviews/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Request review" })).toBeVisible();

    await expect(totals(page).getByText("Total reviews")).toBeVisible();
    await expect(totals(page)).toContainText("Customer reviews received");
    await expect(totals(page)).toContainText("Across recorded reviews");
    await expect(totals(page)).toContainText("Reviews without a response");
    await expect(totals(page)).toContainText("Requests sent recently");
    for (const [value, label] of [
      ["12", "Total reviews"],
      ["4.7", "Average rating"],
      ["3", "Awaiting reply"],
      ["5", "Review requests"],
    ]) {
      await expect(totals(page).locator("div", { hasText: new RegExp(`^${label}`) }).filter({ hasText: value }).first()).toBeVisible();
    }
  });

  test("three accessible tabs with the approved counts, deep-linkable and keyboard-operable", async ({ page }) => {
    await page.goto("/reviews");
    const tabs = page.getByRole("tablist", { name: "Review views" });
    await expect(tabs.getByRole("tab")).toHaveText([/^All reviews\s*12$/, /^Awaiting reply\s*3$/, /^Responded\s*9$/]);
    await expect(tab(page, "All reviews")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Showing 4 of 12 reviews")).toBeVisible();

    await tab(page, "All reviews").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Awaiting reply")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=awaiting/);
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(card(page, "Sarah Mitchell")).toBeVisible();
    await expect(card(page, "Elena Rodriguez")).toBeVisible();
    await expect(page.getByText("Showing 2 of 3 reviews awaiting reply")).toBeVisible();

    await tab(page, "Responded").click();
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(card(page, "David Chen")).toBeVisible();
    await expect(card(page, "Marcus Sterling")).toBeVisible();
    await expect(page.getByText("Showing 2 of 9 responded reviews")).toBeVisible();

    await page.goto("/reviews?tab=responded");
    await expect(tab(page, "Responded")).toHaveAttribute("aria-selected", "true");
  });

  test("search, rating and source filters narrow the list and can be cleared by changing view", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("searchbox", { name: "Search reviews" }).fill("sarah");
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search reviews" }).fill("zzz-nothing");
    await expect(page.getByText("No reviews match your filters.")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search reviews" }).fill("");
    await page.getByLabel("Rating", { exact: true }).selectOption("4");
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(card(page, "David Chen")).toBeVisible();
    await page.getByLabel("Rating", { exact: true }).selectOption("all");
    await page.getByLabel("Source", { exact: true }).selectOption("Climvia");
    await expect(page.getByRole("article")).toHaveCount(4);
  });

  test("ratings have text, not stars alone", async ({ page }) => {
    await page.goto("/reviews");
    await expect(card(page, "Sarah Mitchell").getByRole("img", { name: "5 out of 5 stars" })).toBeVisible();
    await expect(card(page, "David Chen").getByRole("img", { name: "4 out of 5 stars" })).toBeVisible();
  });

  test("the empty state is concise: zero totals, one way forward", async ({ page }) => {
    await page.goto("/reviews?state=empty");
    await expect(page.getByRole("heading", { name: "No reviews yet" })).toBeVisible();
    await expect(page.getByText("Customer reviews will appear here when they are submitted.")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Review views" }).getByRole("tab")).toHaveText([/^All reviews\s*0$/, /^Awaiting reply\s*0$/, /^Responded\s*0$/]);
    await expect(totals(page)).toContainText("—");
    await expect(totals(page)).toContainText("No reviews recorded yet");
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText("Review requests can be sent to existing customers after completed work.")).toBeVisible();
    for (const promo of [/upgrade/i, /learn more/i, /free trial/i]) await expect(main(page)).not.toContainText(promo);
  });
});

test.describe("Sarah Mitchell's review", () => {
  test("is the canonical review: 5 stars, Climvia, the approved text, her Customers record and job JB-204", async ({ page }) => {
    await page.goto("/reviews");
    const review = card(page, "Sarah Mitchell");
    await expect(review).toContainText("Climvia");
    await expect(review).toContainText("Oct 25, 2024");
    await expect(review).toContainText("Awaiting reply");
    await expect(review).toContainText(SARAH_TEXT);
    await expect(review.getByRole("img", { name: "5 out of 5 stars" })).toBeVisible();
    await expect(review.getByRole("link", { name: /Job #JB-204 · AC Repair & Diagnostics/ })).toHaveAttribute("href", "/jobs/JB-204");
    await expect(review.getByRole("button", { name: "Reply to review from Sarah Mitchell" })).toBeVisible();
  });

  test("opens from the list: detail with the review, no response yet, and links to the customer and the job", async ({ page }) => {
    await page.goto("/reviews");
    await card(page, "Sarah Mitchell").getByRole("link", { name: "Sarah Mitchell" }).click();
    await expect(page).toHaveURL("/reviews/rev-sarah-mitchell");
    await expect(primaryNav(page).getByRole("link", { name: /^Reviews/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "Sarah Mitchell" })).toBeVisible();
    await expect(main(page)).toContainText("Awaiting reply");
    await expect(main(page)).toContainText("5.0");
    await expect(main(page)).toContainText("Received Oct 25, 2024");
    await expect(main(page)).toContainText("Source: Climvia");
    await expect(page.getByRole("img", { name: "5 out of 5 stars" }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Customer review" })).toContainText(SARAH_TEXT);
    await expect(page.getByRole("region", { name: "Business response" })).toContainText("No response posted yet");

    const related = page.getByRole("region", { name: "Related records" });
    await expect(related.getByRole("link", { name: /Sarah Mitchell/ })).toHaveAttribute("href", "/customers/sarah-mitchell");
    await expect(related.getByRole("link", { name: /#JB-204 · AC Repair & Diagnostics/ })).toHaveAttribute("href", "/jobs/JB-204");
    // Only what the approved flow shows: no verification, equipment, tenure or location metadata.
    for (const extra of ["Verified", "Customer since", "Carrier", "Equipment", "Residential Customer", "Service Plan", "Total Visits", "Barton"]) {
      await expect(main(page)).not.toContainText(extra);
    }

    await page.getByRole("link", { name: /#JB-204/ }).click();
    await expect(page).toHaveURL("/jobs/JB-204");
    await expect(page.getByRole("heading", { level: 1, name: "Job #JB-204" })).toBeVisible();
  });

  test("an unknown review shows a not-found state inside the shell", async ({ page }) => {
    await page.goto("/reviews/rev-nobody");
    await expect(primaryNav(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review not found" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Reviews" }).click();
    await expect(page).toHaveURL("/reviews");
  });
});

test.describe("Reply and edit response", () => {
  test("Reply opens the labelled dialog with the review and the approved response, and Cancel changes nothing", async ({ page }) => {
    await page.goto("/reviews");
    const reply = page.getByRole("button", { name: "Reply to review from Sarah Mitchell" });
    await reply.click();
    const dialog = page.getByRole("dialog", { name: "Reply to review" });
    await expect(dialog).toContainText("Write a public response to Sarah Mitchell’s review.");
    await expect(dialog).toContainText(SARAH_TEXT);
    await expect(dialog.getByRole("img", { name: "5 out of 5 stars" })).toBeVisible();
    await expect(dialog.getByLabel(/^Public response/)).toHaveValue(SARAH_REPLY);
    await expect(dialog).toContainText("115 / 500");
    await expect(dialog).toContainText("Your response will be visible with this review.");
    await expect(dialog).toContainText("Responses can be edited at any time.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(reply).toBeFocused();
    await expect(card(page, "Sarah Mitchell")).toContainText("Awaiting reply");
  });

  test("a response cannot be empty", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Reply to review from Elena Rodriguez" }).click();
    const dialog = page.getByRole("dialog", { name: "Reply to review" });
    await expect(dialog.getByLabel(/^Public response/)).toHaveValue("");
    await dialog.getByRole("button", { name: "Post response" }).click();
    await expect(dialog.getByText("Write a response before posting.")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("posting the response moves the same review to Responded, and the totals and tabs follow", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Reply to review from Sarah Mitchell" }).click();
    await page.getByRole("dialog", { name: "Reply to review" }).getByRole("button", { name: "Post response" }).click();
    await expect(toast(page)).toContainText("Response posted.");

    const review = card(page, "Sarah Mitchell");
    await expect(review).toContainText("Responded");
    await expect(review).not.toContainText("Awaiting reply");
    await expect(review).toContainText(SARAH_REPLY);
    await expect(review.getByRole("link", { name: "View response to Sarah Mitchell" })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(4);
    await expect(page.getByRole("tablist", { name: "Review views" }).getByRole("tab")).toHaveText([/^All reviews\s*12$/, /^Awaiting reply\s*2$/, /^Responded\s*10$/]);
    await expect(totals(page)).toContainText("4.7");
    await tab(page, "Awaiting reply").click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(card(page, "Elena Rodriguez")).toBeVisible();
    await tab(page, "Responded").click();
    await expect(card(page, "Sarah Mitchell")).toBeVisible();
  });

  test("the detail page shows who replied and when, and Edit response updates the same response", async ({ page }) => {
    await page.goto("/reviews/rev-sarah-mitchell");
    await page.getByRole("button", { name: "Reply to review" }).click();
    await page.getByRole("dialog", { name: "Reply to review" }).getByRole("button", { name: "Post response" }).click();
    await expect(page.getByText("Response posted.").first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Your response has been added to the review." })).toBeVisible();
    await expect(page.getByRole("main").getByText("Responded", { exact: true })).toBeVisible();

    const response = page.getByRole("region", { name: "Business response" });
    await expect(response).toContainText(SARAH_REPLY);
    await expect(response).toContainText("Responded by Alex Morgan · Oct 25, 2024 at 10:45 AM");
    await expect(page.getByRole("button", { name: "Reply to review" })).toHaveCount(0);

    await page.getByRole("button", { name: "Edit response" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit response" });
    await expect(dialog).toContainText("Update your public response to Sarah Mitchell’s review.");
    await expect(dialog.getByLabel(/^Public response/)).toHaveValue(SARAH_REPLY);
    await dialog.getByLabel(/^Public response/).fill("Thank you, Sarah. We are glad the repair went smoothly.");
    await dialog.getByRole("button", { name: "Save response" }).click();
    // The change is stored on the server first; the dialog closes (and the "posted" notice goes) once it is.
    await expect(dialog).toBeHidden();
    await expect(toast(page)).toContainText("Response updated.");
    await expect(response).toContainText("Thank you, Sarah. We are glad the repair went smoothly.");
    await expect(response).not.toContainText(SARAH_REPLY);
    await expect(response).toContainText("Responded by Alex Morgan · Oct 25, 2024 at 10:45 AM · Edited");

    // Still one review, still one response, and the totals did not move.
    await primaryNav(page).getByRole("link", { name: /^Reviews/ }).click();
    await expect(page.getByRole("article")).toHaveCount(4);
    await expect(page.getByRole("tablist", { name: "Review views" }).getByRole("tab")).toHaveText([/^All reviews\s*12$/, /^Awaiting reply\s*2$/, /^Responded\s*10$/]);
    await expect(card(page, "Sarah Mitchell").locator("div.bg-surface-low")).toHaveCount(1);
  });

  test("an already answered review can be opened from its card and its response edited", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("link", { name: "View response to David Chen" }).click();
    await expect(page).toHaveURL("/reviews/rev-david-chen");
    await expect(page.getByRole("region", { name: "Business response" })).toContainText("Thanks David, appreciate the feedback!");
    await page.getByRole("button", { name: "Edit response" }).click();
    await page.getByRole("dialog", { name: "Edit response" }).getByLabel(/^Public response/).fill("Thanks again, David!");
    await page.getByRole("dialog", { name: "Edit response" }).getByRole("button", { name: "Save response" }).click();
    await expect(page.getByRole("region", { name: "Business response" })).toContainText("Thanks again, David!");
    await expect(page.getByRole("tablist").first()).toHaveCount(0); // no list tabs on the detail page
  });
});

test.describe("Request review", () => {
  test("opens for Sarah Mitchell with email and SMS from her Customers record, and the approved wording", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await expect(dialog).toContainText("Send a review request to a customer after completed work.");
    await expect(dialog.getByLabel("Customer")).toHaveValue("sarah-mitchell");
    await expect(dialog.getByRole("radio", { name: /^Email/ })).toBeChecked();
    await expect(dialog.locator("label", { hasText: "Email" })).toContainText("sarah.m@gmail.com");
    await expect(dialog.locator("label", { hasText: "SMS" })).toContainText("(512) 555-0194");
    await expect(dialog.getByLabel(/^Message/)).toHaveValue("Thanks for choosing Apex Climate Heating & Air. We’d appreciate your feedback about your recent service.");
    await expect(dialog).toContainText("Customer will receive this message along with a link to submit their feedback.");
    await expect(dialog).toContainText("No incentives or rewards are included.");
    await expect(dialog).toContainText("Only completed jobs are available for review requests.");
    for (const banned of [/discount/i, /reward points/i, /gift/i, /only if/i, /positive reviews/i]) await expect(dialog).not.toContainText(banned);
    // Only her completed jobs are offered: JB-204 (completed today) is preselected, JB-142 is her earlier job.
    const jobs = dialog.getByLabel("Related job (optional)");
    await expect(jobs.locator("option")).toHaveText([
      /^No related job$/,
      /^#JB-204 · AC Repair & Diagnostics · Completed Oct 25, 2024$/,
      /^#JB-142 · .* · Completed May 14, 2024$/,
    ]);
    await expect(jobs).toHaveValue("JB-204");
    await expect(dialog).not.toContainText("isn't available yet");
    await expect(dialog).not.toContainText(/complete the job first/i);
  });

  test("Email and SMS are real choices, and sending records the request without sending anything", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await dialog.getByRole("radio", { name: /^SMS/ }).check();
    await expect(dialog.getByRole("radio", { name: /^SMS/ })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /^Email/ })).not.toBeChecked();
    await dialog.getByRole("button", { name: "Send review request" }).click();
    await expect(toast(page)).toContainText("Review request recorded for Sarah Mitchell by SMS. Nothing is sent.");
    await expect(totals(page)).toContainText("6");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the message is required, and changing customer changes the destinations", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await dialog.getByLabel("Customer").selectOption("david-chen");
    await expect(dialog.locator("label", { hasText: "Email" })).toContainText("d.chen@outlook.com");
    await expect(dialog.locator("label", { hasText: "SMS" })).toContainText("(512) 670-1190");
    // David has a completed job, so it is offered.
    await expect(dialog.getByLabel("Related job (optional)").locator("option")).toHaveCount(2);
    await dialog.getByLabel(/^Message/).fill("");
    await dialog.getByRole("button", { name: "Send review request" }).click();
    await expect(dialog.getByText("Write the message the customer will receive.")).toBeVisible();
  });

  test("JB-204 is offered straight away, and the request records Sarah and JB-204", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    const jobs = dialog.getByLabel("Related job (optional)");
    await expect(jobs.locator("option")).toHaveCount(3);
    await expect(jobs).toHaveValue("JB-204");
    await expect(dialog).not.toContainText("isn't available yet");
    await dialog.getByRole("button", { name: "Send review request" }).click();
    await expect(toast(page)).toContainText("Review request recorded for Sarah Mitchell by email.");
    await expect(totals(page)).toContainText("6");
  });

  test("a job completed in Jobs during the session is offered for its customer, and is the default", async ({ page }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const complete = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await complete.getByLabel("Technician debrief & resolution notes").fill("Heat pump diagnosed and repaired.");
    await complete.getByRole("button", { name: "Complete job" }).click();
    await expect(page.getByRole("button", { name: "Complete job" })).toHaveCount(0);

    await primaryNav(page).getByRole("link", { name: /^Reviews/ }).click();
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await dialog.getByLabel("Customer").selectOption("david-chen");
    const jobs = dialog.getByLabel("Related job (optional)");
    await expect(jobs.locator("option")).toHaveCount(3);
    await expect(jobs).toHaveValue("JB-201");
    await expect(jobs.locator("option", { hasText: "#JB-201 · Heat Pump Diagnostics & Repair · Completed Oct 25, 2024" })).toHaveCount(1);
  });

  test("a review request never creates a Marketing campaign", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    await page.getByRole("dialog", { name: "Request a review" }).getByRole("button", { name: "Send review request" }).click();
    await primaryNav(page).getByRole("link", { name: /^Marketing/ }).click();
    await expect(page.getByRole("tablist", { name: "Campaign views" }).getByRole("tab")).toHaveText([/^All campaigns\s*11$/, /^Drafts\s*2$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);
    await expect(page.getByRole("table", { name: "Campaigns" })).not.toContainText(/review/i);
  });

  test("the dialog is labelled, traps focus, and Escape closes it back to the button", async ({ page }) => {
    await page.goto("/reviews");
    const opener = page.getByRole("button", { name: "Request review" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe("Reviews content rules", () => {
  test("no verification, outside-site, scoring or AI claims appear on any Reviews page", async ({ page }) => {
    for (const path of ["/reviews", "/reviews?tab=awaiting", "/reviews?state=empty", "/reviews/rev-sarah-mitchell", "/reviews/rev-david-chen"]) {
      await page.goto(path);
      const text = (await page.locator("main").innerText()).toLowerCase();
      for (const banned of ["verified", "google", "business profile", "syndicat", "sentiment", "ai-generated", "ai response", "seo", "conversion", "rostova", "reputation score"]) {
        expect(text, `${path}: ${banned}`).not.toContain(banned);
      }
    }
  });
});
