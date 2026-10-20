/**
 * Phase 8, Parts C, E and F: Help is a finished route, the sidebar is exactly the approved navigation, and the four
 * Overview quick actions open the one real implementation of each flow.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

const SIDEBAR: { group: string; items: [string, string][] }[] = [
  { group: "Overview", items: [["Overview", "/overview"]] },
  {
    group: "Operations",
    items: [
      ["Bookings", "/bookings"],
      ["Schedule", "/schedule"],
      ["Jobs", "/jobs"],
      ["Customers", "/customers"],
    ],
  },
  {
    group: "Business",
    items: [
      ["Services", "/services"],
      ["Team", "/team"],
    ],
  },
  {
    group: "Financials",
    items: [
      ["Quotes & Invoices", "/quotes-invoices"],
      ["Payments", "/payments"],
      ["Maintenance Plans", "/maintenance-plans"],
    ],
  },
  {
    group: "Growth",
    items: [
      ["Website", "/website"],
      ["Marketplace", "/marketplace-listing"],
      ["Reviews", "/reviews"],
      ["Marketing", "/marketing"],
    ],
  },
  { group: "Insights", items: [["Analytics", "/analytics"]] },
];
const UTILITY: [string, string][] = [
  ["Settings", "/settings"],
  ["Help", "/help"],
];

/** The sidebar as a plain list, so it can be compared before and after something happens. */
async function readSidebar(page: Page) {
  return primaryNav(page).evaluate((nav) => ({
    groups: [...nav.querySelectorAll("h2")].map((heading) => heading.textContent?.trim()),
    links: [...nav.querySelectorAll("a")].map((link) => ({
      label: (link.textContent ?? "").replace(/\d+$/, "").trim(),
      href: link.getAttribute("href"),
      badge: /\d+$/.exec((link.textContent ?? "").trim())?.[0] ?? null,
    })),
  }));
}

