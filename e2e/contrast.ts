/**
 * A contrast audit that runs in the browser against what is actually painted: every element that owns text, its
 * colour against the colour behind it (every translucent layer composited), at the WCAG AA thresholds. Disabled
 * controls, hidden content and text over a gradient or picture are left out (WCAG exempts the first; the others have
 * no single background to measure).
 */
import type { Page } from "playwright/test";

export type LowContrast = { text: string; element: string; ratio: number; need: number; color: string; background: string };

export async function findLowContrast(page: Page): Promise<LowContrast[]> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    type Rgba = [number, number, number, number];
    const parse = (css: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000000";
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2], data[3] / 255];
    };
    const over = (top: Rgba, below: Rgba): Rgba => {
      const alpha = top[3] + below[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      const mix = (index: number) => (top[index] * top[3] + below[index] * below[3] * (1 - top[3])) / alpha;
      return [mix(0), mix(1), mix(2), alpha];
    };
    const luminance = ([r, g, b]: Rgba) => {
      const channel = (value: number) => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (a: Rgba, b: Rgba) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    /** The colour behind an element, or undefined when a gradient or picture sits behind it. */
    const backdrop = (element: Element): Rgba | undefined => {
      const layers: Rgba[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage !== "none") return undefined;
        const colour = parse(style.backgroundColor);
        if (colour[3] > 0) layers.push(colour);
        if (colour[3] === 1) break;
      }
      let result: Rgba = parse(getComputedStyle(document.body).backgroundColor);
      if (result[3] === 0) result = [255, 255, 255, 1];
      for (const layer of layers.reverse()) result = over(layer, result);
      return result;
    };
    const opacityOf = (element: Element) => {
      let value = 1;
      for (let node: Element | null = element; node; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
      return value;
    };

    const found: LowContrast[] = [];
    for (const element of document.querySelectorAll("body *")) {
      const own = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0);
      if (own.length === 0) continue;
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (element.closest("[aria-hidden='true'], [inert], svg, script, style, :disabled, [aria-disabled='true']")) continue;
      // An option card whose control is disabled is dimmed as a whole; inactive controls are exempt.
      if ((element.closest("label") as HTMLLabelElement | null)?.control?.matches(":disabled")) continue;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      if (style.clip !== "auto" && style.position === "absolute" && box.width <= 1) continue;
      const below = backdrop(element);
      if (!below) continue;
      let colour = parse(style.color);
      colour[3] *= opacityOf(element);
      colour = over(colour, below);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const measured = ratio(colour, below);
      if (measured + 0.005 < need) {
        found.push({
          text: own.map((node) => node.textContent?.trim()).join(" ").slice(0, 50),
          element: `${element.tagName.toLowerCase()}.${String(element.getAttribute("class") ?? "").slice(0, 60)}`,
          ratio: Math.round(measured * 100) / 100,
          need,
          color: style.color,
          background: `rgb(${below.slice(0, 3).map(Math.round).join(",")})`,
        });
      }
    }
    return found;
  });
}
