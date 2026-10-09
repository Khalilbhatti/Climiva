import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const main = (page: Page) => page.getByRole("main");
const toast = (page: Page) => page.getByRole("status");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const totals = (page: Page) => page.getByRole("region", { name: "Campaign totals" });
const rows = (page: Page) => page.getByRole("table", { name: "Campaigns" }).locator("tbody tr");
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
const tabCounts = (page: Page) => page.getByRole("tablist", { name: "Campaign views" }).getByRole("tab");

const FALL_MESSAGE = "It may be time to schedule your seasonal HVAC maintenance. You can review available Services and booking options with Apex Climate Heating & Air.";

/** Fills Create campaign (email) for the canonical audience and stops on the compose step. */
async function composeEmail(page: Page, name: string) {
  await page.goto("/marketing/new");
  await page.getByLabel(/^Campaign name/).fill(name);
}

/** Continues to Review & schedule. */
async function toReview(page: Page) {
  await page.getByRole("button", { name: /^Continue to review/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review & schedule campaign" })).toBeVisible();
}

test.describe("Marketing list", () => {
  test("renders the approved header, the 2 / 1 / 8 / 146 totals, tabs and the Marketing sidebar state", async ({ page }) => {
    await page.goto("/marketing");
    await expect(page.getByRole("heading", { level: 1, name: "Marketing" })).toBeVisible();
    await expect(page.getByText("Create and manage customer email and SMS campaigns.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Marketing/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Create campaign" })).toHaveAttribute("href", "/marketing/new");

    for (const [label, value, hint] of [
      ["Drafts", "2", "Campaigns being prepared"],
      ["Scheduled", "1", "Campaign ready to send later"],
      ["Sent", "8", "Completed campaigns"],
      ["Recent recipients", "146", "Recipients across recent sends"],
    ]) {
      const tile = totals(page).locator("div", { hasText: new RegExp(`^${label}`) }).filter({ hasText: hint }).first();
      await expect(tile).toContainText(value);
    }
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*11$/, /^Drafts\s*2$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);
    await expect(tab(page, "All campaigns")).toHaveAttribute("aria-selected", "true");
  });

  test("lists the campaigns with channel, audience, status, send date and recipients", async ({ page }) => {
    await page.goto("/marketing");
    await expect(page.getByRole("table", { name: "Campaigns" }).getByRole("columnheader")).toHaveText(["Campaign", "Channel", "Audience", "Status", "Send date", "Recipients", "Actions"]);
    await expect(rows(page)).toHaveCount(5);
    await expect(page.getByText("Showing 5 of 11 total campaigns")).toBeVisible();

    const fall = row(page, "Fall maintenance reminder");
    await expect(fall).toContainText("Pre-season tune-up scheduling");
    await expect(fall).toContainText("Email");
    await expect(fall).toContainText("Customers due for maintenance");
    await expect(fall).toContainText("Scheduled");
    await expect(fall).toContainText("Oct 30, 2024 · 9:00 AM");
    await expect(fall).toContainText("38");
    await expect(fall.getByRole("link", { name: "View campaign Fall maintenance reminder" })).toHaveAttribute("href", "/marketing/cmp-fall-maintenance-reminder");

    const cooling = row(page, "Cooling tune-up reminder");
    await expect(cooling).toContainText("SMS");
    await expect(cooling).toContainText("Maintenance customers");
    await expect(cooling).toContainText("Sent");
    await expect(cooling).toContainText("Oct 18, 2024");
    await expect(cooling).toContainText("42");

    const draft = row(page, "Seasonal service reminder");
    await expect(draft).toContainText("Selected customers");
    await expect(draft).toContainText("Draft");
    await expect(draft).toContainText("Not scheduled");
    await expect(draft.getByRole("link", { name: "Edit campaign Seasonal service reminder" })).toHaveAttribute("href", "/marketing/cmp-seasonal-service-reminder/edit");
  });

  test("tabs and the channel filter narrow the list; the tabs are keyboard-operable and deep-linkable", async ({ page }) => {
    await page.goto("/marketing");
    await tab(page, "All campaigns").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Drafts")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=draft/);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText("Showing 1 of 2 draft campaigns")).toBeVisible();

    await tab(page, "Scheduled").click();
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, "Fall maintenance reminder")).toBeVisible();

    await tab(page, "Sent").click();
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByText("Showing 3 of 8 sent campaigns")).toBeVisible();
    await page.getByLabel("Channel", { exact: true }).selectOption("sms");
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole("searchbox", { name: "Search campaigns" }).fill("zzz-nothing");
    await expect(page.getByText("No campaigns match your filters.")).toBeVisible();

    await page.goto("/marketing?tab=scheduled");
    await expect(tab(page, "Scheduled")).toHaveAttribute("aria-selected", "true");
  });

  test("the empty state is concise: zero totals and one primary action, no promotional cards", async ({ page }) => {
    await page.goto("/marketing?state=empty");
    await expect(page.getByRole("heading", { name: "No campaigns yet" })).toBeVisible();
    await expect(page.getByText("Create an Email or SMS campaign to communicate with existing customers.")).toBeVisible();
    await expect(page.getByText("Campaigns reach existing contacts from your Customers records.")).toBeVisible();
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*0$/, /^Drafts\s*0$/, /^Scheduled\s*0$/, /^Sent\s*0$/]);
    await expect(page.getByRole("table")).toHaveCount(0);
    for (const promo of [/upgrade/i, /learn more/i, /free trial/i, /automat/i]) await expect(main(page)).not.toContainText(promo);
  });

  test("no charts, funnels, ROI, attribution or conversion analytics on any Marketing page", async ({ page }) => {
    for (const path of ["/marketing", "/marketing/new", "/marketing/cmp-fall-maintenance-reminder", "/marketing/cmp-cooling-tune-up-reminder"]) {
      await page.goto(path);
      await page.locator("h1").first().waitFor();
      await page.waitForLoadState("networkidle");
      const text = (await main(page).innerText()).toLowerCase();
      for (const banned of ["funnel", "roi", "attribution", "conversion", "open rate", "click rate", "automation", "trigger", "gateway", "carrier", "encoding", "queue", "sender id", "dkim", "spf", "ai subject", "deliverability"]) {
        expect(text, `${path}: ${banned}`).not.toContain(banned);
      }
      await expect(page.locator("canvas, svg.recharts-surface")).toHaveCount(0);
    }
  });
});

