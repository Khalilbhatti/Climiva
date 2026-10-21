/**
 * The top bar's two new menus: the workspace switcher and the account menu. They keep the approved top-bar geometry and
 * add keyboard-operable, announced disclosure panels.
 */
import type { Page } from "playwright/test";
import { expect, expectAccessible, switcher, test } from "./saas";

const panel = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const userButton = (page: Page) => page.getByRole("button", { name: /Alex Morgan, Operations Lead/ });

test.describe("workspace switcher", () => {
  test("shows the business name, closed, and opens a list of the person's workspaces", async ({ page }) => {
    await page.goto("/");
    const button = switcher(page);
    await expect(button).toHaveText(/Apex Climate Heating & Air/);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const list = panel(page, "Workspaces");
    await expect(list).toBeVisible();
    await expect(list.getByRole("button")).toHaveCount(1);
    await expect(list.getByRole("button", { name: /Apex Climate Heating & Air/ })).toHaveAttribute("aria-current", "true");
    await expect(list.getByRole("button", { name: /Apex Climate Heating & Air/ })).toContainText("Owner");
  });

  test("offers Business settings and Create a workspace", async ({ page }) => {
    await page.goto("/");
    await switcher(page).click();
    const list = panel(page, "Workspaces");
    await expect(list.getByRole("link", { name: "Business settings" })).toHaveAttribute("href", "/settings");
    await expect(list.getByRole("link", { name: "Create a workspace" })).toHaveAttribute("href", "/onboarding?new=1");
    await list.getByRole("link", { name: "Business settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(panel(page, "Workspaces")).toHaveCount(0);
  });

  test("Escape closes it and returns focus to the button; so does clicking elsewhere", async ({ page }) => {
    await page.goto("/");
    const button = switcher(page);
    await button.click();
    await page.keyboard.press("Escape");
    await expect(panel(page, "Workspaces")).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.click();
    await page.getByRole("main").click({ position: { x: 700, y: 400 } });
    await expect(panel(page, "Workspaces")).toHaveCount(0);
  });

  test("works from the keyboard alone", async ({ page }) => {
    await page.goto("/");
    await switcher(page).focus();
    await page.keyboard.press("Enter");
    await expect(panel(page, "Workspaces")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(panel(page, "Workspaces").getByRole("button").first()).toBeFocused();
  });

  test("the name follows a saved change to Business information", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Renamed Heating Co");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Business information saved.");
    await expect(switcher(page)).toContainText("Renamed Heating Co");
    await switcher(page).click();
    await expect(panel(page, "Workspaces")).toContainText("Renamed Heating Co");
  });

  test("choosing the workspace already open just closes the list", async ({ page }) => {
    await page.goto("/customers");
    await switcher(page).click();
    await panel(page, "Workspaces").getByRole("button", { name: /Apex Climate Heating & Air/ }).click();
    await expect(panel(page, "Workspaces")).toHaveCount(0);
    await expect(page).toHaveURL(/\/customers$/);
  });

  test("a switch that fails says so and leaves the workspace as it was", async ({ openAs }) => {
    const { page } = await openAs("casey");
    await page.goto("/");
    await switcher(page).click();
    await page.route("**/overview", (route) => (route.request().headers()["next-action"] ? route.abort() : route.continue()));
    await panel(page, "Workspaces").getByRole("button", { name: /Northstar/ }).click();
    await expect(panel(page, "Workspaces").getByRole("alert")).toContainText("We couldn't reach the server");
    await expect(switcher(page)).toContainText("Apex Climate Heating & Air");
  });
});

test.describe("the open menus are accessible", () => {
  test("the workspace list passes the structural and contrast checks", async ({ page }) => {
    await page.goto("/");
    await switcher(page).click();
    await expect(panel(page, "Workspaces")).toBeVisible();
    await expectAccessible(page);
  });

  test("the account menu passes the structural and contrast checks", async ({ page }) => {
    await page.goto("/");
    await userButton(page).click();
    await expect(panel(page, "Account")).toBeVisible();
    await expectAccessible(page);
  });

  test("the read-only Settings of a member pass the structural and contrast checks", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/settings");
    await expect(page.getByText("Only an owner or admin can change this. You can view it here.")).toBeVisible();
    await expectAccessible(page);
  });

  test("the empty workspace overview and the pages of a small business pass the checks", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "Getting started" })).toBeVisible();
    await expectAccessible(page);
    // Customers, Services and Team are the business's own data now: Northstar's pages are real, and pass the same checks.
    for (const path of ["/customers", "/services", "/team"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectAccessible(page);
    }
    // Website and Marketplace are Northstar's own too.
    for (const path of ["/website", "/marketplace-listing"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectAccessible(page);
    }
  });
});

