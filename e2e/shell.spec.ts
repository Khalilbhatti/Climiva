import { business, currentUser } from "../scripts/db/seed-data/apex";
import { OVERVIEW_TOTALS } from "./apex-data";
import { NAV_GROUPS, NAV_UTILITY } from "../src/config/navigation";
import { expect, test } from "./fixtures";

const ROUTES = [...NAV_GROUPS.flatMap((group) => group.items), ...NAV_UTILITY];

test.describe("Global shell", () => {
  test("every sidebar link opens its route with exactly one active item, and the shell never remounts", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (document.querySelector("header") as unknown as { __tag: string }).__tag = "mounted-once";
    });
    const nav = page.getByRole("navigation", { name: "Primary" });

    for (const item of ROUTES) {
      await nav.getByRole("link", { name: item.label }).click();
      await expect(page).toHaveURL(item.href);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(nav.locator("a[aria-current='page']")).toHaveCount(1);
      await expect(nav.locator("a[aria-current='page']")).toHaveAttribute("href", item.href);
    }

    expect(await page.evaluate(() => (document.querySelector("header") as unknown as { __tag?: string }).__tag)).toBe("mounted-once");
  });

  test("keeps the approved shell geometry", async ({ page }) => {
    await page.goto("/");
    const header = await page.locator("header").boundingBox();
    const sidebar = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
    expect(header).toMatchObject({ x: 0, y: 0, height: 64 });
    expect(sidebar).toMatchObject({ x: 0, y: 64, width: 240 });
  });

  test("top bar: no Pro pill, a bell with no unread dot, and the approved workspace/profile/search", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header");

    await expect(header.getByText("Pro", { exact: true })).toHaveCount(0);
    await expect(header.getByRole("button", { name: new RegExp(business.name) })).toBeVisible();
    await expect(header.getByRole("button", { name: new RegExp(currentUser.name) })).toContainText(currentUser.role);
    await expect(header.getByPlaceholder("Search customers, jobs, bookings, schedule...")).toBeVisible();

    const bell = header.getByRole("button", { name: "Notifications" });
    await expect(bell).toBeVisible();
    await expect(bell.locator("span")).toHaveCount(0); // the unread indicator is gone until notifications exist
  });
});

test.describe("Overview", () => {
  test("renders the approved content from the centralized fixtures", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText(`What needs your attention today at ${business.name}.`)).toBeVisible();

    const metrics = page.getByRole("region", { name: "Key metrics" });
    await expect(metrics).toContainText(String(OVERVIEW_TOTALS.bookings));
    await expect(metrics).toContainText(String(OVERVIEW_TOTALS.completedJobs));
    await expect(metrics).toContainText("$6,240");
    await expect(metrics).toContainText("$2,130");
    await expect(metrics).toContainText("7 recorded non-voided payments");

    for (const title of ["Create booking", "Add customer", "Record payment", "Create maintenance plan", "Create campaign"]) {
      await expect(page.getByRole("region", { name: "Quick actions" }).getByRole("link", { name: new RegExp(title) })).toBeVisible();
    }
  });

  test("the business card is titled “Business information” and links to Settings", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("region", { name: "Business information" });
    await expect(card).toContainText(business.phone);
    await expect(card).toContainText(business.email);
    await expect(card).toContainText("4820 East Riverside Dr, Suite 110");
    await expect(page.getByText("Canonical Business Source-of-Truth")).toHaveCount(0);

    await card.getByRole("link", { name: /Manage Settings/ }).click();
    await expect(page).toHaveURL("/settings");
  });

  test("quick actions route to their module pages", async ({ page }) => {
    const targets: [string, string][] = [
      ["Record payment", "/payments?record=1"],
      ["Create maintenance plan", "/maintenance-plans?new=1"],
      ["Create campaign", "/marketing/new"],
    ];
    for (const [title, href] of targets) {
      await page.goto("/");
      await page.getByRole("region", { name: "Quick actions" }).getByRole("link", { name: new RegExp(title) }).click();
      await expect(page).toHaveURL(href);
    }
  });
});

test.describe("Every module is a real page", () => {
  test("Help, Analytics and Settings are real pages inside the shell, not placeholders", async ({ page }) => {
    for (const path of ["/help", "/analytics", "/settings"]) {
      await page.goto(path);
      await expect(page.getByText("isn't built yet")).toHaveCount(0);
      await expect(page.getByText("Module Foundation Ready")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    }
  });
});
