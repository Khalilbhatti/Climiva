/**
 * Phase 17: the Template Gallery, the Template preview and choosing a Template, in the browser, on each worker's own copy of the Apex business.
 *
 * Looking is free (the Gallery, a preview, every page and width, cancelling at any point leave the stored Draft exactly as it was);
 * using a Template is deliberate (a confirmation that says what is replaced and what is not) and replaces the Draft only: the published
 * website is the same, to the byte, until it is published. A tab that is behind cannot replace a newer Draft, a member who may only look
 * cannot use a Template, and a new business starts from the starter and can choose any of the others.
 */
import { randomBytes } from "node:crypto";
import { DEFAULT_TEMPLATE } from "../src/db/default-template";
import { findTemplateRecord } from "../src/db/site-templates";
import { STALE_DRAFT } from "../src/lib/site-builder-rules";
import { completeOnboarding, expect, expectAccessible, NOT_SIGNED_IN, signUp, test, waitsForHydration } from "./saas";
import { canvas, canvasPick, headlineField, openBuilder, publishButton, saveDraft, statusBadge, toasts } from "./website-builder-ui";
import { HEADLINES, applyTemplate, card, chooseTemplate, contentOf, openGallery, pageContent, publicHtml, stored, useButton } from "./website-templates-ui";