test.describe("Help is a finished route", () => {
  test("opens inside the shell with its heading and the one supporting line, and the sidebar item is current", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    await expect(page.getByText("Find the workspace area you need help with.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Help" })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(/Help/);
    await expect(page.getByText(/isn.t built yet|placeholder|later phase/i)).toHaveCount(0);
  });

  test("offers one card for each area the brief names, each leading to a real route", async ({ page }) => {
    await page.goto("/help");
    const cards: [string, string[]][] = [
      ["Bookings & Schedule", ["/bookings", "/schedule"]],
      ["Customers & Services", ["/customers", "/services"]],
      ["Jobs", ["/jobs"]],
      ["Team", ["/team"]],
      ["Quotes, Invoices & Payments", ["/quotes-invoices", "/payments"]],
      ["Maintenance Plans", ["/maintenance-plans"]],
      ["Website & Marketplace", ["/website", "/marketplace-listing"]],
      ["Reviews & Marketing", ["/reviews", "/marketing"]],
      ["Analytics", ["/analytics"]],
      ["Settings", ["/settings"]],
    ];
    await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveText(cards.map(([title]) => title));
    for (const [title, hrefs] of cards) {
      const card = page.getByRole("region", { name: title, exact: true });
      await expect(card.getByRole("link")).toHaveCount(hrefs.length);
      for (const href of hrefs) await expect(card.locator(`a[href="${href}"]`)).toHaveCount(1);
    }
  });

  test("every link on the page opens a real screen, not a placeholder or a 404", async ({ page }) => {
    await page.goto("/help");
    const hrefs = await page.locator("main a").evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
    expect(hrefs).toHaveLength(15);
    for (const href of hrefs) {
      await page.goto(href);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.locator("main")).not.toContainText(/isn.t built yet|couldn.t find that page/i);
    }
  });

  test("links to modules by the sidebar's own names, and only inside the app", async ({ page }) => {
    await page.goto("/help");
    const names = await page.locator("main a").allInnerTexts();
    const sidebar = (await readSidebar(page)).links.map((link) => link.label);
    for (const name of names) expect(sidebar, name).toContain(name.trim());
    for (const link of await page.locator("main a").evaluateAll((links) => links.map((a) => a.getAttribute("href")!))) expect(link).toMatch(/^\//);
  });

  test("invents no support channel: no email, phone, chat, hours, SLA, tickets, article counts or outside links", async ({ page }) => {
    await page.goto("/help");
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const banned of ["@", "tel:", "chat", "support hours", "sla", "ticket", "knowledge base", "articles", "live support", "contact support", "call us", "email us", "documentation", "http"]) {
      expect(text, banned).not.toContain(banned);
    }
    expect(text).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}/);
    await expect(page.locator("main a[href^='http'], main a[href^='mailto'], main a[href^='tel']")).toHaveCount(0);
    await expect(page.locator("main form, main input, main textarea")).toHaveCount(0);
  });

  test("fits inside the content area at a narrow width", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/help");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("the sidebar is exactly the approved navigation", () => {
  test("six groups in order, seventeen links, exact labels and routes, Settings and Help pinned below", async ({ page }) => {
    await page.goto("/");
    const sidebar = await readSidebar(page);
    expect(sidebar.groups).toEqual(SIDEBAR.map((entry) => entry.group));
    const expected = [...SIDEBAR.flatMap((entry) => entry.items), ...UTILITY];
    expect(sidebar.links.map((link) => [link.label, link.href])).toEqual(expected);
    expect(new Set(sidebar.links.map((link) => link.href)).size).toBe(sidebar.links.length);
    expect(sidebar.links).toHaveLength(17);

    // The module list is in the scrolling region; Settings and Help sit below it, outside the groups.
    const utility = await primaryNav(page).evaluate((nav) => [...nav.querySelectorAll("section")].flatMap((section) => [...section.querySelectorAll("a")].map((link) => link.textContent?.trim())).filter((text) => /^(Settings|Help)$/.test(text ?? "")));
    expect(utility).toEqual([]);
  });

  test("the only counts are the approved aggregates on Bookings and Jobs", async ({ page }) => {
    await page.goto("/");
    const badges = (await readSidebar(page)).links.filter((link) => link.badge).map((link) => [link.label, link.badge]);
    expect(badges).toEqual([
      ["Bookings", "24"],
      ["Jobs", "18"],
    ]);
  });

  test("no obsolete or duplicate item is offered", async ({ page }) => {
    await page.goto("/");
    const labels = (await readSidebar(page)).links.map((link) => link.label);
    for (const gone of ["Dashboard", "Onboarding", "Pro", "Reports", "Inbox", "Calendar", "Invoices", "Quotes", "Marketing Hub", "Module"]) expect(labels, gone).not.toContain(gone);
    await expect(primaryNav(page).getByRole("link", { name: /^Settings$/ })).toHaveCount(1);
    await expect(primaryNav(page).getByRole("link", { name: /^Help$/ })).toHaveCount(1);
  });

  test("each item is current on its own screen and on that module's nested screens, and on nothing else", async ({ page }) => {
    await page.goto("/");
    const everything = [...SIDEBAR.flatMap((entry) => entry.items), ...UTILITY];
    for (const [label, href] of everything) {
      await primaryNav(page).getByRole("link", { name: new RegExp(`^${label.replace(/[&]/g, "\\$&")}`) }).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(primaryNav(page).locator("a[aria-current='page']")).toHaveCount(1);
      await expect(primaryNav(page).locator("a[aria-current='page']")).toHaveAttribute("href", href);
    }
    for (const [url, href] of [
      ["/jobs/JB-204/files", "/jobs"],
      ["/customers/sarah-mitchell/properties", "/customers"],
      ["/team/roles/owner", "/team"],
      ["/quotes-invoices/invoices/INV-1044", "/quotes-invoices"],
      ["/website/builder?page=home", "/website"],
      ["/settings/profile", "/settings"],
      ["/analytics?tab=plans", "/analytics"],
    ] as const) {
      await page.goto(url);
      await expect(primaryNav(page).locator("a[aria-current='page']")).toHaveAttribute("href", href);
    }
  });

  test("it survives what the session does: a payment, a completed job, a saved setting and a created booking", async ({ page }) => {
    await page.goto("/");
    const before = await readSidebar(page);

    await page.goto("/payments");
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const pay = page.getByRole("dialog", { name: "Record payment" });
    await pay.getByRole("radio", { name: /INV-1050/ }).check();
    await pay.getByRole("button", { name: "Continue" }).click();
    await pay.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("dialog", { name: "Payment recorded" }).getByRole("button", { name: "Close", exact: true }).click();
    expect(await readSidebar(page)).toEqual(before);

    await primaryNav(page).getByRole("link", { name: /^Jobs/ }).click();
    await page.getByRole("link", { name: "#JB-201" }).first().click();
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const done = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await done.getByLabel("Technician debrief & resolution notes").fill("Done.");
    await done.getByRole("button", { name: "Complete job" }).click();
    expect(await readSidebar(page)).toEqual(before);

    await primaryNav(page).getByRole("link", { name: "Settings" }).click();
    await page.getByLabel("City", { exact: false }).first().fill("Round Rock");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Business information saved.");
    expect(await readSidebar(page)).toEqual(before);
    await expect(primaryNav(page).locator("a[aria-current='page']")).toHaveAttribute("href", "/settings");

    await primaryNav(page).getByRole("link", { name: "Help" }).click();
    await expect(primaryNav(page).locator("a[aria-current='page']")).toHaveAttribute("href", "/help");
    expect(await readSidebar(page)).toEqual(before);
  });
});

