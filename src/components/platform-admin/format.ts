import type { Route } from "next";

// Formatted by hand, like lib/format: the locale libraries differ between Node and a browser, and the console's figures must read the same in both.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 1234567 → "1,234,567". */
export const groupDigits = (value: number): string => String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** A moment, in UTC, because the console serves operators in any time zone and every business keeps its own: "Oct 19, 2026, 3:45 PM UTC". */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const hours = date.getUTCHours();
  const clock = `${hours % 12 === 0 ? 12 : hours % 12}:${String(date.getUTCMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${clock} UTC`;
}

/** A calendar day ("2026-10-19"), as written: "Oct 19, 2026". */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "—" : `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** An address inside the console, with a query. The paths are the console's own; the query is built here, never taken from a request as written. */
export function consoleHref(path: string, params: Record<string, string | number | null | undefined> = {}): Route {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== "") query.set(name, String(value));
  const text = query.toString();
  return (text ? `${path}?${text}` : path) as Route;
}

export const plural = (count: number, one: string, many = `${one}s`) => `${groupDigits(count)} ${count === 1 ? one : many}`;