test.describe("the Gallery", () => {
  test("it shows exactly the four Templates, in a fixed order, each with a picture, a description, a way to preview it and a way to use it", async ({ page }) => {
    await openGallery(page);
    await expect(page.locator("[data-template]")).toHaveCount(4);
    await expect(page.getByTestId("template-name")).toHaveText(["Climvia Starter", "Precision", "Comfort", "Airflow"]);
    expect(await page.locator("[data-template]").evaluateAll((items) => items.map((item) => item.getAttribute("data-template")))).toEqual(["climvia-starter", "precision", "comfort", "airflow"]);
    for (const [key, name] of [["climvia-starter", "Climvia Starter"], ["precision", "Precision"], ["comfort", "Comfort"], ["airflow", "Airflow"]]) {
      const item = card(page, key);
      await expect(item.getByRole("img", { name: `Preview picture of the ${name} template` })).toBeVisible();
      await expect(item.getByRole("link", { name: `Preview the ${name} template` })).toBeVisible();
      await expect(useButton(page, name)).toBeEnabled();
      await expect(item).toContainText(findTemplateRecord(key)!.description);
    }
  });

  test("the Template the Draft is based on is marked, and the page says what choosing another does", async ({ page }) => {
    await openGallery(page);
    await expect(page.getByTestId("template-current")).toContainText("Your draft is based on Climvia Starter.");
    await expect(page.getByTestId("template-current")).toContainText("After you edit it, it may no longer match that template exactly.");
    await expect(page.getByTestId("template-current")).toContainText("Choosing another template replaces your draft.");
    await expect(page.getByText("Current template")).toHaveCount(1);
    await expect(card(page, "climvia-starter").getByText("Current template")).toBeVisible();
  });

  test("the four cards really look different: each picture is drawn in its own design style and its own accent", async ({ page }) => {
    await openGallery(page);
    const styles = await page.locator("[data-template]").evaluateAll((items) =>
      items.map((item) => {
        const themed = item.querySelector("[data-site-theme]") as HTMLElement;
        return { look: themed.getAttribute("data-site-look"), accent: getComputedStyle(themed).getPropertyValue("--color-primary").trim() };
      }),
    );
    expect(styles.map((entry) => entry.look)).toEqual([null, "precision", "comfort", "airflow"]);
    expect(new Set(styles.map((entry) => entry.accent)).size).toBe(4);
    // The pictures are the real renderer's work: each carries its own opening.
    await expect(card(page, "precision")).toContainText("Clear, scheduled heating and cooling service.");
    await expect(card(page, "comfort")).toContainText("Heating and cooling that keeps your home comfortable.");
    await expect(card(page, "airflow")).toContainText("Heating and cooling service you can count on.");
  });

  test("a picture is only a picture: nothing in it can be clicked, focused or read out, and the cards' own controls are the only tab stops", async ({ page }) => {
    await openGallery(page);
    expect(await page.locator("[data-template] [inert] a, [data-template] [inert] button, [data-template] [inert] input").count()).toBeGreaterThan(0);
    const focusable = await page.locator("[data-template]").first().evaluate((item) => [...item.querySelectorAll("a, button, input, [tabindex]")].filter((element) => !element.closest("[inert]")).map((element) => element.textContent?.trim()));
    expect(focusable).toEqual(["Preview", "Use this template"]);
  });

  test("the pages meet the workspace's structural and contrast standard", async ({ page }) => {
    await openGallery(page);
    await expectAccessible(page);
    await page.goto("/website/templates/comfort");
    await expect(page.getByRole("heading", { level: 1, name: "Comfort" })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe("the preview", () => {
  test("it opens a Template in full, writes nothing, and every page and width can be looked at", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = await stored(db, org, "draft");
    await openGallery(page);
    await card(page, "precision").getByRole("link", { name: "Preview the Precision template" }).click();
    await expect(page).toHaveURL(/\/website\/templates\/precision$/);
    await expect(page.getByRole("heading", { level: 1, name: "Precision" })).toBeVisible();
    await expect(page.getByText("This preview uses a made-up business and services.")).toBeVisible();

    const frame = page.getByTestId("template-frame");
    const widthOf = async () => Math.round((await frame.boundingBox())!.width);
    for (const [mode, label, width] of [["desktop", "Desktop", 1024], ["tablet", "Tablet", 768], ["mobile", "Mobile", 390]] as const) {
      await page.getByRole("group", { name: "Preview size" }).getByRole("button", { name: label }).click();
      await expect(page.getByRole("group", { name: "Preview size" }).getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
      await expect(frame).toHaveAttribute("data-mode", mode);
      expect(await widthOf()).toBe(width);
      for (const pageName of ["Home", "Services", "About", "Contact", "Booking"]) {
        await page.getByRole("group", { name: "Page" }).getByRole("button", { name: pageName, exact: true }).click();
        await expect(page.getByRole("group", { name: "Page" }).getByRole("button", { name: pageName, exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(frame).toHaveAttribute("aria-label", `Precision template, ${pageName} page`);
        // No horizontal overflow at any width.
        const overflow = await frame.evaluate((element) => element.firstElementChild!.scrollWidth - element.firstElementChild!.clientWidth);
        expect(overflow, `${mode} ${pageName}`).toBeLessThanOrEqual(1);
      }
    }
    // Looking at it, in every way, stored nothing: not a revision, not a row.
    expect(await stored(db, org, "draft")).toEqual(before);
  });

  test("it draws the demonstration business, never the business looking at it nor any other: a made-up name, phone and Services, and none of anyone's records", async ({ page }) => {
    await page.goto("/website/templates/airflow");
    // Only the drawn website is looked at: the workspace around it (the switcher, the person) belongs to the signed-in business, as it should.
    const frame = page.getByTestId("template-frame");
    let everything = "";
    for (const pageName of ["Home", "Services", "About", "Contact", "Booking"]) {
      await page.getByRole("group", { name: "Page" }).getByRole("button", { name: pageName, exact: true }).click();
      everything += `${await frame.innerText()}\n${await frame.innerHTML()}\n`;
    }
    expect(everything).toContain("Sample HVAC Company");
    expect(everything).toContain("(555) 010-0100");
    expect(everything).toContain("hello@example.com");
    expect(everything).toContain("AC repair");
    expect(everything).not.toMatch(/Apex|Northstar|Austin|Denver|Alex Morgan|Morgan|Rivera/);
  });

  test("a page of a Template can be opened by its address, and an address that is not a Template is not found", async ({ page, consoleGuard }) => {
    await page.goto("/website/templates/comfort?page=contact");
    await expect(page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Contact", exact: true })).toHaveAttribute("aria-pressed", "true");
    consoleGuard.allow(/404/);
    for (const key of ["nope", "Precision", "../precision", "climvia-starter%2F..", "airflow%20"]) {
      expect((await page.request.get(`/website/templates/${key}`)).status(), key).toBe(404);
    }
    expect((await page.request.get("/website/templates/precision", { headers: { cookie: "" }, maxRedirects: 0 })).status()).toBe(307);
    expect((await page.request.get("/website/templates", { headers: { cookie: "" }, maxRedirects: 0 })).status()).toBe(307);
  });
});

test.describe("using a Template is deliberate", () => {
  test("a click on a card replaces nothing: it asks, says what will and will not change, and cancelling (the button, Escape) leaves everything as it was", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const draft = await stored(db, org, "draft");
    const live = await stored(db, org, "live");
    await openGallery(page);

    const dialog = await chooseTemplate(page, "Precision");
    await expect(dialog).toContainText("Your draft's pages, sections and theme are replaced by Precision.");
    await expect(dialog).toContainText("Your published website does not change.");
    await expect(dialog).toContainText("Earlier published versions are kept.");
    await expect(dialog).toContainText("Your business details, hours and Services stay as they are");
    await expect(dialog.getByRole("button", { name: "Replace draft with Precision" })).toBeVisible();
    // Nothing is stored just because the question is on screen.
    expect(await stored(db, org, "draft")).toEqual(draft);

    await dialog.getByRole("button", { name: "Keep my draft" }).click();
    await expect(dialog).toBeHidden();
    await chooseTemplate(page, "Comfort");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page).toHaveURL(/\/website\/templates$/);

    expect(await stored(db, org, "draft")).toEqual(draft);
    expect(await stored(db, org, "live")).toEqual(live);
  });

  test("closing a preview and going back through the Gallery changes nothing", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const draft = await stored(db, org, "draft");
    await openGallery(page);
    await page.getByRole("link", { name: "Preview the Airflow template" }).click();
    await page.getByRole("link", { name: "All templates" }).click();
    await expect(page).toHaveURL(/\/website\/templates$/);
    await page.getByRole("link", { name: "Back to the Builder" }).click();
    await expect(page).toHaveURL(/\/website\/builder/);
    expect(await stored(db, org, "draft")).toEqual(draft);
  });

  test("the preview offers the same choice, with the same confirmation", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const draft = await stored(db, org, "draft");
    await page.goto("/website/templates/comfort");
    const dialog = await chooseTemplate(page, "Comfort");
    await dialog.getByRole("button", { name: "Keep my draft" }).click();
    expect(await stored(db, org, "draft")).toEqual(draft);
    await applyTemplate(page, "Comfort");
    expect((await stored(db, org, "draft")).templateKey).toBe("comfort");
  });
});

test.describe("applying a Template replaces the Draft only", () => {
  test("Precision: the Draft becomes Precision, the published website is the same to the byte until it is published, and Publish then makes it Precision for visitors", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const draftBefore = await stored(db, org, "draft");
    const liveBefore = await stored(db, org, "live");
    const publicBefore = await publicHtml(page, workerTenant.platformSlug);
    expect(publicBefore).toContain("Heating &amp; cooling service when you need it.");
    expect(publicBefore).not.toContain(HEADLINES.precision);

    await openGallery(page);
    await applyTemplate(page, "Precision");

    // The Draft is Precision: its pages, sections and theme, the Template recorded, the revision moved, the business's Service choices kept.
    const draft = await stored(db, org, "draft");
    expect(draft.templateKey).toBe("precision");
    expect(pageContent(draft)).toEqual(contentOf("precision", draftBefore.settings));
    expect(draft.revision).toBeGreaterThan(draftBefore.revision);
    // The published website is untouched: the same version, the same content, the same page for a visitor.
    expect(await stored(db, org, "live")).toEqual(liveBefore);
    expect(await publicHtml(page, workerTenant.platformSlug)).toBe(publicBefore);

    // It is still there after a reload, and the Builder says what it is based on and that there is something to publish.
    await page.reload();
    await expect(canvas(page)).toContainText(HEADLINES.precision);
    await expect(page.getByTestId("builder-template")).toContainText("Based on: Precision");
    await expect(statusBadge(page)).toHaveText("Draft newer than published");
    expect(await stored(db, org, "draft")).toEqual(draft);

    // Publish moves visitors to Precision; the earlier published version is kept as it was.
    await publishButton(page).click();
    await expect(toasts(page)).toContainText("Website published.");
    const after = await publicHtml(page, workerTenant.platformSlug);
    expect(after).toContain(HEADLINES.precision);
    expect(after).toContain('data-site-look="precision"');
    expect(await stored(db, org, 1)).toEqual(liveBefore);
    expect(pageContent(await stored(db, org, "live"))).toEqual(pageContent(draft));
    expect((await db.query("select count(*)::int as n from site_versions v join sites s on s.id = v.site_id where s.organization_id = $1 and s.slug = 'main' and v.status = 'published'", [org])).rows[0].n).toBe(2);
  });

  for (const [key, name] of [["comfort", "Comfort"], ["airflow", "Airflow"]] as const) {
    test(`${name}: the same, and the Draft stays editable in the Builder afterwards`, async ({ page, db, workerTenant }) => {
      const org = workerTenant.organizationId;
      const draftBefore = await stored(db, org, "draft");
      const liveBefore = await stored(db, org, "live");
      await openGallery(page);
      await applyTemplate(page, name);
      const draft = await stored(db, org, "draft");
      expect(draft.templateKey).toBe(key);
      expect(pageContent(draft)).toEqual(contentOf(key, draftBefore.settings));
      expect(await stored(db, org, "live")).toEqual(liveBefore);
      await expect(canvas(page)).toContainText(HEADLINES[key]);
      await expect(canvas(page).locator(`[data-site-look="${key}"]`).first()).toBeVisible();

      // It is a starting composition, not a locked layout: edit, save, and the Draft is the edit.
      await canvasPick(page, key === "comfort" ? "Welcome" : "Opening").click();
      await headlineField(page).fill("My own headline");
      await saveDraft(page);
      const edited = await stored(db, org, "draft");
      expect(JSON.stringify(edited.pages)).toContain("My own headline");
      expect(edited.templateKey).toBe(key);
      expect(await stored(db, org, "live")).toEqual(liveBefore);
    });
  }

  test("the starter: choosing it again puts the Draft back to the starter's own pages, and a Draft that had been worked on is replaced", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Work in progress");
    await saveDraft(page);
    const worked = await stored(db, org, "draft");
    expect(JSON.stringify(worked.pages)).toContain("Work in progress");
    const liveBefore = await stored(db, org, "live");

    await openGallery(page);
    await applyTemplate(page, "Climvia Starter");
    const draft = await stored(db, org, "draft");
    expect(draft.templateKey).toBe("climvia-starter");
    expect(pageContent(draft)).toEqual({ theme: DEFAULT_TEMPLATE.theme, settings: worked.settings, pages: DEFAULT_TEMPLATE.pages.map((p) => ({ key: p.key, title: p.title, slug: p.slug, type: p.type, visible: p.visible, sections: p.sections })) });
    expect(JSON.stringify(draft.pages)).not.toContain("Work in progress");
    expect(await stored(db, org, "live")).toEqual(liveBefore);
  });

  test("switching: Starter, then Precision, edited and saved, then Comfort: the Draft is Comfort's starting composition, nothing of the other two is left in it, and the published website still has not changed", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const liveBefore = await stored(db, org, "live");
    const publicBefore = await publicHtml(page, workerTenant.platformSlug);
    await openGallery(page);
    await applyTemplate(page, "Precision");
    await canvasPick(page, "Opening").click();
    await headlineField(page).fill("A headline of my own");
    await saveDraft(page);
    expect(JSON.stringify((await stored(db, org, "draft")).pages)).toContain("A headline of my own");

    await page.getByRole("link", { name: "Change template" }).click();
    await expect(page.getByTestId("template-current")).toContainText("Your draft is based on Precision.");
    await expect(card(page, "precision").getByText("Current template")).toBeVisible();
    await applyTemplate(page, "Comfort");

    const draft = await stored(db, org, "draft");
    expect(draft.templateKey).toBe("comfort");
    expect(pageContent(draft)).toEqual(contentOf("comfort", draft.settings));
    const everything = JSON.stringify(draft);
    expect(everything).not.toContain("A headline of my own");
    expect(everything).not.toContain(HEADLINES.precision);
    expect(everything).not.toContain('"look":"precision"');
    expect(await stored(db, org, "live")).toEqual(liveBefore);
    expect(await publicHtml(page, workerTenant.platformSlug)).toBe(publicBefore);
  });
});

test.describe("unsaved work in the Builder", () => {
  test("it is never lost silently: Change template asks first, Keep editing stays with the work, Discard leaves it behind and stores nothing", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const draft = await stored(db, org, "draft");
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Not saved yet");
    await expect(statusBadge(page)).toHaveText("Unsaved changes");

    await page.getByRole("link", { name: "Change template" }).click();
    const guard = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(/\/website\/builder/);
    await expect(headlineField(page)).toHaveValue("Not saved yet");
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    expect(await stored(db, org, "draft")).toEqual(draft);

    // Saving first is the other way through: the work is kept, and then the Gallery opens.
    await saveDraft(page);
    await page.getByRole("link", { name: "Change template" }).click();
    await expect(page).toHaveURL(/\/website\/templates$/);
    const saved = await stored(db, org, "draft");
    expect(JSON.stringify(saved.pages)).toContain("Not saved yet");
    expect(saved.revision).toBeGreaterThan(draft.revision);
  });

  test("Discard leaves the unsaved edit behind and the Gallery opens on the stored Draft", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const draft = await stored(db, org, "draft");
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Thrown away");
    await page.getByRole("link", { name: "Change template" }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(page).toHaveURL(/\/website\/templates$/);
    expect(await stored(db, org, "draft")).toEqual(draft);
  });

  test("after a Template is applied the Builder starts fresh: Undo has nothing to take back, and the Template's own pages are listed", async ({ page }) => {
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Before the switch");
    await saveDraft(page);
    await page.getByRole("link", { name: "Change template" }).click();
    await applyTemplate(page, "Airflow");
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
    await expect(statusBadge(page)).toHaveText("Draft newer than published");
    await expect(page.getByTestId("builder-page-home")).toBeVisible();
  });
});

test.describe("a tab that is behind", () => {
  test("it cannot replace a Draft another tab saved: the request is refused whole, nothing is written, and the newer work is intact", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openGallery(page);

    const other = waitsForHydration(await page.context().newPage());
    await openBuilder(other);
    await canvasPick(other, "Hero").click();
    await headlineField(other).fill("Saved in the other tab");
    await saveDraft(other);
    const newer = await stored(db, org, "draft");
    expect(JSON.stringify(newer.pages)).toContain("Saved in the other tab");

    const dialog = await chooseTemplate(page, "Precision");
    await dialog.getByRole("button", { name: "Replace draft with Precision" }).click();
    await expect(dialog.getByRole("alert")).toContainText(STALE_DRAFT);
    await expect(dialog.getByRole("button", { name: "Reload latest version" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^Replace draft with/ })).toHaveCount(0);

    // Nothing at all changed: the same revision, the same Template, the same pages and sections (so no partial replacement either).
    expect(await stored(db, org, "draft")).toEqual(newer);
    expect((await db.query("select count(*)::int as n from site_sections s join site_versions v on v.id = s.site_version_id join sites st on st.id = v.site_id where st.organization_id = $1 and st.slug = 'main' and v.status = 'draft'", [org])).rows[0].n).toBe(newer.pages.flatMap((entry) => (entry as { sections: unknown[] }).sections).length);
    // Reloading brings the tab up to date, and then the choice works.
    await dialog.getByRole("button", { name: "Reload latest version" }).click();
    await expect(page.getByTestId("template-current")).toBeVisible();
    await applyTemplate(page, "Precision");
    expect((await stored(db, org, "draft")).templateKey).toBe("precision");
  });
});