test.describe("Create campaign: Email", () => {
  test("the Overview quick action and the Marketing button open the same single campaign editor", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("region", { name: "Core Operational Workflows" }).getByRole("link", { name: /Create campaign/ }).click();
    await expect(page).toHaveURL("/marketing/new");
    await expect(page.getByRole("heading", { level: 1, name: "Create campaign" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Marketing/ })).toHaveAttribute("aria-current", "page");

    await page.goto("/marketing");
    await page.getByRole("link", { name: "Create campaign" }).click();
    await expect(page).toHaveURL("/marketing/new");
    // The other quick actions still work.
    await page.goto("/");
    await page.getByRole("region", { name: "Core Operational Workflows" }).getByRole("link", { name: /New booking/ }).click();
    await expect(page).toHaveURL(/\/bookings/);
  });

  test("starts as an email to Customers due for maintenance: 38 recipients and the first-name token", async ({ page }) => {
    await page.goto("/marketing/new");
    await expect(page.getByText("Set up an email campaign to communicate with existing customers.")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Email/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^Customers due for maintenance/ })).toBeChecked();
    await expect(page.getByText("38 recipients", { exact: true })).toBeVisible();
    await expect(page.getByText("38 customers match customers due for maintenance.")).toBeVisible();
    await expect(page.getByText("Customers without an email address will not receive this campaign.").first()).toBeVisible();
    const summary = page.getByRole("complementary", { name: "Campaign summary" });
    await expect(summary).toContainText("Email");
    await expect(summary).toContainText("Customers due for maintenance");
    await expect(summary).toContainText("38 contacts");

    await expect(page.getByLabel(/^Subject line/)).toHaveValue("Time for seasonal HVAC maintenance");
    await expect(page.getByLabel(/^Message content/)).toHaveValue(new RegExp(`^Hi \\{\\{contact\\.first_name\\}\\},\\n\\n${FALL_MESSAGE.slice(0, 20)}`));
    await expect(page.getByText("{{contact.first_name}}", { exact: true })).toBeVisible();
    await expect(page.getByText("Adds the customer’s first name when available.")).toBeVisible();
  });

  test("Insert token puts the first-name token at the cursor, keeps focus in the message, and Preview fills in a first name", async ({ page }) => {
    await page.goto("/marketing/new");
    const message = page.getByLabel(/^Message content/);
    await message.fill("Hello  and welcome.");
    await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 6));
    await page.getByRole("button", { name: "Insert token" }).click();
    await expect(message).toHaveValue("Hello {{contact.first_name}} and welcome.");
    await expect(message).toBeFocused();

    await page.getByRole("button", { name: "Preview email" }).click();
    const preview = page.getByRole("region", { name: "Message preview" });
    await expect(preview).toContainText("Preview for Sarah Mitchell");
    await expect(preview).toContainText("Time for seasonal HVAC maintenance");
    await expect(preview).toContainText("Hello Sarah and welcome.");
    await expect(preview).not.toContainText("{{contact.first_name}}");
    await expect(page.getByRole("button", { name: "Hide preview" })).toHaveAttribute("aria-expanded", "true");
  });

  test("View recipients lists customers from the Customers records, with a sample note", async ({ page }) => {
    await page.goto("/marketing/new");
    await page.getByRole("button", { name: "View recipients" }).click();
    const dialog = page.getByRole("dialog", { name: "Recipients" });
    await expect(dialog).toContainText("Customers due for maintenance · 38 recipients");
    await expect(dialog).toContainText("Sarah Mitchell");
    await expect(dialog).toContainText("sarah.m@gmail.com");
    await expect(dialog).toContainText("Elena Rodriguez");
    await expect(dialog).toContainText("Showing 5 sample records of 38 recipients.");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  test("choosing selected customers counts the chosen ones", async ({ page }) => {
    await page.goto("/marketing/new");
    await page.getByRole("radio", { name: /^Selected customers/ }).check();
    await expect(page.getByText("No recipients yet")).toBeVisible();
    await page.getByRole("checkbox", { name: /Sarah Mitchell/ }).check();
    await page.getByRole("checkbox", { name: /David Chen/ }).check();
    await expect(page.getByText("2 recipients", { exact: true })).toBeVisible();
    await page.getByLabel(/^Campaign name/).fill("Two customers");
    await page.getByRole("checkbox", { name: /Sarah Mitchell/ }).uncheck();
    await page.getByRole("checkbox", { name: /David Chen/ }).uncheck();
    await page.getByRole("button", { name: /^Continue to review/ }).click();
    await expect(page.getByText("Choose at least one customer.")).toBeVisible();
  });

  test("the first step asks for what is missing before going on", async ({ page }) => {
    await page.goto("/marketing/new");
    await page.getByLabel(/^Subject line/).fill("");
    await page.getByLabel(/^Message content/).fill("");
    await page.getByRole("button", { name: /^Continue to review/ }).click();
    for (const message of ["Enter a campaign name.", "Enter a subject line.", "Write the message."]) await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Create campaign" })).toBeVisible();
  });

  test("Review & schedule uses the approved wording, a suggested time, and checks the date", async ({ page }) => {
    await composeEmail(page, "Late fall tune-up");
    await toReview(page);
    await expect(page.getByText("Pick a date and time to send this campaign.")).toBeVisible();
    await expect(page.getByText(/Uses your business local time/)).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Schedule for later/ })).toBeChecked();
    await expect(page.getByLabel(/^Date/)).toHaveValue("2024-10-30");
    await expect(page.getByLabel(/^Time/)).toHaveValue("09:00");

    const summary = page.getByRole("region", { name: "Campaign summary" });
    await expect(summary).toContainText("Late fall tune-up");
    await expect(summary).toContainText("Email");
    await expect(summary).toContainText("Customers due for maintenance");
    await expect(summary).toContainText("38 recipients");
    await expect(summary).toContainText("Time for seasonal HVAC maintenance");
    await expect(summary).toContainText("{{contact.first_name}}");

    await page.getByLabel(/^Date/).fill("2024-10-24");
    await page.getByRole("button", { name: "Schedule campaign" }).click();
    await expect(page.getByText("Choose today or a later date.")).toBeVisible();
    await page.getByLabel(/^Date/).fill("2024-10-25");
    await page.getByLabel(/^Time/).fill("09:00");
    await page.getByRole("button", { name: "Schedule campaign" }).click();
    await expect(page.getByText("Choose a time later than now.")).toBeVisible();
    await expect(page).toHaveURL("/marketing/new");
  });

  test("scheduling creates a Scheduled campaign for Oct 30, 2024 at 9:00 AM business time and updates the totals", async ({ page }) => {
    await composeEmail(page, "Late fall tune-up");
    await toReview(page);
    await page.getByRole("button", { name: "Schedule campaign" }).click();

    await expect(page).toHaveURL("/marketing/cmp-late-fall-tune-up");
    await expect(toast(page)).toContainText("Campaign scheduled for Oct 30, 2024 · 9:00 AM.");
    await expect(page.getByRole("heading", { level: 1, name: "Late fall tune-up" })).toBeVisible();
    await expect(main(page)).toContainText("Scheduled");
    await expect(main(page)).toContainText("Oct 30, 2024 · 9:00 AM");
    await expect(main(page)).toContainText("Central Time (CT)");

    await page.getByRole("link", { name: "Back to Marketing" }).click();
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*12$/, /^Drafts\s*2$/, /^Scheduled\s*2$/, /^Sent\s*8$/]);
    await expect(row(page, "Late fall tune-up")).toContainText("Oct 30, 2024 · 9:00 AM");
    // A reload restores the baseline.
    await page.reload();
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*11$/, /^Drafts\s*2$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);
  });

  test("Send now makes it Sent and adds its recipients to the recent recipients", async ({ page }) => {
    await composeEmail(page, "Send now test");
    await toReview(page);
    await page.getByRole("radio", { name: /^Send now/ }).check();
    await expect(page.getByLabel(/^Date/)).toHaveCount(0);
    await page.getByRole("button", { name: "Send campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-send-now-test");
    await expect(toast(page)).toContainText("Campaign sent to 38 recipients.");
    await expect(main(page)).toContainText("Sent");
    await expect(main(page)).toContainText("Oct 25, 2024 · 10:45 AM");
    await expect(main(page)).toContainText("Delivery records aren’t kept for this campaign.");

    await page.getByRole("link", { name: "Back to Marketing" }).click();
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*12$/, /^Drafts\s*2$/, /^Scheduled\s*1$/, /^Sent\s*9$/]);
    await expect(totals(page)).toContainText("184");
  });

  test("Save draft keeps it as an editable Draft", async ({ page }) => {
    await composeEmail(page, "Just a draft");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL("/marketing/cmp-just-a-draft");
    await expect(toast(page)).toContainText("Draft saved.");
    await expect(main(page)).toContainText("Draft");
    await page.getByRole("link", { name: "Edit campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-just-a-draft/edit");
    await expect(page.getByLabel(/^Campaign name/)).toHaveValue("Just a draft");
    await expect(page.getByRole("heading", { level: 1, name: "Edit campaign" })).toBeVisible();

    // A draft needs a name, and nothing else.
    await page.goto("/marketing/new");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Enter a campaign name.")).toBeVisible();
  });
});

