/**
 * Server-side checks for a Marketplace listing's configuration: what a browser may ask a Server Action to store.
 *
 * The listing form validates for the person's convenience; these are the enforcement. Pure: no database, no framework.
 */
import { COVERS, CONTACT_FIELDS, DESCRIPTION_MAX, LISTING_ACTIONS, type ContactField, type CoverId, type ListingAction, type ListingConfig } from "@/data/marketplace";
import { textProblem } from "./site-sections";
import type { Parsed } from "./validation";

const SERVICE_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

function serviceRefs(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 200) return undefined;
  if (!value.every((item) => typeof item === "string" && item.length <= 80 && SERVICE_REF.test(item))) return undefined;
  return [...new Set(value as string[])];
}

function flags<K extends string>(input: unknown, keys: readonly K[]): Record<K, boolean> | undefined {
  if (!isRecord(input)) return undefined;
  const out = {} as Record<K, boolean>;
  for (const key of keys) {
    if (typeof input[key] !== "boolean") return undefined;
    out[key] = input[key];
  }
  return Object.keys(input).every((key) => (keys as readonly string[]).includes(key)) ? out : undefined;
}

/** A listing configuration from a request: every field present and of the right kind, nothing extra. */
export function parseListingConfig(input: unknown): Parsed<ListingConfig> {
  if (!isRecord(input)) return fail("The listing details were not understood.");
  const description = typeof input.description === "string" ? input.description : undefined;
  const order = serviceRefs(input.order);
  const selected = serviceRefs(input.selected);
  const contact = flags<ContactField>(input.contact, CONTACT_FIELDS.map((field) => field.id));
  const actions = flags<ListingAction>(input.actions, LISTING_ACTIONS.map((action) => action.id));
  if (description === undefined || !order || !selected || !contact || !actions) return fail("The listing details were not understood.");

  let cover: CoverId | undefined;
  if (input.cover !== undefined && input.cover !== null) {
    cover = COVERS.find((candidate) => candidate.id === input.cover)?.id;
    if (!cover) return fail("Choose one of the available covers.");
  }

  if (description.trim() === "") return fail("Enter a description for your listing.", { description: "Enter a description for your listing." });
  if (description.length > DESCRIPTION_MAX) return fail(`Keep the description to ${DESCRIPTION_MAX} characters or fewer.`, { description: `Keep the description to ${DESCRIPTION_MAX} characters or fewer.` });
  // Plain words: a listing's description is drawn as it is written (the text tokens of a website's sections do not apply to it).
  const problem = description.includes("{{") ? "Use plain text. Double braces are not allowed." : textProblem(description);
  if (problem) return fail(problem, { description: problem });
  if (selected.length === 0) return fail("Select at least one Service to show.", { services: "Select at least one Service to show." });

  return { ok: true, value: { description, cover, order, selected, contact, actions } };
}