test.describe("the Overview quick actions are the real flows", () => {
  const FLOWS: { title: string; href: string; description: string; open: (page: Page) => Promise<void> }[] = [
    { title: "New booking", href: "/bookings?new=1", description: "Book customer visit", open: (page) => expect(page.getByRole("dialog", { name: "Create booking" })).toBeVisible() },
    { title: "Record payment", href: "/payments?record=1", description: "Log customer payment", open: (page) => expect(page.getByRole("dialog", { name: "Record payment" })).toBeVisible() },
    { title: "Create maintenance plan", href: "/maintenance-plans?new=1", description: "Add maintenance plan", open: (page) => expect(page.getByRole("dialog", { name: "Create maintenance plan" })).toBeVisible() },
    { title: "Create campaign", href: "/marketing/new", description: "Create customer campaign", open: (page) => expect(page.getByRole("heading", { level: 1, name: "Create campaign" })).toBeVisible() },
  ];

  test("the four actions, with their approved wording, are the only ones", async ({ page }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Core Operational Workflows" });
    await expect(section.getByRole("link")).toHaveCount(4);
    for (const flow of FLOWS) {
      const link = section.getByRole("link", { name: new RegExp(`^${flow.title}`) });
      await expect(link).toHaveAttribute("href", flow.href);
      await expect(link).toContainText(flow.description);
    }
  });

  for (const flow of FLOWS) {
    test(`${flow.title} opens the real flow, and Back returns to the Overview`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("region", { name: "Core Operational Workflows" }).getByRole("link", { name: new RegExp(`^${flow.title}`) }).click();
      await expect(page).toHaveURL(new RegExp(flow.href.replace(/[?]/g, "\\?")));
      await flow.open(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/overview$/);
      await expect(page.getByRole("heading", { level: 1, name: "Workspace Overview" })).toBeVisible();
    });
  }

  test("each flow is reached the same way from its own module: one implementation, not a copy", async ({ page }) => {
    await page.goto("/bookings");
    await page.getByRole("button", { name: "Create booking" }).first().click();
    await expect(page).toHaveURL(/\/bookings\?new=1$/);
    await expect(page.getByRole("dialog", { name: "Create booking" })).toBeVisible();

    await page.goto("/payments");
    await page.getByRole("button", { name: "Record payment" }).first().click();
    await expect(page).toHaveURL(/\/payments\?record=1$/);
    await expect(page.getByRole("dialog", { name: "Record payment" })).toBeVisible();

    await page.goto("/maintenance-plans");
    await page.getByRole("button", { name: /Create (maintenance )?plan/ }).first().click();
    await expect(page).toHaveURL(/\/maintenance-plans\?new=1$/);
    await expect(page.getByRole("dialog", { name: "Create maintenance plan" })).toBeVisible();

    await page.goto("/marketing");
    await page.getByRole("link", { name: /Create campaign/ }).first().click();
    await expect(page).toHaveURL(/\/marketing\/new$/);
  });

  test("the source defines each flow's dialog once", () => {
    function sourceFiles(dir: string): string[] {
      return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx$/.test(entry) ? [path] : [];
      });
    }
    const files = sourceFiles("src");
    for (const title of ['title="Create booking"', 'title="Create maintenance plan"', 'title="Record payment"']) {
      const defining = files.filter((file) => readFileSync(file, "utf8").includes(title));
      expect(defining, title).toHaveLength(1);
    }
    expect(files.filter((file) => /export function CampaignBuilder\b/.test(readFileSync(file, "utf8")))).toHaveLength(1);
  });

  test("Manage Settings opens Settings on Business information", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("region", { name: "Business information" }).getByRole("link", { name: /Manage Settings/ }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { level: 2, name: "Business information" })).toBeVisible();
    await expect(page.getByLabel("Business name")).toHaveValue("Apex Climate Heating & Air");
    await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Business information" })).toHaveAttribute("aria-current", "page");
  });
});