test.describe("Create campaign: SMS", () => {
  test("switching to SMS offers Maintenance customers (42), a text message and no technical terms", async ({ page }) => {
    await page.goto("/marketing/new");
    await page.getByRole("radio", { name: /^SMS/ }).check();
    await expect(page.getByText("Set up a text message campaign to communicate with existing customers.")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Maintenance customers/ })).toBeChecked();
    await expect(page.getByText("42 recipients", { exact: true })).toBeVisible();
    await expect(page.getByText("Customers without a phone number will not receive this campaign.").first()).toBeVisible();
    await expect(page.getByLabel(/^Subject line/)).toHaveCount(0);
    const message = page.getByLabel(/^Message text/);
    await expect(message).toHaveValue(/^Hi \{\{contact\.first_name\}\}, this is Apex Climate Heating & Air\./);
    await expect(page.getByText("155 / 160 characters")).toBeVisible();
    await expect(message).toHaveAttribute("maxlength", "160");

    const text = (await main(page).innerText()).toLowerCase();
    for (const banned of ["active sms route", "standard sms encoding", "gateway", "carrier", "route", "10dlc", "sms segment", "throughput", "handset"]) expect(text, banned).not.toContain(banned);
  });

  test("the text counter follows what is typed, and the token will not overflow one message", async ({ page }) => {
    await page.goto("/marketing/new");
    await page.getByRole("radio", { name: /^SMS/ }).check();
    const message = page.getByLabel(/^Message text/);
    await message.fill("Short note");
    await expect(page.getByText("10 / 160 characters")).toBeVisible();
    await message.fill("x".repeat(150));
    await page.getByRole("button", { name: "Insert token" }).click();
    await expect(page.getByText("There isn’t room for the token: a text message can be 160 characters.")).toBeVisible();
    await expect(message).toHaveValue("x".repeat(150));
    await page.getByRole("button", { name: "Preview message" }).click();
    await expect(page.getByRole("region", { name: "Message preview" })).toContainText("x".repeat(20));
  });

  test("an SMS campaign can be scheduled: 42 recipients, no subject", async ({ page }) => {
    await page.goto("/marketing/new");
    await page.getByRole("radio", { name: /^SMS/ }).check();
    await page.getByLabel(/^Campaign name/).fill("Text reminder");
    await toReview(page);
    const summary = page.getByRole("region", { name: "Campaign summary" });
    await expect(summary).toContainText("SMS");
    await expect(summary).toContainText("42 recipients");
    await expect(summary).not.toContainText("Subject line");
    await page.getByRole("button", { name: "Schedule campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-text-reminder");
    await expect(main(page)).toContainText("SMS");
    await expect(main(page)).toContainText("42");
    await expect(main(page)).not.toContainText("Subject");
  });

  test("changing channel keeps a message the user has written, but swaps the starter text", async ({ page }) => {
    await page.goto("/marketing/new");
    await page.getByLabel(/^Message content/).fill("My own words");
    await page.getByRole("radio", { name: /^SMS/ }).check();
    await expect(page.getByLabel(/^Message text/)).toHaveValue("My own words");
    await page.getByLabel(/^Message text/).fill("");
    await page.getByRole("radio", { name: /^Email/ }).check();
    await expect(page.getByLabel(/^Message content/)).toHaveValue("");
  });

  test("channel choice is keyboard-operable", async ({ page }) => {
    await page.goto("/marketing/new");
    await page.getByRole("radio", { name: /^Email/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /^SMS/ })).toBeChecked();
  });
});

