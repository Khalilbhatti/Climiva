/**
 * Structural accessibility checks that run against the rendered page: things a script can decide for certain
 * (names that exist, ids that resolve, headings that do not skip, links that go somewhere). Judgement calls, such
 * as whether a label reads well, stay with the tests that look at specific screens.
 */
import type { Page } from "playwright/test";

const NAMED_ROLES = "button|link|textbox|searchbox|combobox|checkbox|radio|switch|tab|menuitem|spinbutton|slider|img";
const NAMELESS = new RegExp(`^- (${NAMED_ROLES})((?: \\[[^\\]]*\\])*)(?::.*)?$`);

/** Controls the browser's own accessible-name computation leaves without a name. */
export async function unnamedControls(page: Page): Promise<string[]> {
  const snapshot = await page.locator("body").ariaSnapshot();
  return snapshot
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => NAMELESS.test(line));
}

export async function structuralIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    const visible = (element: Element) => element.checkVisibility({ opacityProperty: false, visibilityProperty: true }) && !element.closest("[inert]");

    // Ids are unique, and every id a label, description or relationship points at exists.
    const seen = new Map<string, number>();
    for (const element of document.querySelectorAll("[id]")) seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
    for (const [id, count] of seen) if (count > 1) issues.push(`duplicate id "${id}" ×${count}`);
    for (const attribute of ["aria-labelledby", "aria-describedby", "aria-errormessage", "aria-owns", "aria-activedescendant"]) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        for (const id of (element.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) issues.push(`${attribute}="${id}" on <${element.tagName.toLowerCase()}> points at nothing`);
        }
      }
    }

    // Headings: the first is the page's h1, and none skips a level on the way down.
    const root = document.querySelector("main") ?? document.body;
    const headings = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(visible);
    let previous = 0;
    for (const heading of headings) {
      const level = Number(heading.tagName[1]);
      if (previous === 0 && level !== 1) issues.push(`first heading is <h${level}> "${heading.textContent?.trim().slice(0, 30)}", not h1`);
      if (previous !== 0 && level > previous + 1) issues.push(`heading jumps h${previous} → h${level} at "${heading.textContent?.trim().slice(0, 30)}"`);
      previous = level;
    }

    // Links go somewhere real.
    for (const link of document.querySelectorAll("a")) {
      const href = link.getAttribute("href");
      if (href === null || href === "" || href === "#" || href.startsWith("javascript:")) {
        issues.push(`link "${link.textContent?.trim().slice(0, 30)}" has href=${JSON.stringify(href)}`);
      }
    }

    // Pictures say what they are, or say nothing.
    for (const image of document.querySelectorAll("img")) if (!image.hasAttribute("alt")) issues.push(`<img src=${image.getAttribute("src")?.slice(0, 40)}> has no alt`);
    for (const image of document.querySelectorAll("[role='img']")) {
      if (!image.getAttribute("aria-label") && !image.getAttribute("aria-labelledby")) issues.push(`role=img without a label: ${image.className.toString().slice(0, 40)}`);
    }

    // Anything made interactive from a non-interactive element can be reached and operated from the keyboard.
    for (const element of document.querySelectorAll("[role='button'], [role='link'], [role='tab'], [role='switch'], [role='checkbox']")) {
      if (!visible(element)) continue;
      const tag = element.tagName.toLowerCase();
      const native = ["button", "a", "input"].includes(tag);
      if (!native && !element.hasAttribute("tabindex")) issues.push(`<${tag} role=${element.getAttribute("role")}> cannot take focus`);
    }

    // A form control with an error says so, and says what the error is.
    for (const field of document.querySelectorAll("[aria-invalid='true']")) {
      const described = (field.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join("");
      if (described.length === 0) issues.push(`invalid field ${field.getAttribute("name") ?? field.id} has no described error`);
    }

    // Colour is never the only carrier of a status: a painted status box has text or a name.
    for (const swatch of document.querySelectorAll("[class*='bg-positive'], [class*='bg-warning'], [class*='bg-danger']")) {
      if (!visible(swatch) || swatch.closest("[aria-hidden='true']")) continue;
      const box = swatch.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const hasText = (swatch.textContent ?? "").trim().length > 0 || swatch.querySelector(".sr-only");
      const named = swatch.getAttribute("aria-label") || swatch.getAttribute("title") || swatch.getAttribute("role");
      if (!hasText && !named && swatch.childElementCount === 0) issues.push(`status colour without text: <${swatch.tagName.toLowerCase()} class="${swatch.getAttribute("class")?.slice(0, 50)}">`);
    }
    return issues;
  });
}
