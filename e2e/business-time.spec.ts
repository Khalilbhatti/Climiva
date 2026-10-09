/**
 * Phase 11: the one place a wall-clock time and an instant are converted (src/lib/business-time.ts). An appointment is a
 * local date and time that is never converted; only the system's own events (received, confirmed, completed) are instants,
 * and they are turned back into the business's local time on the server. Pure functions, so these need no browser.
 */
import { expect, test } from "playwright/test";
import { businessClock, instantToLocal, localToInstant, stampInstant } from "../src/lib/business-time";

const CHICAGO = "America/Chicago";
const DENVER = "America/Denver";

test.describe("an instant read in a business's zone", () => {
  test("the same instant is a different local time in each zone, and always the same in the same zone", () => {
    const instant = new Date("2024-10-25T15:45:00Z");
    expect(instantToLocal(instant, CHICAGO)).toBe("2024-10-25T10:45");
    expect(instantToLocal(instant, DENVER)).toBe("2024-10-25T09:45");
    expect(instantToLocal(instant, "Pacific/Auckland")).toBe("2024-10-26T04:45");
    expect(instantToLocal(instant, "UTC")).toBe("2024-10-25T15:45");
  });

  test("midnight is 00:00, never 24:00, and the date rolls with the zone", () => {
    expect(instantToLocal(new Date("2024-10-26T05:00:00Z"), CHICAGO)).toBe("2024-10-26T00:00");
    expect(instantToLocal(new Date("2024-10-26T04:59:00Z"), CHICAGO)).toBe("2024-10-25T23:59");
  });

  test("daylight saving: Chicago is UTC-5 until November 3, 2024 and UTC-6 after", () => {
    expect(instantToLocal(new Date("2024-11-03T06:30:00Z"), CHICAGO)).toBe("2024-11-03T01:30"); // still CDT
    expect(instantToLocal(new Date("2024-11-03T07:30:00Z"), CHICAGO)).toBe("2024-11-03T01:30"); // the repeated hour, now CST
    expect(instantToLocal(new Date("2024-11-03T08:30:00Z"), CHICAGO)).toBe("2024-11-03T02:30");
  });
});

test.describe("a local time read as an instant", () => {
  test("is the instant it is in that zone, and reads back as itself", () => {
    for (const [local, zone] of [
      ["2024-10-25T10:45", CHICAGO],
      ["2024-12-25T08:00", CHICAGO],
      ["2024-07-04T23:59", DENVER],
      ["2024-01-01T00:00", "Pacific/Auckland"],
    ] as const) {
      expect(instantToLocal(localToInstant(local, zone), zone), `${local} in ${zone}`).toBe(local);
    }
    expect(localToInstant("2024-10-25T10:45", CHICAGO).toISOString()).toBe("2024-10-25T15:45:00.000Z");
    expect(localToInstant("2024-12-25T08:00", CHICAGO).toISOString()).toBe("2024-12-25T14:00:00.000Z");
  });

  test("spring forward: a time that does not exist is read as the same wall-clock after the gap", () => {
    // 02:30 on March 10, 2024 never happened in Chicago (the clocks went from 02:00 to 03:00).
    const instant = localToInstant("2024-03-10T02:30", CHICAGO);
    expect(instantToLocal(instant, CHICAGO)).toBe("2024-03-10T03:30");
    expect(instant.toISOString()).toBe("2024-03-10T08:30:00.000Z");
  });

  test("fall back: a time that happens twice is read as its first occurrence", () => {
    const instant = localToInstant("2024-11-03T01:30", CHICAGO);
    expect(instant.toISOString()).toBe("2024-11-03T06:30:00.000Z"); // CDT, the first 01:30
    expect(instantToLocal(instant, CHICAGO)).toBe("2024-11-03T01:30");
  });

  test("the day before and after a change of offset are unaffected", () => {
    expect(localToInstant("2024-03-09T02:30", CHICAGO).toISOString()).toBe("2024-03-09T08:30:00.000Z");
    expect(localToInstant("2024-03-11T02:30", CHICAGO).toISOString()).toBe("2024-03-11T07:30:00.000Z");
  });

  test("something that is not a local date and time is refused, not guessed", () => {
    for (const bad of ["", "2024-10-25", "10:45", "next tuesday"]) expect(() => localToInstant(bad, CHICAGO), bad).toThrow();
  });
});

test.describe("the clock of a business", () => {
  const FIXED = "2024-10-25T10:45";

  test("the sample business lives at the product's fixed moment, whatever the real time is", () => {
    expect(businessClock(true, CHICAGO, FIXED, new Date("2031-06-01T00:00:00Z"))).toEqual({ today: "2024-10-25", now: FIXED });
    expect(businessClock(true, "Pacific/Auckland", FIXED, new Date("2000-01-01T00:00:00Z"))).toEqual({ today: "2024-10-25", now: FIXED });
  });

  test("every other business lives at the real time, read in its own zone", () => {
    const at = new Date("2026-10-09T03:30:00Z");
    expect(businessClock(false, DENVER, FIXED, at)).toEqual({ today: "2026-10-08", now: "2026-10-08T21:30" });
    expect(businessClock(false, "Pacific/Auckland", FIXED, at)).toEqual({ today: "2026-10-09", now: "2026-10-09T16:30" });
    expect(businessClock(false, CHICAGO, FIXED, at).today).toBe("2026-10-08");
  });

  test("a system event is stamped on the same clock: the fixed moment for the sample business, the real instant otherwise", () => {
    expect(stampInstant(true, CHICAGO, FIXED, new Date("2031-06-01T00:00:00Z")).toISOString()).toBe("2024-10-25T15:45:00.000Z");
    const real = new Date("2026-10-09T03:30:00Z");
    expect(stampInstant(false, DENVER, FIXED, real)).toBe(real);
  });
});
