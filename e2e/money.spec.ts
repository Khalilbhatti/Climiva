/**
 * Money is whole cents. These pin the helpers every financial total, balance and line price goes through, so a rounding
 * surprise (0.1 + 0.2, 1.005, a half cent) cannot reach an invoice. Pure functions: no browser, no database.
 */
import { expect, test } from "playwright/test";
import { addMoney, amountToCents, fromCents, lineCents, parseCents, subtractMoney, sumCents, toCents, toHundredths } from "../src/lib/money";

test.describe("dollars and cents", () => {
  test("every amount from $0.00 to $2,000.00 survives the trip to cents and back exactly", () => {
    // One assertion for all 200,001 amounts: an expect() per amount costs about a millisecond each and would take minutes.
    const drifted: number[] = [];
    for (let cents = 0; cents <= 200_000; cents += 1) if (toCents(fromCents(cents)) !== cents) drifted.push(cents);
    expect(drifted).toEqual([]);
  });

  test("the classic float traps add up exactly", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the problem
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(...Array.from({ length: 1000 }, () => 0.1))).toBe(100);
    expect(subtractMoney(0.3, 0.1)).toBe(0.2);
    expect(subtractMoney(285, 285)).toBe(0);
    expect(addMoney(89.5, 195, 0.5)).toBe(285);
    expect(addMoney()).toBe(0);
    expect(sumCents([8950, 19500, 50])).toBe(28500);
  });

  test("a balance is the total less what was received, to the cent", () => {
    expect(subtractMoney(500, addMoney(200, 100.1, 199.9))).toBe(0);
    expect(subtractMoney(1234.56, 0.01)).toBe(1234.55);
  });
});

test.describe("a line's price", () => {
  test("quantity times unit price in whole cents, half up", () => {
    expect(lineCents(1, 8950)).toBe(8950);
    expect(lineCents(1.5, 13000)).toBe(19500);
    expect(lineCents(0.5, 1)).toBe(1); // half a cent rounds up
    expect(lineCents(0.5, 3)).toBe(2); // 1.5 cents
    expect(lineCents(2.5, 333)).toBe(833); // 832.5
    expect(lineCents(0.01, 99)).toBe(1); // 0.99
    expect(lineCents(1.15, 100)).toBe(115);
    expect(lineCents(33.33, 3)).toBe(100); // 99.99
    expect(lineCents(1, 0)).toBe(0);
  });

  test("a quantity is held as whole hundredths, never as a float product", () => {
    expect(toHundredths(1.15)).toBe(115);
    expect(toHundredths(0.29)).toBe(29);
    expect(toHundredths(1.5)).toBe(150);
    // 0.29 * 100 is 28.999999999999996 in floating point: the helper must not floor it.
    expect(0.29 * 100).not.toBe(29);
  });

  test("the three lines of QT-884 add up to $285.00", () => {
    expect(sumCents([lineCents(1, 8950), lineCents(1.5, 13000), lineCents(1, 50)])).toBe(28500);
  });
});

test.describe("what a person types", () => {
  test("decimal text is read digit by digit", () => {
    expect(parseCents("300")).toBe(30000);
    expect(parseCents("300.5")).toBe(30050);
    expect(parseCents("300.05")).toBe(30005);
    expect(parseCents("0.01")).toBe(1);
    expect(parseCents("$1,234.56")).toBe(123456);
    expect(parseCents("  42 ")).toBe(4200);
    expect(parseCents("0")).toBe(0);
  });

  test("anything that is not an amount of dollars and cents is refused", () => {
    for (const text of ["", " ", "abc", "-5", "1.234", "1e3", ".5", "12.", "1,2,3.456", "12 34", "NaN", "Infinity", "1234567890", "$", "5%"]) {
      expect(parseCents(text), JSON.stringify(text)).toBeUndefined();
    }
  });

  test("amountToCents takes text or a two-decimal number, and nothing else", () => {
    expect(amountToCents("300")).toBe(30000);
    expect(amountToCents(300)).toBe(30000);
    expect(amountToCents(300.01)).toBe(30001);
    expect(amountToCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 is the number a sum of two amounts leaves
    expect(amountToCents(0)).toBe(0);
    for (const value of [19.999, 0.005, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e12, null, undefined, {}, [], true]) {
      expect(amountToCents(value), String(value)).toBeUndefined();
    }
  });
});
