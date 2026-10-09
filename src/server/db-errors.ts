import "server-only";

/** The name of the constraint a failed statement violated, if it was a unique violation (pg's error or Drizzle's wrapper around it). */
export function uniqueViolationOf(error: unknown): string | undefined {
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    const candidate = current as { code?: string; constraint?: string };
    if (candidate.code === "23505") return candidate.constraint ?? "";
  }
  return undefined;
}

/** True for any PostgreSQL integrity error (unique, foreign key, check): "the data you sent breaks a rule". */
export function isIntegrityViolation(error: unknown): boolean {
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    const code = (current as { code?: string }).code;
    if (code && /^23/.test(code)) return true;
  }
  return false;
}
