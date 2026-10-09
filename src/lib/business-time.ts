/**
 * Business time: the one place a wall-clock time and an instant are converted, on the SERVER, with the organization's
 * IANA time zone.
 *
 * What is stored. An appointment (a Booking or Job) is a local date and a local start and end time, read in the
 * organization's time zone; it is never converted, so it cannot move when the server's, the browser's or the tz database's
 * rules change. Only events of the system (received, confirmed, completed) are instants (timestamptz). Those are turned
 * back into the organization's local "YYYY-MM-DDTHH:mm" here, before anything reaches a browser, so the browser never parses
 * a date: lib/dates formats the strings by hand and the whole app agrees in every browser time zone.
 *
 * Daylight saving. Converting a wall-clock time to an instant is only ambiguous twice a year. A time that does not exist
 * (spring forward, 02:30 on 2024-03-10 in Chicago) is read as the same wall-clock after the gap (03:30 CDT), and a time that
 * happens twice (fall back, 01:30 on 2024-11-03) is read as its first occurrence (CDT). Business hours never include those
 * hours in practice; the rule only has to be deterministic.
 */

export type BusinessClock = {
  /** "2024-10-25": today in the business's time zone. */
  today: string;
  /** "2024-10-25T10:45": now in the business's time zone. */
  now: string;
};

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = formatters.get(timeZone);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, existing);
  }
  return existing;
}

function partsIn(instant: Date, timeZone: string): Parts {
  const found: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  return { year: found.year, month: found.month, day: found.day, hour: found.hour, minute: found.minute, second: found.second };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** How far the zone's wall clock is ahead of UTC at this instant, in milliseconds. */
function offsetAt(milliseconds: number, timeZone: string): number {
  const p = partsIn(new Date(milliseconds), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(milliseconds / 1000) * 1000;
}

/** An instant as the business's local "YYYY-MM-DDTHH:mm". */
export function instantToLocal(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** A business-local "YYYY-MM-DDTHH:mm" as the instant it is in that time zone. */
export function localToInstant(local: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) throw new Error(`Not a local date and time: "${local}"`);
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Read the wall clock as if it were UTC, then correct it by the zone's offset at the answer, twice, so a time near a
  // change of offset settles on the right side of it.
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  // If the answer does not read back as the same wall clock, that time was skipped by a change of offset: take the
  // instant that is the same wall-clock reading after the gap.
  return new Date(instantToLocal(new Date(second), timeZone) === local.slice(0, 16) ? second : first);
}

/**
 * The clock of one business. The sample business lives at the product's fixed moment (its records are dated around it, and
 * "today" has to stay on them); every other business lives at the real time. `fixedNow` is that fixed moment, local.
 */
export function businessClock(sample: boolean, timeZone: string, fixedNow: string, at: Date = new Date()): BusinessClock {
  const now = sample ? fixedNow : instantToLocal(at, timeZone);
  return { today: now.slice(0, 10), now };
}

/** What a system event happening now (received, confirmed, completed) is stamped with, on that same clock. */
export function stampInstant(sample: boolean, timeZone: string, fixedNow: string, at: Date = new Date()): Date {
  return sample ? localToInstant(fixedNow, timeZone) : at;
}