test.describe("Unsaved changes", () => {
  test("leaving a campaign being edited asks first; Keep editing and Discard changes behave", async ({ page }) => {
    await composeEmail(page, "Half-written");
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toContainText("your edits to this campaign will be lost");
    await expect(page).toHaveURL("/marketing/new");
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByLabel(/^Campaign name/)).toHaveValue("Half-written");

    await page.getByRole("button", { name: "Discard" }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(page).toHaveURL("/marketing");
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*11$/, /^Drafts\s*2$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);
  });

  test("an untouched form leaves without a prompt", async ({ page }) => {
    await page.goto("/marketing/new");
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    await expect(page).toHaveURL("/bookings");
  });
});

test.describe("Scheduled campaign", () => {
  test("shows the campaign name, channel, audience, recipients, scheduled time, subject and message, and nothing internal", async ({ page }) => {
    await page.goto("/marketing");
    await page.getByRole("link", { name: "View campaign Fall maintenance reminder" }).click();
    await expect(page).toHaveURL("/marketing/cmp-fall-maintenance-reminder");
    await expect(page.getByRole("heading", { level: 1, name: "Fall maintenance reminder" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Marketing/ })).toHaveAttribute("aria-current", "page");
    await expect(main(page)).toContainText("Scheduled");

    const summary = page.getByRole("region", { name: "Campaign summary" });
    await expect(summary).toContainText("Email");
    await expect(summary).toContainText("38");
    await expect(summary).toContainText("Customers due for maintenance");
    await expect(summary).toContainText("Oct 30, 2024 · 9:00 AM");
    await expect(summary).toContainText("Central Time (CT)");
    await expect(main(page)).toContainText("This campaign will be sent to 38 customers on Oct 30, 2024 · 9:00 AM.");
    const details = page.getByRole("region", { name: "Message details" });
    await expect(details).toContainText("Time for seasonal HVAC maintenance");
    await expect(details).toContainText("{{contact.first_name}}");
    await expect(details).toContainText(FALL_MESSAGE);

    for (const internal of ["Sender name", "Reply-to", "Template", "Variable", "workflow", "queue", "Target channel", "CTA", "Smart interval", "EDT", "Autosaved draft ID"]) {
      await expect(main(page)).not.toContainText(internal);
    }
    await expect(page.getByRole("button", { name: "Cancel scheduled send" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit campaign" })).toHaveAttribute("href", "/marketing/cmp-fall-maintenance-reminder/edit");
  });

  test("the schedule shows the same wall-clock time whatever the browser's timezone", async ({ browser, storageState }) => {
    for (const timezoneId of ["Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"]) {
      const context = await browser.newContext({ timezoneId, storageState });
      const page = await context.newPage();
      await page.goto("/marketing/cmp-fall-maintenance-reminder");
      await expect(page.getByRole("region", { name: "Campaign summary" })).toContainText("Oct 30, 2024 · 9:00 AM");
      await context.close();
    }
  });

  test("Cancel scheduled send asks first, with the approved copy and campaign snapshot", async ({ page }) => {
    await page.goto("/marketing/cmp-fall-maintenance-reminder");
    const opener = page.getByRole("button", { name: "Cancel scheduled send" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Cancel scheduled campaign?" });
    await expect(dialog).toContainText("This campaign will remain saved as a Draft and will not be sent at the scheduled time.");
    await expect(dialog).toContainText("Fall maintenance reminder");
    await expect(dialog).toContainText("Email");
    await expect(dialog).toContainText("38");
    await expect(dialog).toContainText("Oct 30, 2024 · 9:00 AM");
    await expect(dialog).toContainText("You can edit the campaign, reschedule it, or send it later from Drafts.");
    await expect(dialog.getByRole("button", { name: "Keep scheduled" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel scheduled send" })).toBeVisible();
    // Focus is inside the dialog; Escape keeps the campaign scheduled and returns to the button.
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByRole("dialog", { name: "Cancel scheduled campaign?" }).getByRole("button", { name: "Keep scheduled" }).click();
    await expect(main(page)).toContainText("Scheduled");
  });

  test("cancelling makes it a Draft rather than deleting it, with its content and recipients intact and still editable", async ({ page }) => {
    await page.goto("/marketing/cmp-fall-maintenance-reminder");
    await page.getByRole("button", { name: "Cancel scheduled send" }).click();
    await page.getByRole("dialog", { name: "Cancel scheduled campaign?" }).getByRole("button", { name: "Cancel scheduled send" }).click();
    await expect(toast(page)).toContainText("Scheduled send cancelled. The campaign is now a Draft.");
    await expect(page.getByRole("heading", { level: 1, name: "Fall maintenance reminder" }).locator("..")).toContainText("Draft");
    await expect(page.getByRole("button", { name: "Cancel scheduled send" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Campaign summary" })).toContainText("Not scheduled");
    await expect(page.getByRole("region", { name: "Campaign summary" })).toContainText("38");
    await expect(page.getByRole("region", { name: "Message details" })).toContainText(FALL_MESSAGE);

    await page.getByRole("link", { name: "Back to Marketing" }).click();
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*11$/, /^Drafts\s*3$/, /^Scheduled\s*0$/, /^Sent\s*8$/]);
    await expect(row(page, "Fall maintenance reminder")).toContainText("Draft");
    await expect(row(page, "Fall maintenance reminder")).toContainText("38");
    await expect(row(page, "Fall maintenance reminder").getByRole("link", { name: /Edit campaign/ })).toBeVisible();

    // Edit it and schedule it again.
    await row(page, "Fall maintenance reminder").getByRole("link", { name: /Edit campaign/ }).click();
    await expect(page.getByLabel(/^Campaign name/)).toHaveValue("Fall maintenance reminder");
    await expect(page.getByLabel(/^Subject line/)).toHaveValue("Time for seasonal HVAC maintenance");
    await expect(page.getByText("38 recipients", { exact: true })).toBeVisible();
    await toReview(page);
    await page.getByLabel(/^Date/).fill("2024-11-04");
    await page.getByLabel(/^Time/).fill("10:30");
    await page.getByRole("button", { name: "Schedule campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-fall-maintenance-reminder");
    await expect(main(page)).toContainText("Nov 4, 2024 · 10:30 AM");
    await expect(main(page)).toContainText("Scheduled");
  });

  test("editing a scheduled campaign warns that saving it as a draft cancels the send", async ({ page }) => {
    await page.goto("/marketing/cmp-fall-maintenance-reminder/edit");
    await expect(page.getByRole("heading", { level: 1, name: "Edit campaign" })).toBeVisible();
    await expect(page.getByText("This campaign is scheduled. Saving it as a draft cancels the scheduled send.")).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL("/marketing/cmp-fall-maintenance-reminder");
    await expect(page.getByRole("button", { name: "Cancel scheduled send" })).toHaveCount(0);
  });
});

test.describe("Sent campaign", () => {
  test("Cooling tune-up reminder: 42 recipients, 42 sent, 40 delivered, 2 not delivered", async ({ page }) => {
    await page.goto("/marketing");
    await page.getByRole("link", { name: "View campaign Cooling tune-up reminder" }).click();
    await expect(page).toHaveURL("/marketing/cmp-cooling-tune-up-reminder");
    await expect(page.getByRole("heading", { level: 1, name: "Cooling tune-up reminder" })).toBeVisible();
    await expect(main(page)).toContainText("Sent");

    const results = page.getByRole("region", { name: "Campaign results" });
    await expect(results.locator("div", { hasText: /^Recipients/ }).first()).toContainText("42");
    await expect(results).toContainText("Total targeted contacts");
    await expect(results).toContainText("Messages sent");
    await expect(results.locator("div", { hasText: /^Delivered/ }).first()).toContainText("40");
    await expect(results.locator("div", { hasText: /^Not delivered/ }).first()).toContainText("2");

    const details = page.getByRole("region", { name: "Campaign details" });
    await expect(details).toContainText("SMS");
    await expect(details).toContainText("Oct 18, 2024 · 10:15 AM");
    await expect(details).toContainText("Maintenance customers");
    await expect(details).toContainText("{{contact.first_name}}");
    await expect(details).toContainText("this is Apex Climate Heating & Air. If you’re due for seasonal maintenance, you can review available booking options in Climvia.");
    await expect(page.getByRole("button", { name: "Duplicate campaign" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit campaign" })).toHaveCount(0);
  });

  test("delivery records: customer, destination, status and time, filterable, with status in words", async ({ page }) => {
    await page.goto("/marketing/cmp-cooling-tune-up-reminder");
    const records = page.getByRole("table", { name: "Delivery records" });
    await expect(records.getByRole("columnheader")).toHaveText(["Customer", "Destination", "Delivery status", "Time"]);
    await expect(records.locator("tbody tr")).toHaveCount(6);
    await expect(page.getByText("Showing 6 sample records of 42 recipients")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Delivery status" }).getByRole("tab")).toHaveText([/^All\s*42$/, /^Delivered\s*40$/, /^Not delivered\s*2$/]);

    // Customers with a record are read from it; the rest are snapshots.
    const sarah = records.locator("tbody tr", { hasText: "Sarah Mitchell" });
    await expect(sarah).toContainText("(512) 555-0194");
    await expect(sarah).toContainText("Delivered");
    await expect(sarah.getByRole("link", { name: "Sarah Mitchell" })).toHaveAttribute("href", "/customers/sarah-mitchell");
    await expect(records.locator("tbody tr", { hasText: "David Chen" })).toContainText("(512) 670-1190");
    await expect(records.locator("tbody tr", { hasText: "Robert Garcia" })).toContainText("(555) 441-2098");
    await expect(records.locator("tbody tr", { hasText: "Linda Zhao" })).toContainText("Not delivered");

    await tab(page, "Not delivered").click();
    await expect(records.locator("tbody tr")).toHaveCount(2);
    await expect(records).toContainText("Linda Zhao");
    await expect(records).toContainText("Marcus Sterling");
    await expect(records).toContainText("The message could not be delivered to this contact.");
    await expect(page.getByText("Showing 2 sample records of 2 not delivered")).toBeVisible();
    await tab(page, "Delivered").click();
    await expect(records.locator("tbody tr")).toHaveCount(4);
    await expect(records).not.toContainText("Not delivered");
  });

  test("Duplicate campaign creates a new Draft and leaves the Sent campaign exactly as it was", async ({ page }) => {
    await page.goto("/marketing/cmp-cooling-tune-up-reminder");
    await page.getByRole("button", { name: "Duplicate campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-cooling-tune-up-reminder-copy");
    await expect(toast(page)).toContainText("Draft created from Cooling tune-up reminder.");
    await expect(page.getByRole("heading", { level: 1, name: "Cooling tune-up reminder (copy)" })).toBeVisible();
    await expect(main(page)).toContainText("Draft");
    await expect(main(page)).toContainText("SMS");
    await expect(main(page)).toContainText("42");
    await expect(page.getByRole("region", { name: "Message details" })).toContainText("{{contact.first_name}}");
    await expect(main(page)).not.toContainText("Delivered");

    await page.getByRole("link", { name: "Back to Marketing" }).click();
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*12$/, /^Drafts\s*3$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);
    await expect(row(page, "Cooling tune-up reminder (copy)")).toContainText("Draft");
    await expect(rows(page).filter({ hasText: /^Cooling tune-up reminder(?! \(copy\))/ })).toContainText("Sent");

    await page.getByRole("link", { name: "View campaign Cooling tune-up reminder", exact: true }).click();
    await expect(main(page)).toContainText("Sent");
    await expect(page.getByRole("region", { name: "Campaign results" })).toContainText("40");
    await expect(page.getByRole("link", { name: "Edit campaign" })).toHaveCount(0);
    // A second copy is its own draft.
    await page.getByRole("button", { name: "Duplicate campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-cooling-tune-up-reminder-copy-2");
  });

  test("a sent campaign cannot be opened for editing", async ({ page }) => {
    await page.goto("/marketing/cmp-cooling-tune-up-reminder/edit");
    await expect(page.getByRole("heading", { name: "This campaign has been sent" })).toBeVisible();
    await expect(page.getByText("A sent campaign can’t be edited. Duplicate it to start a new draft from the same message.")).toBeVisible();
    await page.getByRole("link", { name: "View campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-cooling-tune-up-reminder");
  });

  test("older sent campaigns show what is recorded and say what is not", async ({ page }) => {
    await page.goto("/marketing/cmp-winter-heating-prep-notice");
    await expect(page.getByRole("heading", { level: 1, name: "Winter heating prep notice" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Campaign results" })).toContainText("48");
    await expect(page.getByRole("region", { name: "Campaign details" })).toContainText("Oct 5, 2024");
    await expect(page.getByRole("region", { name: "Campaign details" })).toContainText("All customers");
    await expect(page.getByText("Delivery records aren’t kept for this campaign.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Campaign results" })).not.toContainText("Not delivered");
  });
});

test.describe("Campaign not found", () => {
  test("an unknown campaign shows a not-found state inside the shell, in the detail and the editor", async ({ page }) => {
    for (const path of ["/marketing/cmp-nobody", "/marketing/cmp-nobody/edit"]) {
      await page.goto(path);
      await expect(primaryNav(page)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Campaign not found" })).toBeVisible();
      await page.getByRole("link", { name: "Back to Marketing" }).click();
      await expect(page).toHaveURL("/marketing");
    }
  });
});