test.describe("who may use a Template", () => {
  test("a member who may only look can browse the Gallery and every preview, and every control that would replace the Draft is off", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await openGallery(page);
    await expect(page.getByTestId("template-current")).toContainText("Only an owner or admin can change the template.");
    for (const name of ["Climvia Starter", "Precision", "Comfort", "Airflow"]) await expect(useButton(page, name)).toBeDisabled();
    await page.getByRole("link", { name: "Preview the Comfort template" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Comfort" })).toBeVisible();
    await expect(useButton(page, "Comfort")).toBeDisabled();
    await expect(page.getByText("Only an owner or admin can change the template.")).toBeVisible();
    await openBuilder(page);
    await expect(page.getByRole("link", { name: "View templates" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Change template" })).toHaveCount(0);
  });
});

test.describe("a new business", () => {
  test.use({ storageState: NOT_SIGNED_IN });
  test.describe.configure({ timeout: 120_000 });

  test("it starts from the starter with nothing of any other business in it, and can choose Precision, Comfort or Airflow", async ({ page, db }) => {
    const name = `Template Test Heating ${randomBytes(3).toString("hex")}`;
    await signUp(page);
    await completeOnboarding(page, { name });
    const organization = (await db.query<{ id: string }>("select id from organizations where name = $1", [name])).rows[0].id;

    await openBuilder(page);
    await expect(page.getByTestId("builder-template")).toContainText("Based on: Climvia Starter");
    const first = await stored(db, organization, "draft");
    expect(first.templateKey).toBe("climvia-starter");
    expect(JSON.stringify(first)).not.toMatch(/Apex|Northstar|Austin/);

    for (const [key, label] of [["precision", "Precision"], ["comfort", "Comfort"], ["airflow", "Airflow"]] as const) {
      await page.getByRole("link", { name: /Change template/ }).click();
      await expect(page.getByTestId("template-current")).toBeVisible();
      await applyTemplate(page, label);
      const draft = await stored(db, organization, "draft");
      expect(draft.templateKey, key).toBe(key);
      expect(pageContent(draft), key).toEqual(contentOf(key, first.settings));
      expect(JSON.stringify(draft), key).not.toMatch(/Apex|Northstar|Austin/);
      await expect(page.getByTestId("builder-template")).toContainText(`Based on: ${label}`);
    }
    // A new business has no published website, so nothing was ever public: the Gallery said so.
    await page.getByRole("link", { name: "Change template" }).click();
    await expect((await chooseTemplate(page, "Precision")).getByText("Your website is not published, so nothing changes for visitors.")).toBeVisible();
  });
});

test.describe("what reaches a browser", () => {
  test("a public page's scripts and markup carry no Template definition and no demonstration data; the Gallery carries the Templates and nothing of another business", async ({ page, workerTenant }) => {
    const chunkUrls = (html: string) => [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s<>]+\.js/g)].map((match) => match[0]))];
    const markup = await publicHtml(page, workerTenant.platformSlug, "/services");
    expect(chunkUrls(markup).length).toBeGreaterThan(0);
    const scripts = (await Promise.all(chunkUrls(markup).map(async (url) => (await page.request.get(url)).text()))).join("\n");

    // The Templates' words live in the database and on the server; the demonstration business only in the Gallery's own code. A visitor's
    // page loads neither, in its scripts or in what it is sent.
    const wording = [
      HEADLINES.precision,
      HEADLINES.comfort,
      HEADLINES.airflow,
      "Heating & cooling service when you need it.",
      "Book maintenance, repairs and seasonal tune-ups",
      "Seasonal maintenance",
      "Sample HVAC Company",
      "(555) 010-0100",
      "hello@example.com",
    ];
    for (const text of wording) {
      expect(scripts, `scripts: ${text}`).not.toContain(text);
      expect(markup, `markup: ${text}`).not.toContain(text);
    }

    // The Gallery is sent the application's Templates, and no other business's records.
    const gallery = await (await page.request.get("/website/templates")).text();
    for (const headline of [HEADLINES.precision, HEADLINES.comfort, HEADLINES.airflow]) expect(gallery, headline).toContain(headline);
    expect(gallery).not.toMatch(/Northstar/i);
  });
});
