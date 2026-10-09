/**
 * Settings: the baseline is the canonical Business and User records (no second dataset), the rules are pure functions,
 * and the saved date and time style is read by the formatters. Nothing here needs a browser.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { BUSINESS_TIME_ZONE, business, businessHoursByWeekday, currentUser } from "../src/data/fixtures";
import {
  ACCENT_SWATCHES,
  DATE_FORMATS,
  DEFAULT_ACCENT,
  HOUR_OPTIONS,
  TIME_ZONES,
  WEEK_ORDER,
  dateFormatExample,
  getTimeZone,
  initialSettings,
} from "../src/data/settings";
import { WEEK_ORDER as TEAM_WEEK_ORDER } from "../src/data/team";
import { getSlotGroup } from "../src/lib/booking-slots";
import { formatLongDate, formatMonthDay, formatTime, formatTimeRange, formatWeekRange, formatWeekdayDate } from "../src/lib/dates";
import { DEFAULT_DISPLAY_PREFERENCES, formatClockParts, formatDateParts, getDisplayPreferences, setDisplayPreferences, type DateFormatId, type TimeFormatId } from "../src/lib/display-preferences";
import { formatDate, formatDateTime } from "../src/lib/format";
import {
  copyMondayToWeekdays,
  formatDayHours,
  isSameBusiness,
  isSameHours,
  isSameProfile,
  normalizeAccent,
  normalizeBusiness,
  normalizePhone,
  saveBranding,
  saveBusiness,
  saveHours,
  savePreferences,
  saveProfile,
  summarizeHours,
  validateAccent,
  validateBusiness,
  validateHours,
  validateProfileName,
} from "../src/lib/settings-state";

/** Runs `body` with the given display style, and always puts the defaults back. */
function withStyle(dateFormat: DateFormatId, timeFormat: TimeFormatId, body: () => void) {
  setDisplayPreferences({ dateFormat, timeFormat });
  try {
    body();
  } finally {
    setDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES);
  }
}

test.describe("baseline: the canonical records, not a copy", () => {
  test("Business information is the Business fixture", () => {
    expect(initialSettings.business).toEqual({
      name: "Apex Climate Heating & Air",
      phone: "(555) 392-8100",
      email: "service@apexclimate.com",
      address: { street: "4820 East Riverside Dr, Suite 110", city: "Austin", state: "TX", postalCode: "78741" },
    });
    expect(initialSettings.business.name).toBe(business.name);
    expect(initialSettings.business.address).toEqual(business.address);
    expect(Object.keys(initialSettings.business).sort()).toEqual(["address", "email", "name", "phone"]);
  });

  test("Business hours are the weekly hours the scheduling code already reads", () => {
    expect(initialSettings.hours).toBe(businessHoursByWeekday);
    expect(summarizeHours(initialSettings.hours)).toEqual([
      { days: "Mon–Fri", hours: "7:30 AM–6:00 PM" },
      { days: "Sat", hours: "8:00 AM–2:00 PM" },
      { days: "Sun", hours: "Closed" },
    ]);
    // The display rows are derived, so they agree with the approved strings by construction.
    expect(summarizeHours(initialSettings.hours).map((row) => ({ days: row.days, hours: row.hours }))).toEqual(business.hours.map((row) => ({ days: row.days, hours: row.hours })));
  });

  test("Preferences, Branding and My profile start from the approved values", () => {
    expect(initialSettings.preferences).toEqual({ timeZone: "America/Chicago", currency: "USD", dateFormat: "mdy-short", timeFormat: "12h" });
    expect(BUSINESS_TIME_ZONE).toBe("America/Chicago");
    expect(initialSettings.branding).toEqual({ logo: { fileName: "apex-climate-crest-revised.svg" }, accent: "#0D5C63" });
    expect(initialSettings.profile).toEqual({ name: "Alex Morgan", role: "Operations Lead" });
    expect(initialSettings.profile).toMatchObject(currentUser);
    // No email, password or sign-in fields exist on the profile.
    expect(Object.keys(initialSettings.profile)).not.toContain("email");
  });

  test("the days of the week are defined once", () => {
    expect([...TEAM_WEEK_ORDER]).toEqual([...WEEK_ORDER]);
  });

  test("the time zones are the seven US zones, with Central the default", () => {
    expect(TIME_ZONES.map((zone) => zone.id)).toEqual(["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"]);
    expect(getTimeZone("America/Chicago").short).toBe("Central Time (CT)");
    expect(getTimeZone("Pacific/Honolulu").short).toBe("Hawaii Time (HT)");
    expect(getTimeZone("Mars/Olympus").id).toBe("America/Chicago");
  });
});

