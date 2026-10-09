/**
 * Money, exactly.
 *
 * What is stored. Every amount in PostgreSQL is an INTEGER NUMBER OF CENTS (`unit_price_cents`, `line_total_cents`,
 * `amount_cents`, `previously_paid_cents`): $89.50 is 8950. There are no floating-point or `money` columns, so nothing is ever
 * rounded on the way in or out, and a sum of columns is an integer sum. A quantity (1.5 hours) is a `numeric(10,2)`, and a line
 * total is `round(quantity * unit_price_cents)`, half up, which a CHECK constraint repeats so a row cannot carry another total.
 *
 * What the screens hold. The screens show and receive dollars as a plain number with at most two decimals (89.5), because that
 * is what a person reads and types. Such a number is only ever a DISPLAY value derived from cents: no arithmetic is done on it.
 * Every sum, difference and product goes through these helpers, which turn the values into integer cents first, calculate in
 * integers (all well inside Number.MAX_SAFE_INTEGER), and only then turn the answer back. What a person types is never parsed
 * with floating point either: `parseCents` reads the decimal text digit by digit.
 *
 * Pure functions, no environment: the server, the browser and the specs share them.
 */

/** Dollars (with at most two decimals) to whole cents. */
export function toCents(dollars: number): number {
  // Dollars here are always a number of cents divided by 100, so the product sits within a float's rounding of a whole number.
  return Math.round(dollars * 100);
}

/** Whole cents to dollars (at most two decimals). */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** A quantity as a whole number of hundredths (1.5 hours is 150). */
export const toHundredths = (quantity: number): number => Math.round(quantity * 100);

/** The price of a line: quantity x unit price, in whole cents, half up. All integer arithmetic. */
export function lineCents(quantity: number, unitPriceCents: number): number {
  return Math.floor((toHundredths(quantity) * unitPriceCents + 50) / 100);
}

/** The sum of whole-cent amounts. */
export const sumCents = (amounts: readonly number[]): number => amounts.reduce((total, amount) => total + amount, 0);

/** Add dollar amounts exactly. */
export const addMoney = (...amounts: readonly number[]): number => fromCents(sumCents(amounts.map(toCents)));

/** `a - b` in dollars, exactly. */
export const subtractMoney = (a: number, b: number): number => fromCents(toCents(a) - toCents(b));

/** The money amount a person typed ("300", "300.5", "$1,234.56") in whole cents, or undefined when it is not an amount. */
export function parseCents(text: string): number | undefined {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** A value from a form or a request (text or number) as whole cents: exact for text, and only two-decimal numbers for a number. */
export function amountToCents(value: unknown): number | undefined {
  if (typeof value === "string") return parseCents(value);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 99_999_999) return undefined;
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) < 1e-6 ? cents : undefined;
}
