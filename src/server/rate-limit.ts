import "server-only";
import { serverTimerMs } from "@/lib/business-time";

/**
 * A small fixed-window rate limiter for the public booking form, held in this server process.
 *
 * It exists to blunt a script that posts the form in a loop, not to be a fraud system: one process, one window per key, no storage
 * outside memory (the application runs as a single container; a second instance would have its own windows, which only makes the
 * limit looser, never wrong for a real visitor). The key is the visitor's address and the site. It holds no tenant data: only
 * a count of recent requests per key, which is dropped when the window passes.
 */
const windows = new Map<string, { start: number; count: number }>();
const MAX_KEYS = 5000;

/** True while `key` has made fewer than `limit` requests in the current window; counts this one. */
export function withinLimit(key: string, limit: number, windowMs: number, now: number = serverTimerMs()): boolean {
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    if (windows.size >= MAX_KEYS) for (const [stale, entry] of windows) if (now - entry.start >= windowMs) windows.delete(stale);
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

/** The visitor's address as the first proxy in front of the application saw it: the right-most entry of X-Forwarded-For. */
export function clientAddress(forwardedFor: string | null): string {
  const parts = (forwardedFor ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? "unknown";
}