test.describe("Business information rules", () => {
  const valid = initialSettings.business;

  test("a phone number is any ten-digit US number, stored in one format", () => {
    expect(normalizePhone("5553928100")).toBe("(555) 392-8100");
    expect(normalizePhone("555-392-8100")).toBe("(555) 392-8100");
    expect(normalizePhone("+1 (555) 392 8100")).toBe("(555) 392-8100");
    expect(normalizePhone("392-8100")).toBeUndefined();
    expect(normalizePhone("")).toBeUndefined();
  });

  test("every required field has its own message", () => {
    expect(validateBusiness(valid)).toEqual({});
    expect(validateBusiness({ ...valid, name: "  ", phone: "123", email: "nope", address: { street: "", city: "", state: "", postalCode: "123" } })).toEqual({
      name: "Enter your business name.",
      phone: "Enter a ten-digit phone number, for example (555) 392-8100.",
      email: "Enter a valid email address.",
      street: "Enter a street address.",
      city: "Enter a city.",
      state: "Select a state.",
      postalCode: "Enter a 5-digit ZIP code.",
    });
  });

  test("a saved record is trimmed and its phone number tidied, and the input is not mutated", () => {
    const input = { ...valid, name: "  Apex Climate  ", phone: "5553928100", email: " a@b.co " };
    const frozen = JSON.stringify(input);
    expect(normalizeBusiness(input)).toMatchObject({ name: "Apex Climate", phone: "(555) 392-8100", email: "a@b.co" });
    expect(JSON.stringify(input)).toBe(frozen);
    expect(isSameBusiness(valid, { ...valid })).toBe(true);
    expect(isSameBusiness(valid, { ...valid, address: { ...valid.address, city: "Dallas" } })).toBe(false);
  });

  test("saving changes only Business information", () => {
    const saved = saveBusiness(initialSettings, { ...valid, name: "New Name" });
    expect(saved.business.name).toBe("New Name");
    expect(saved.hours).toBe(initialSettings.hours);
    expect(saved.preferences).toBe(initialSettings.preferences);
    expect(initialSettings.business.name).toBe("Apex Climate Heating & Air");
  });
});

test.describe("Business hours rules", () => {
  test("consecutive days with the same hours are joined, in Monday-first order", () => {
    const hours = { ...businessHoursByWeekday, 3: { open: "09:00", close: "17:00" } };
    expect(summarizeHours(hours)).toEqual([
      { days: "Mon–Tue", hours: "7:30 AM–6:00 PM" },
      { days: "Wed", hours: "9:00 AM–5:00 PM" },
      { days: "Thu–Fri", hours: "7:30 AM–6:00 PM" },
      { days: "Sat", hours: "8:00 AM–2:00 PM" },
      { days: "Sun", hours: "Closed" },
    ]);
    expect(summarizeHours({ 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null })).toEqual([{ days: "Mon–Sun", hours: "Closed" }]);
  });

  test("hours are written in the saved time style", () => {
    expect(formatDayHours({ open: "07:30", close: "18:00" }, "12h")).toBe("7:30 AM–6:00 PM");
    expect(formatDayHours({ open: "07:30", close: "18:00" }, "24h")).toBe("07:30–18:00");
    expect(formatDayHours(null, "24h")).toBe("Closed");
    expect(summarizeHours(businessHoursByWeekday, "24h")[0]).toEqual({ days: "Mon–Fri", hours: "07:30–18:00" });
  });

  test("a closing time must follow the opening time, day by day", () => {
    expect(validateHours(businessHoursByWeekday)).toEqual({});
    expect(validateHours({ ...businessHoursByWeekday, 2: { open: "18:00", close: "07:30" }, 4: { open: "09:00", close: "09:00" } })).toEqual({
      2: "Closing time must be after opening time.",
      4: "Closing time must be after opening time.",
    });
  });

  test("Copy Monday to weekdays copies Monday into Tuesday to Friday only, closed or open, without mutating", () => {
    const monday = { ...businessHoursByWeekday, 1: { open: "08:00", close: "17:00" } };
    const frozen = JSON.stringify(monday);
    const copied = copyMondayToWeekdays(monday);
    for (const day of [1, 2, 3, 4, 5]) expect(copied[day]).toEqual({ open: "08:00", close: "17:00" });
    expect(copied[6]).toEqual(businessHoursByWeekday[6]);
    expect(copied[0]).toBeNull();
    expect(JSON.stringify(monday)).toBe(frozen);
    expect(copyMondayToWeekdays({ ...businessHoursByWeekday, 1: null })[3]).toBeNull();
    expect(isSameHours(businessHoursByWeekday, { ...businessHoursByWeekday })).toBe(true);
    expect(isSameHours(businessHoursByWeekday, copied)).toBe(false);
    expect(saveHours(initialSettings, copied).hours).toBe(copied);
  });

  test("the editor offers half-hour steps from 5:00 AM to 11:00 PM, including every saved baseline time", () => {
    expect(HOUR_OPTIONS[0]).toBe("05:00");
    expect(HOUR_OPTIONS.at(-1)).toBe("23:00");
    for (const day of WEEK_ORDER) {
      const hours = businessHoursByWeekday[day];
      if (hours) for (const time of [hours.open, hours.close]) expect(HOUR_OPTIONS).toContain(time);
    }
  });

  test("the booking times offered follow the saved hours, and the baseline is unchanged", () => {
    expect(getSlotGroup("request-appointment", "2024-10-26", 120).slots.filter((slot) => slot.available).map((slot) => slot.label)).toEqual(["Morning", "Midday"]);
    const closedSaturday = { ...businessHoursByWeekday, 6: null };
    expect(getSlotGroup("request-appointment", "2024-10-26", 120, closedSaturday).unavailableReason).toBe("The business is closed on Sats.");
    const opensSunday = { ...businessHoursByWeekday, 0: { open: "09:00", close: "17:00" } };
    expect(getSlotGroup("instant", "2024-10-27", 60, opensSunday).slots.some((slot) => slot.available)).toBe(true);
    expect(getSlotGroup("instant", "2024-10-27", 60).unavailableReason).toBe("The business is closed on Suns.");
    const shorter = { ...businessHoursByWeekday, 5: { open: "09:00", close: "12:00" } };
    expect(getSlotGroup("request-appointment", "2024-10-25", 120, shorter).slots.filter((slot) => slot.available).map((slot) => slot.label)).toEqual(["Midday"]);
  });
});