test.describe("account menu", () => {
  test("shows who is signed in, their sign-in email and their role in this workspace", async ({ page, workerTenant }) => {
    await page.goto("/");
    const button = userButton(page);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toContainText("Alex Morgan");
    await button.click();
    const menu = panel(page, "Account");
    await expect(menu).toContainText("Alex Morgan");
    await expect(menu).toContainText(workerTenant.email);
    await expect(menu).toContainText("Owner · Apex Climate Heating & Air");
  });

  test("My profile opens the profile settings", async ({ page }) => {
    await page.goto("/");
    await userButton(page).click();
    await panel(page, "Account").getByRole("link", { name: "My profile" }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByRole("heading", { level: 2, name: "My profile" })).toBeVisible();
  });

  test("Escape closes it and returns focus to the button", async ({ page }) => {
    await page.goto("/");
    await userButton(page).click();
    await expect(panel(page, "Account")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page, "Account")).toHaveCount(0);
    await expect(userButton(page)).toBeFocused();
  });

  test("only one top-bar panel is open at a time", async ({ page }) => {
    await page.goto("/");
    await switcher(page).click();
    await userButton(page).click();
    await expect(panel(page, "Workspaces")).toHaveCount(0);
    await expect(panel(page, "Account")).toBeVisible();
  });

  test("a member sees their own role and cannot be mistaken for an owner", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/");
    await page.getByRole("button", { name: /Jamie Rivera/ }).click();
    await expect(panel(page, "Account")).toContainText("Member · Apex Climate Heating & Air");
  });

  test("a log out that cannot reach the server says the person is still logged in", async ({ openAs }) => {
    const { page } = await openAs("alex");
    await page.goto("/");
    await userButton(page).click();
    await page.route("**/overview", (route) => (route.request().headers()["next-action"] ? route.abort() : route.continue()));
    await panel(page, "Account").getByRole("button", { name: "Log out" }).click();
    await expect(panel(page, "Account").getByRole("alert")).toContainText("you are still logged in");
    await expect(page).toHaveURL(/\/overview$/);
    await expect(panel(page, "Account").getByRole("button", { name: "Log out" })).toBeEnabled();
  });
});

test.describe("members cannot change the workspace", () => {
  test("Jamie can read Settings but every field and button is disabled, with an explanation", async ({ openAs, db }) => {
    const { page, problems } = await openAs("jamie");
    for (const [path, label] of [["/settings", /^Business name/], ["/settings/hours", /Monday open/], ["/settings/preferences", /^Time zone/]] as const) {
      await page.goto(path);
      await expect(page.getByText("Only an owner or admin can change this. You can view it here.")).toBeVisible();
      await expect(page.getByLabel(label).first()).toBeDisabled();
      await expect(page.getByRole("button", { name: /^Save/ })).toBeDisabled();
    }
    const unchanged = await db.query("select name from organizations where slug = 'apex-climate-heating-air'");
    expect(unchanged.rows[0].name).toBe("Apex Climate Heating & Air");
    expect(problems).toEqual([]);
  });

  test("Jamie's own profile is still editable", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/settings/profile");
    await expect(page.getByLabel(/^Full name/)).toBeEnabled();
    await expect(page.getByText("Your role is set by an owner of this workspace.")).toHaveCount(0);
  });

  test("an owner sees no read-only notice", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Only an owner or admin can change this.")).toHaveCount(0);
    await expect(page.getByLabel(/^Business name/)).toBeEnabled();
  });
});
