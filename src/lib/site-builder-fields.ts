/**
 * The problems the content check finds, as sentences keyed by where they are, for the screen to put on a field and for a server answer to
 * carry: "page", "page.field", "page.section" and "page.section.field". Pure.
 */
import type { ContentProblem } from "./site-template";

export function problemFields(problems: readonly ContentProblem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const problem of problems) {
    const key = [problem.page, problem.section, problem.field].filter((part): part is string => part !== undefined).join(".") || "content";
    if (out[key] === undefined) out[key] = problem.message;
  }
  return out;
}
