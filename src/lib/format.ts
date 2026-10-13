import { formatClockParts, formatDateParts, formatMonthDayParts } from "./display-preferences";

const usd = (fractionDigits: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

/** formatUSD(6240) → "$6,240"; formatUSD(285, 2) → "$285.00" */
export function formatUSD(amount: number, fractionDigits = 0): string {
  return usd(fractionDigits).format(amount);
}

// Fixture timestamps are wall-clock times stored as UTC ("2024-10-25T13:30:00Z") and formatted in
// UTC, so server and client render identically regardless of the viewer's timezone.
// Formatted by hand rather than Intl: ICU versions differ between Node and browsers (for example
// a narrow no-break space before "PM"), which would cause hydration mismatches. The date and time style
// (Settings → Workspace preferences) comes from lib/display-preferences.
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseUtc(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
}

/** formatDate("2024-10-25") → "Oct 25, 2024" (or "10/25/2024", "25/10/2024", "2024-10-25" per the saved preference) */
export function formatDate(iso: string): string {
  const date = parseUtc(iso);
  return formatDateParts(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** formatDateTime("2024-10-25T13:30:00Z") → "Oct 25, 1:30 PM" (or "13:30" in 24-hour time) */
export function formatDateTime(iso: string): string {
  const date = parseUtc(iso);
  return `${formatMonthDayParts(date.getUTCMonth(), date.getUTCDate())}, ${formatClockParts(date.getUTCHours(), date.getUTCMinutes())}`;
}

/** formatMonthYear("2016-05") → "May 2016" */
export function formatMonthYear(yearMonth: string): string {
  const date = parseUtc(`${yearMonth}-01`);
  return `${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** getInitials("Alex Morgan") → "AM" */
export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/** formatCityStateZip({ city: "Austin", state: "TX", postalCode: "78741" }) → "Austin, TX 78741" */
export function formatCityStateZip(address: { city: string; state: string; postalCode: string }): string {
  return `${address.city}, ${address.state} ${address.postalCode}`;
}

/** toTelHref("(555) 010-0100") → "tel:5550100100" */
export function toTelHref(phone: string): string {
  return `tel:${phone.replace(/\D/g, "")}`;
}
