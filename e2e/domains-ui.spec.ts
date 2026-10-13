/**
 * Phase 18B: the Domain Manager in the browser, on the worker's own copy of the Apex business: adding a domain, the record to create, checking
 * ownership against DNS answers the test supplies, activating, choosing the main address, disabling and removing, a screen that is behind,
 * and what the screen does and does not claim. Nothing here depends on the internet.
 */
import type { Page } from "playwright/test";
import { DNS_NOT_FOUND, DNS_TOO_SOON, DNS_WRONG_VALUE, DNS_UNAVAILABLE, DOMAIN_IN_USE, DOMAIN_STALE, ACTIVATION_NOTE } from "../src/lib/domain-rules";
import { HOSTNAME_PROBLEM_TEXT } from "../src/lib/hostname";
import { insertActiveClaim, publishTxt, setDns, uniqueHost } from "./domain-helpers";
import { verificationRecordName, verificationRecordValue } from "../src/lib/domain-rules";
import { adminDb } from "../scripts/db/lib";
import { makeBusiness } from "./assets-helpers";
import { ORIGIN, expect, test } from "./saas";

const toast = (page: Page) => page.locator('div[role="status"][aria-live="polite"]');
const region = (page: Page, name: string) => page.getByRole("region", { name });
const custom = (page: Page) => region(page, "Custom domains");

