/**
 * What a person types into the Create quote form, read the way the server will read it: money as text into whole cents, a quantity as text into
 * a number of hundredths, and a line's price worked out in integers (lib/money). Nothing here multiplies dollars; the total shown on the Review step
 * is the sum of these whole-cent line prices, and the server adds the same lines up again and refuses a request that disagrees.
 *
 * Pure functions, no environment: the form and the specs share them.
 */
import { MAX_LINE_CENTS, MAX_QUOTE_CENTS, MAX_QUOTE_LINES } from "./financial-rules";
import { fromCents, lineCents, parseCents, sumCents } from "./money";

/** One row of the form, exactly as typed. */
export type QuoteLineDraft = { description: string; quantity: string; price: string };

export const BLANK_LINE: QuoteLineDraft = { description: "", quantity: "1", price: "" };

/** "1", "2.5" or "0.25": above zero, at most two decimals, at most 99,999.99. Anything else is not a quantity. */
export function parseQuantityText(text: string): number | undefined {
  const match = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return undefined;
  const hundredths = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return hundredths > 0 ? hundredths / 100 : undefined;
}

/** What is wrong with a row, in the words the form shows beside the field. */
export type LineProblems = { description?: string; quantity?: string; price?: string };

export type CheckedLine = {
  description: string;
  quantity: number;
  /** Whole cents. */
  unitPriceCents: number;
  /** quantity x price, whole cents, half up. */
  totalCents: number;
};

export type CheckedLines = {
  /** The rows that count (a row left completely empty is ignored), in order. */
  lines: CheckedLine[];
  /** One entry per row of the form; only the rows with something wrong have keys. */
  problems: LineProblems[];
  /** Something is wrong, or there are no lines at all. */
  invalid: boolean;
  /** Set when no row has any content: the form asks for at least one line. */
  empty: boolean;
  /** The counted lines add up to more than one quote can hold. */
  tooLarge: boolean;
  totalCents: number;
};

const isBlank = (line: QuoteLineDraft) => line.description.trim() === "" && line.price.trim() === "" && (line.quantity.trim() === "" || line.quantity.trim() === BLANK_LINE.quantity);

/** Read every row: the lines that count, what is wrong with the others, and what the counted lines add up to. */
export function checkLines(rows: readonly QuoteLineDraft[]): CheckedLines {
  const problems: LineProblems[] = rows.map(() => ({}));
  const lines: CheckedLine[] = [];
  rows.forEach((row, index) => {
    if (isBlank(row)) return;
    const mine = problems[index];
    const description = row.description.trim();
    if (!description) mine.description = "Describe the work or the part.";
    else if (description.length > 200) mine.description = "Keep this to 200 characters or fewer.";
    const quantity = parseQuantityText(row.quantity);
    if (quantity === undefined) mine.quantity = "Enter a number above zero, such as 1 or 1.5.";
    const unitPriceCents = parseCents(row.price);
    if (unitPriceCents === undefined) mine.price = "Enter a price, such as 89 or 89.50.";
    if (quantity !== undefined && unitPriceCents !== undefined && lineCents(quantity, unitPriceCents) > MAX_LINE_CENTS) mine.price = "That comes to more than one line can hold.";
    if (!mine.description && !mine.quantity && !mine.price && quantity !== undefined && unitPriceCents !== undefined) lines.push({ description, quantity, unitPriceCents, totalCents: lineCents(quantity, unitPriceCents) });
  });
  const empty = rows.every(isBlank);
  if (rows.length > MAX_QUOTE_LINES) problems[MAX_QUOTE_LINES] = { description: `A quote can have up to ${MAX_QUOTE_LINES} lines.` };
  const totalCents = sumCents(lines.map((line) => line.totalCents));
  const tooLarge = totalCents > MAX_QUOTE_CENTS;
  const invalid = empty || tooLarge || problems.some((entry) => Object.keys(entry).length > 0);
  return { lines, problems, invalid, empty, tooLarge, totalCents };
}

/** What the server is sent for one counted line: dollars with at most two decimals, never arithmetic on dollars. */
export const lineForRequest = (line: CheckedLine) => ({ description: line.description, quantity: line.quantity, rate: fromCents(line.unitPriceCents) });
