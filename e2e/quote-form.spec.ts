/**
 * Phase 19G: what a person types into the Create quote form, read as money (src/lib/quote-form.ts). Pure functions: the form shows exactly these numbers, and the
 * server (financial-rules.spec.ts) reads the same lines again and refuses a total that is not theirs.
 */
import { expect, test } from "playwright/test";
import { MAX_QUOTE_LINES } from "../src/lib/financial-rules";
import { BLANK_LINE, checkLines, lineForRequest, parseQuantityText } from "../src/lib/quote-form";

const row = (description: string, quantity: string, price: string) => ({ description, quantity, price });

test.describe("a quantity", () => {
  test("is a number above zero with at most two decimals", () => {
    expect(parseQuantityText("1")).toBe(1);
    expect(parseQuantityText(" 2.5 ")).toBe(2.5);
    expect(parseQuantityText("0.25")).toBe(0.25);
    expect(parseQuantityText("99999.99")).toBe(99999.99);
    for (const bad of ["", "0", "0.00", "-1", "1.005", "1,5", "1e2", "abc", "100000", "1.", ".5", "1 2"]) expect(parseQuantityText(bad), JSON.stringify(bad)).toBeUndefined();
  });
});

test.describe("the lines of a quote", () => {
  test("add up in whole cents: each line is its quantity times its price, half a cent up", () => {
    const checked = checkLines([row("Diagnostic visit", "1", "89.50"), row("Capacitor", "1.5", "33.33"), row("Refrigerant", "3", "12.10")]);
    expect(checked.invalid).toBe(false);
    expect(checked.lines.map((line) => line.totalCents)).toEqual([8950, 5000, 3630]);
    expect(checked.totalCents).toBe(17580);
    expect(checked.lines.map(lineForRequest)).toEqual([
      { description: "Diagnostic visit", quantity: 1, rate: 89.5 },
      { description: "Capacitor", quantity: 1.5, rate: 33.33 },
      { description: "Refrigerant", quantity: 3, rate: 12.1 },
    ]);
  });

  test("ten cents and twenty cents are thirty cents; a price may be typed with a dollar sign or a comma", () => {
    expect(checkLines([row("a", "1", "0.10"), row("b", "1", "0.20")]).totalCents).toBe(30);
    expect(checkLines([row("a", "1", "$1,234.56")]).totalCents).toBe(123456);
    expect(checkLines([row("a", "1", "0")]).totalCents).toBe(0);
  });

  test("a row left alone is ignored; one with something in it must be whole", () => {
    expect(checkLines([row("", BLANK_LINE.quantity, ""), row("Visit", "1", "100")])).toMatchObject({ invalid: false, empty: false, totalCents: 10000 });
    expect(checkLines([{ ...BLANK_LINE }])).toMatchObject({ invalid: true, empty: true, totalCents: 0 });
    const partial = checkLines([row("Visit", "1", "")]);
    expect(partial.invalid).toBe(true);
    expect(partial.problems[0]).toEqual({ price: "Enter a price, such as 89 or 89.50." });
    expect(checkLines([row("", "2", "10")]).problems[0]).toEqual({ description: "Describe the work or the part." });
    expect(checkLines([row("Visit", "0", "10")]).problems[0]).toEqual({ quantity: "Enter a number above zero, such as 1 or 1.5." });
  });

  test("a price is money: no negative, no third decimal, nothing else", () => {
    for (const bad of ["-5", "10.005", "abc", "1e3", "1.2.3", "$", "12 34"]) {
      const checked = checkLines([row("Visit", "1", bad)]);
      expect(checked.invalid, bad).toBe(true);
      expect(checked.problems[0].price, bad).toBeTruthy();
    }
  });

  test("too big for a line, or for a quote, is said; there are at most fifty lines", () => {
    expect(checkLines([row("Everything", "99999.99", "99999999")]).problems[0].price).toBe("That comes to more than one line can hold.");
    const heavy = checkLines(Array.from({ length: 3 }, () => row("Plant", "1", "9000000")));
    expect(heavy).toMatchObject({ tooLarge: true, invalid: true });
    expect(checkLines([row("Plant", "1", "10000000")])).toMatchObject({ tooLarge: false, invalid: false });
    const many = checkLines(Array.from({ length: MAX_QUOTE_LINES + 1 }, (_, index) => row(`Line ${index}`, "1", "1")));
    expect(many.invalid).toBe(true);
    expect(many.problems[MAX_QUOTE_LINES].description).toContain("up to 50 lines");
  });
});
