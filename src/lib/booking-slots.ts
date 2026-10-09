/**
 * Time slots offered when creating a booking. What a slot looks like depends on the service's booking
 * method (the three approved behaviours); whether it is available depends only on the business hours and
 * "today" in the business's own time zone (callers pass the workspace clock; the sample business's is fixed, so its dates
 * stay put). The hours are the saved Settings hours (callers pass them); the baseline hours are the default. Existing
 * bookings are never moved when the hours change.
 */
import { PROTOTYPE_TODAY, businessHoursByWeekday } from "@/data/fixtures";
import type { BookingMethod } from "@/data/services";
import type { WeeklyHours } from "@/data/settings";
import { formatWeekday, minutesToTime, timeToMinutes, weekdayIndex } from "./dates";

export type Slot = {
  id: string;
  label: string;
  start: string;
  end: string;
  available: boolean;
};

export type SlotGroup = {
  /** What kind of time this is, e.g. "Start time" or "Arrival window (2 hours)". */
  heading: string;
  slots: Slot[];
  /** Set when the whole day is unavailable. */
  unavailableReason?: string;
};

const INSTANT_STARTS = ["09:00", "11:30", "14:00", "16:00"];

const APPOINTMENT_WINDOWS = [
  { label: "Morning", start: "08:00", end: "10:00" },
  { label: "Midday", start: "10:00", end: "12:00" },
  { label: "Afternoon", start: "13:00", end: "15:00" },
  { label: "Late afternoon", start: "15:00", end: "17:00" },
];

const CONSULTATION_SLOTS = [
  { label: "Morning consultation", start: "09:00", end: "11:00" },
  { label: "Afternoon consultation", start: "13:30", end: "15:30" },
];

const HEADING: Record<BookingMethod, string> = {
  instant: "Start time",
  "request-appointment": "Arrival window (2 hours)",
  "request-quote": "Consultation slot",
};

export function getSlotGroup(
  method: BookingMethod,
  date: string,
  durationMinutes: number,
  weeklyHours: WeeklyHours = businessHoursByWeekday,
  today: string = PROTOTYPE_TODAY,
): SlotGroup {
  const heading = HEADING[method];
  const hours = weeklyHours[weekdayIndex(date)];

  if (date < today) return { heading, slots: [], unavailableReason: "This date has already passed." };
  if (!hours) return { heading, slots: [], unavailableReason: `The business is closed on ${formatWeekday(date)}s.` };

  const open = timeToMinutes(hours.open);
  const close = timeToMinutes(hours.close);
  const within = (start: string, end: string) => timeToMinutes(start) >= open && timeToMinutes(end) <= close;

  const raw =
    method === "instant"
      ? INSTANT_STARTS.map((start) => ({
          label: start,
          start,
          end: minutesToTime(timeToMinutes(start) + durationMinutes),
        }))
      : method === "request-appointment"
        ? APPOINTMENT_WINDOWS
        : CONSULTATION_SLOTS;

  return {
    heading,
    slots: raw.map((slot) => ({
      id: `${slot.start}-${slot.end}`,
      label: slot.label,
      start: slot.start,
      end: slot.end,
      available: within(slot.start, slot.end),
    })),
  };
}