test.describe("Branding rules", () => {
  test("an accent is six hex digits, with or without the #, and empty means none", () => {
    expect(normalizeAccent("#0d5c63")).toBe("#0D5C63");
    expect(normalizeAccent("0d5c63")).toBe("#0D5C63");
    expect(normalizeAccent("  ")).toBeNull();
    expect(normalizeAccent("#12")).toBeUndefined();
    expect(normalizeAccent("#GGGGGG")).toBeUndefined();
    expect(validateAccent("#12")).toBe("Enter a 6-digit hex colour such as #0D5C63.");
  });

  test("white button text has to stay readable on the accent", () => {
    expect(validateAccent(DEFAULT_ACCENT)).toBeUndefined();
    expect(validateAccent("")).toBeUndefined();
    for (const swatch of ACCENT_SWATCHES) expect(validateAccent(swatch), swatch).toBeUndefined();
    expect(validateAccent("#767676")).toBeUndefined(); // 4.54:1
    expect(validateAccent("#777777")).toBe("Choose a darker colour so white button text stays readable."); // 4.48:1
    expect(validateAccent("#FFFF00")).toBe("Choose a darker colour so white button text stays readable.");
  });

  test("saving branding changes only branding", () => {
    const saved = saveBranding(initialSettings, { logo: null, accent: "#8B3A1E" });
    expect(saved.branding).toEqual({ logo: null, accent: "#8B3A1E" });
    expect(saved.business).toBe(initialSettings.business);
  });
});

test.describe("My profile rules", () => {
  test("the name is required and short", () => {
    expect(validateProfileName("Alex Morgan")).toBeUndefined();
    expect(validateProfileName("   ")).toBe("Enter your full name.");
    expect(validateProfileName("x".repeat(61))).toBe("Keep your name to 60 characters or fewer.");
  });

  test("saving changes the name and photo, never the role", () => {
    const saved = saveProfile(initialSettings, { name: "  Alex Q. Morgan ", role: "Owner", photo: "blob:x" });
    expect(saved.profile).toEqual({ name: "Alex Q. Morgan", role: "Operations Lead", photo: "blob:x" });
    expect(isSameProfile(initialSettings.profile, { ...initialSettings.profile })).toBe(true);
    expect(isSameProfile(initialSettings.profile, { ...initialSettings.profile, name: "Other" })).toBe(false);
  });
});