/** Open the Domain screen and add a domain through the dialog. */
async function addDomain(page: Page, host: string) {
  await page.goto("/website/domain");
  await custom(page).getByRole("button", { name: /Connect custom domain|Add domain/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Connect custom domain" });
  await dialog.getByLabel("Domain name").fill(host);
  await dialog.getByRole("button", { name: "Add domain" }).click();
  await expect(custom(page)).toContainText(host);
}

const recordOf = async (page: Page) => ({
  name: (await custom(page).getByText(/^_climvia-verification\./).first().innerText()).trim(),
  value: (await custom(page).getByText(/^climvia-site-verification=/).first().innerText()).trim(),
});

test.describe("adding a domain", () => {
  test("the dialog says what is wrong with a name before anything is sent, and the server says what the screen could not know", async ({ page }) => {
    await page.goto("/website/domain");
    await custom(page).getByRole("button", { name: "Connect custom domain" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect custom domain" });
    const submit = async (value: string) => {
      await dialog.getByLabel("Domain name").fill(value);
      await dialog.getByRole("button", { name: "Add domain" }).click();
    };
    for (const [value, message] of [
      ["", HOSTNAME_PROBLEM_TEXT.empty],
      ["https://www.example.com", HOSTNAME_PROBLEM_TEXT.scheme],
      ["www.example.com/path", HOSTNAME_PROBLEM_TEXT.path],
      ["*.example.com", HOSTNAME_PROBLEM_TEXT.wildcard],
      ["127.0.0.1", HOSTNAME_PROBLEM_TEXT.ip],
      ["www.example.com:443", HOSTNAME_PROBLEM_TEXT.port],
      ["localhost", HOSTNAME_PROBLEM_TEXT["single-label"]],
    ] as const) {
      await submit(value);
      await expect(dialog, value).toContainText(message);
    }
    // Climvia's own names pass the screen's first look and are refused by the server, which knows them.
    await submit("shop.climvia.com");
    await expect(dialog).toContainText("That domain can't be used.");
    // Escape closes the dialog and nothing was added.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(custom(page)).toContainText("No custom domain connected");
  });

  test("a valid domain is stored as it will be compared, shows the record to create, and survives a reload and a fresh browser", async ({ page, db, workerTenant, browser }) => {
    const host = uniqueHost("added");
    await page.goto("/website/domain");
    await custom(page).getByRole("button", { name: "Connect custom domain" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect custom domain" });
    await dialog.getByLabel("Domain name").fill(` ${host.toUpperCase()}. `);
    await dialog.getByRole("button", { name: "Add domain" }).click();
    await expect(toast(page)).toContainText(`${host} was added. Verify ownership to continue.`);

    const card = custom(page);
    await expect(card).toContainText(host);
    await expect(card).toContainText("Ownership not verified");
    await expect(card).toContainText("Climvia has not yet confirmed that you control this domain.");
    const record = await recordOf(page);
    expect(record.name).toBe(verificationRecordName(host));
    expect(record.value).toMatch(/^climvia-site-verification=[A-Za-z0-9_-]{43}$/);
    await expect(card.getByRole("button", { name: "Verify ownership" })).toBeVisible();
    // It is a claim in the database, pending, with exactly that token, and not main.
    const stored = (await db.query("select hostname, status, is_primary, verification_token from site_domains where organization_id = $1", [workerTenant.organizationId])).rows;
    expect(stored).toEqual([{ hostname: host, status: "pending_verification", is_primary: false, verification_token: record.value.replace("climvia-site-verification=", "") }]);
    // Nothing says it works yet.
    for (const area of [custom(page), region(page, "Website address")]) await expect(area).not.toContainText(/\b(live|connected|secure|ssl)\b/i);

    // Reload: the same claim, the same record.
    await page.reload();
    expect(await recordOf(page)).toEqual(record);
    // A fresh browser (no shared page state, a new session cookie jar copy) sees it too.
    const fresh = await browser.newContext({ baseURL: ORIGIN, storageState: workerTenant.storageState });
    try {
      const other = await fresh.newPage();
      await other.goto("/website/domain");
      expect(await recordOf(other)).toEqual(record);
      await expect(custom(other)).toContainText("Ownership not verified");
    } finally {
      await fresh.close();
    }
    // The Website overview lists it too, as not verified.
    await page.goto("/website");
    await expect(region(page, "Website address")).toContainText(host);
    await expect(region(page, "Website address")).toContainText("Ownership not verified");
    await expect(region(page, "Website address").getByRole("link", { name: "Manage domains" })).toBeVisible();
  });

  test("a name that is already held, by anyone, is refused in one sentence that says nothing about who holds it", async ({ page, db, workerTenant }) => {
    const host = uniqueHost("taken");
    // Held by another business: a second, disposable organization with an active claim.
    const admin = adminDb();
    try {
      const other = await makeBusiness("taken", admin.db);
      await insertActiveClaim(db, other.organizationId, host);
      await page.goto("/website/domain");
      await custom(page).getByRole("button", { name: "Connect custom domain" }).click();
      const dialog = page.getByRole("dialog", { name: "Connect custom domain" });
      for (const spelling of [host, host.toUpperCase(), `${host}.`]) {
        await dialog.getByLabel("Domain name").fill(spelling);
        await dialog.getByRole("button", { name: "Add domain" }).click();
        await expect(dialog).toContainText(DOMAIN_IN_USE);
        await expect(dialog).not.toContainText(/Northstar|Logo Test|another|business|organization/i);
      }
      expect((await db.query("select count(*)::int as n from site_domains where organization_id = $1", [workerTenant.organizationId])).rows[0].n).toBe(0);
    } finally {
      await admin.pool.end();
    }
  });
});

test.describe("proving ownership", () => {
  test("the screen tells what the check found, and a DNS failure changes nothing", async ({ page, db }) => {
    const host = uniqueHost("proof");
    await addDomain(page, host);
    const { value } = await recordOf(page);
    const verify = custom(page).getByRole("button", { name: "Verify ownership" });
    const again = async () => {
      await db.query("update site_domains set last_checked_at = null where hostname = $1", [host]);
    };

    await verify.click();
    await expect(toast(page)).toContainText(DNS_NOT_FOUND);
    // Asked again at once: told to wait, without asking DNS.
    await verify.click();
    await expect(toast(page)).toContainText(DNS_TOO_SOON);

    await again();
    setDns(verificationRecordName(host), [[verificationRecordValue("somebody-elses-token")]]);
    await verify.click();
    await expect(toast(page)).toContainText(DNS_WRONG_VALUE);

    await again();
    setDns(verificationRecordName(host), "timeout");
    await verify.click();
    await expect(toast(page)).toContainText(DNS_UNAVAILABLE);
    // Through all of it the claim is as it was, and shows the same record.
    await expect(custom(page)).toContainText("Ownership not verified");
    expect((await recordOf(page)).value).toBe(value);

    await again();
    setDns(verificationRecordName(host), [[value]]);
    await verify.click();
    await expect(toast(page)).toContainText(`Ownership of ${host} is verified.`);
    await expect(custom(page)).toContainText("Verified");
    await expect(custom(page)).not.toContainText("Verify ownership");
    // The record is no longer shown: it has done its job.
    await expect(custom(page).getByText(/^climvia-site-verification=/)).toHaveCount(0);
  });

  test("after verification the screen says where to point DNS, and that serving needs more than this screen can show", async ({ page }) => {
    const host = uniqueHost("route");
    await addDomain(page, host);
    publishTxt(host, (await recordOf(page)).value.replace("climvia-site-verification=", ""));
    await custom(page).getByRole("button", { name: "Verify ownership" }).click();
    await expect(custom(page)).toContainText("Verified");
    const card = custom(page);
    await expect(card).toContainText("Point your domain at Climvia");
    await expect(card).toContainText(`Create a CNAME record for ${host} that points to sites.climvia.com.`);
    await expect(card).toContainText("ALIAS, ANAME or CNAME-flattening");
    await expect(card).toContainText(ACTIVATION_NOTE);
    await expect(card).toContainText("You control this domain. It is not serving your website yet.");
    await expect(card.getByRole("button", { name: "Activate" })).toBeVisible();
  });

  test("the record can be copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const host = uniqueHost("copy");
    await addDomain(page, host);
    const { name, value } = await recordOf(page);
    await custom(page).getByRole("button", { name: "Copy Record value" }).click();
    await expect(toast(page)).toContainText("Record value copied to clipboard.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
    await custom(page).getByRole("button", { name: "Copy Record name" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(name);
  });
});

test.describe("serving, the main address, disabling and removing", () => {
  /** Add, publish the record, verify and return the host. */
  async function verifiedDomain(page: Page, label: string) {
    const host = uniqueHost(label);
    await addDomain(page, host);
    publishTxt(host, (await recordOf(page)).value.replace("climvia-site-verification=", ""));
    await custom(page).getByRole("button", { name: "Verify ownership" }).click();
    await expect(custom(page)).toContainText("Verified");
    return host;
  }

  test("activating makes it active in Climvia and the main address; the overview and the screen say so without saying it is live", async ({ page, workerTenant }) => {
    const host = await verifiedDomain(page, "serve");
    await custom(page).getByRole("button", { name: "Activate" }).click();
    await expect(toast(page)).toContainText(`${host} is now active in Climvia.`);
    await expect(custom(page)).toContainText("Active in Climvia");
    await expect(custom(page).getByText("Primary", { exact: true })).toBeVisible();
    await expect(page.getByText("Current primary address:")).toContainText(host);
    await expect(region(page, "Website address")).toContainText(`${workerTenant.platformSlug}.climvia.com`);
    await expect(region(page, "Website address").getByRole("button", { name: "Make primary" })).toBeVisible();
    for (const area of [custom(page), region(page, "Website address")]) await expect(area).not.toContainText(/\b(live|connected|secure|ssl)\b/i);
    // The overview and the Business information card use it as the website address.
    await page.goto("/website");
    await expect(region(page, "Website address")).toContainText(host);
    await expect(region(page, "Website address")).toContainText("Active in Climvia");
  });

  test("the Climvia address can be made the main one again, and the domain keeps serving; then the domain can be made main again", async ({ page, db, workerTenant }) => {
    const host = await verifiedDomain(page, "main");
    await custom(page).getByRole("button", { name: "Activate" }).click();
    await expect(custom(page)).toContainText("Active in Climvia");
    await region(page, "Website address").getByRole("button", { name: "Make primary" }).click();
    await expect(toast(page)).toContainText(`${workerTenant.platformSlug}.climvia.com is now the primary website address.`);
    await expect(region(page, "Website address")).toContainText("Primary website address");
    await expect(page.getByText("Current primary address:")).toContainText(`${workerTenant.platformSlug}.climvia.com`);
    expect((await db.query("select status, is_primary from site_domains where hostname = $1", [host])).rows[0]).toEqual({ status: "active", is_primary: false });
    await custom(page).getByRole("button", { name: "Make primary" }).click();
    await expect(page.getByText("Current primary address:")).toContainText(host);
    expect((await db.query("select is_primary from site_domains where hostname = $1", [host])).rows[0].is_primary).toBe(true);
  });

  test("disabling stops it being served and main, can be undone, and removing frees the name for a new claim with a new record", async ({ page, db }) => {
    const host = await verifiedDomain(page, "end");
    const firstRecord = (await db.query<{ verification_token: string }>("select verification_token from site_domains where hostname = $1", [host])).rows[0].verification_token;
    await custom(page).getByRole("button", { name: "Activate" }).click();
    await expect(custom(page)).toContainText("Active in Climvia");
    await custom(page).getByRole("button", { name: "Disable" }).click();
    await expect(toast(page)).toContainText(`${host} was disabled.`);
    await expect(custom(page)).toContainText("Disabled");
    await expect(custom(page)).toContainText("Climvia no longer shows your website for this domain.");
    await expect(page.getByText("Current primary address:")).not.toContainText(host);
    expect((await db.query("select status, is_primary from site_domains where hostname = $1", [host])).rows[0]).toEqual({ status: "disabled", is_primary: false });

    await custom(page).getByRole("button", { name: "Re-enable" }).click();
    await expect(custom(page)).toContainText("Active in Climvia");

    // Removing asks first, says what happens, and then the name is free.
    await page.getByRole("button", { name: `More actions for ${host}` }).click();
    await page.getByRole("menuitem", { name: "Remove domain" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove custom domain?" });
    await expect(dialog).toContainText("stops showing your website for this domain at once");
    await expect(dialog).toContainText("verify it again with a new record");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(custom(page)).toContainText(host);
    await page.getByRole("button", { name: `More actions for ${host}` }).click();
    await page.getByRole("menuitem", { name: "Remove domain" }).click();
    await dialog.getByRole("button", { name: "Remove domain" }).click();
    await expect(toast(page)).toContainText(`${host} was removed.`);
    await expect(custom(page)).toContainText("No custom domain connected");
    await expect(page.getByText("Current primary address:")).not.toContainText(host);

    // The same name again: a new claim, a new record.
    await addDomain(page, host);
    const second = (await recordOf(page)).value.replace("climvia-site-verification=", "");
    expect(second).not.toBe(firstRecord);
    expect((await db.query("select status, count(*) over () as n from site_domains where hostname = $1 and status <> 'removed'", [host])).rows).toEqual([{ status: "pending_verification", n: "1" }]);
    expect((await db.query("select count(*)::int as n from site_domains where hostname = $1", [host])).rows[0].n).toBe(2);
  });

  test("a screen that is behind can not undo what another one did: it is told to reload and nothing changes", async ({ page, context, db }) => {
    const host = await verifiedDomain(page, "stale");
    const behind = await context.newPage();
    await behind.goto("/website/domain");
    await expect(custom(behind)).toContainText("Verified");
    // The first screen moves on: it activates and then disables the domain.
    await custom(page).getByRole("button", { name: "Activate" }).click();
    await expect(custom(page)).toContainText("Active in Climvia");
    await custom(page).getByRole("button", { name: "Disable" }).click();
    await expect(custom(page)).toContainText("Disabled");
    const before = (await db.query("select status, is_primary, revision from site_domains where hostname = $1", [host])).rows[0];

    // The second one still shows "Verified" and offers Activate.
    await custom(behind).getByRole("button", { name: "Activate" }).click();
    await expect(toast(behind)).toContainText(DOMAIN_STALE);
    await expect(custom(behind)).toContainText("Verified");
    expect((await db.query("select status, is_primary, revision from site_domains where hostname = $1", [host])).rows[0]).toEqual(before);
    await behind.reload();
    await expect(custom(behind)).toContainText("Disabled");
  });

  test("the main-address choice, the buttons and the dialogs work from the keyboard, and the overflow menu closes with Escape", async ({ page }) => {
    const host = await verifiedDomain(page, "keys");
    const menu = page.getByRole("button", { name: `More actions for ${host}` });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Remove domain" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Remove domain" })).toHaveCount(0);
    await expect(menu).toBeFocused();
    // The dialog is labelled and Escape closes it.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Remove custom domain?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Remove custom domain?" })).toBeHidden();
  });
});

test.describe("no domain is made up", () => {
  test("a business that has never added a domain sees its Climvia address and an empty state, and the overview offers to connect one", async ({ page, workerTenant }) => {
    await page.goto("/website/domain");
    await expect(region(page, "Website address")).toContainText(`${workerTenant.platformSlug}.climvia.com`);
    await expect(region(page, "Website address")).toContainText("Primary website address");
    await expect(custom(page)).toContainText("No custom domain connected");
    await expect(page.locator("main")).not.toContainText(/apexclimateair|example\.test|Configured|Pending verification/);
    await page.goto("/website");
    await expect(region(page, "Website address").getByRole("link", { name: "Connect custom domain" })).toBeVisible();
    await expect(region(page, "Website checklist")).toContainText("Custom domain");
    await expect(region(page, "Website checklist")).toContainText("Optional");
  });
});