test.describe("Workspace preferences: the saved style is read by the formatters", () => {
  test("the defaults are the approved style, and a fresh server render uses them", () => {
    expect(getDisplayPreferences()).toEqual({ dateFormat: "mdy-short", timeFormat: "12h" });
    expect(formatDate("2024-10-25")).toBe("Oct 25, 2024");
    expect(formatTime("13:30")).toBe("1:30 PM");
    expect(formatDateTime("2024-10-25T13:30:00Z")).toBe("Oct 25, 1:30 PM");
    expect(formatLongDate("2024-10-25")).toBe("Friday, October 25, 2024");
    expect(formatWeekdayDate("2024-10-25")).toBe("Fri, Oct 25");
    expect(formatWeekRange("2024-10-21")).toBe("Oct 21 – Oct 27, 2024");
    expect(formatTimeRange("10:00", "12:00")).toBe("10:00 AM – 12:00 PM");
  });

  test("the four date styles", () => {
    const expected: Record<DateFormatId, { date: string; monthDay: string; long: string; week: string }> = {
      "mdy-short": { date: "Oct 25, 2024", monthDay: "Oct 25", long: "Friday, October 25, 2024", week: "Oct 21 – Oct 27, 2024" },
      "mdy-numeric": { date: "10/25/2024", monthDay: "10/25", long: "Friday, 10/25/2024", week: "10/21/2024 – 10/27/2024" },
      "dmy-numeric": { date: "25/10/2024", monthDay: "25/10", long: "Friday, 25/10/2024", week: "21/10/2024 – 27/10/2024" },
      "ymd-iso": { date: "2024-10-25", monthDay: "10-25", long: "Friday, 2024-10-25", week: "2024-10-21 – 2024-10-27" },
    };
    for (const [id, want] of Object.entries(expected) as [DateFormatId, (typeof expected)[DateFormatId]][]) {
      withStyle(id, "12h", () => {
        expect(formatDate("2024-10-25")).toBe(want.date);
        expect(formatMonthDay("2024-10-25")).toBe(want.monthDay);
        expect(formatLongDate("2024-10-25")).toBe(want.long);
        expect(formatWeekRange("2024-10-21")).toBe(want.week);
        expect(formatDateTime("2024-10-25T13:30:00Z")).toBe(`${want.monthDay}, 1:30 PM`);
      });
    }
  });

  test("12-hour and 24-hour time, including midnight and noon", () => {
    withStyle("mdy-short", "24h", () => {
      expect(formatTime("13:30")).toBe("13:30");
      expect(formatTime("09:05")).toBe("09:05");
      expect(formatTime("00:00")).toBe("00:00");
      expect(formatTimeRange("10:00", "12:00")).toBe("10:00 – 12:00");
      expect(formatDateTime("2024-10-25T13:30:00Z")).toBe("Oct 25, 13:30");
    });
    expect(formatTime("00:00")).toBe("12:00 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatClockParts(9, 5, "12h")).toBe("9:05 AM");
  });

  test("the style changes how a value is written, never the value: stored dates and times are untouched", () => {
    const stored = ["2024-10-25", "2024-10-25T10:45"];
    withStyle("ymd-iso", "24h", () => {
      expect(stored).toEqual(["2024-10-25", "2024-10-25T10:45"]);
      expect(formatDate(stored[0])).toBe("2024-10-25");
    });
    expect(formatDateParts(2024, 9, 30, "mdy-short")).toBe("Oct 30, 2024");
  });

  test("the picker's examples use the approved sample date, Oct 30, 2024", () => {
    expect(DATE_FORMATS.map((format) => dateFormatExample(format.id))).toEqual(["Oct 30, 2024", "10/30/2024", "30/10/2024", "2024-10-30"]);
  });

  test("saving preferences changes only preferences, and the currency cannot change", () => {
    const saved = savePreferences(initialSettings, { ...initialSettings.preferences, timeZone: "America/New_York", timeFormat: "24h" });
    expect(saved.preferences).toMatchObject({ timeZone: "America/New_York", timeFormat: "24h", currency: "USD" });
    expect(saved.business).toBe(initialSettings.business);
  });

  test("no formatter reads the system clock, Intl or the browser timezone", () => {
    for (const file of ["src/lib/display-preferences.ts", "src/lib/dates.ts", "src/lib/settings-state.ts", "src/lib/analytics-state.ts", "src/lib/report-export.ts", "src/lib/pdf.ts"]) {
      const text = readFileSync(file, "utf8");
      for (const banned of ["Date.now", "new Date()", "Intl.", "toLocale", "getTimezoneOffset"]) expect(text, `${file}: ${banned}`).not.toContain(banned);
    }
  });
});

test.describe("one source of truth", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(tsx?)$/.test(entry) ? [path] : [];
    });
  }

  test("no component or page reads the static business, hours, time zone or user records: they read Settings", () => {
    const hits: string[] = [];
    for (const file of [...sourceFiles("src/components"), ...sourceFiles("src/app")]) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/data\/fixtures"/g)) {
        for (const name of match[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0])) {
          if (["business", "businessHoursByWeekday", "currentUser", "BUSINESS_TIME_ZONE"].includes(name)) hits.push(`${file}: ${name}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  test("the fixtures that do read the baseline are data modules, and Settings is the only editor of it", () => {
    const readers = ["src/data/settings.ts", "src/lib/booking-slots.ts"];
    for (const file of readers) expect(readFileSync(file, "utf8")).toMatch(/from "(@\/data\/|\.\/)fixtures"/);
  });
});
