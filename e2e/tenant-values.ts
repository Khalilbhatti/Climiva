/**
 * The values that identify each seeded business, for the specs that prove none of them reaches a place it should not.
 *
 * Taken from the records the seed writes (scripts/db/seed-lib.ts and seed-data), never retyped, so a change to a business's record is a
 * change to what these specs look for. Each is a string a visitor or a script could carry: the whole name and its first words (a name can
 * be split, or its ampersand escaped), the phone as shown and as digits, the email and its domain, the street, and a person.
 */
import { APEX, NORTHSTAR } from "../scripts/db/seed-lib";
import { apexSettings, business, currentUser } from "../scripts/db/seed-data/apex";
import { NORTHSTAR_CUSTOMERS } from "../scripts/db/seed-data/northstar";

export type Needle = { tenant: "Apex" | "Northstar"; what: string; value: string };

const firstWords = (name: string) => name.split(" ").slice(0, 2).join(" ");
const digits = (phone: string) => phone.replace(/\D/g, "");

export const APEX_VALUES: Needle[] = [
  { tenant: "Apex", what: "name", value: APEX.name },
  { tenant: "Apex", what: "first words of the name", value: firstWords(APEX.name) },
  { tenant: "Apex", what: "phone", value: APEX.phone },
  { tenant: "Apex", what: "phone digits", value: digits(APEX.phone) },
  { tenant: "Apex", what: "email", value: APEX.email },
  { tenant: "Apex", what: "web address", value: business.website.split(".")[0] },
  { tenant: "Apex", what: "street", value: APEX.addressLine1 },
  { tenant: "Apex", what: "person", value: currentUser.name },
];

export const NORTHSTAR_VALUES: Needle[] = [
  { tenant: "Northstar", what: "name", value: NORTHSTAR.name },
  { tenant: "Northstar", what: "first words of the name", value: firstWords(NORTHSTAR.name) },
  { tenant: "Northstar", what: "phone", value: NORTHSTAR.phone },
  { tenant: "Northstar", what: "phone digits", value: digits(NORTHSTAR.phone) },
  { tenant: "Northstar", what: "email", value: NORTHSTAR.email },
  { tenant: "Northstar", what: "email domain", value: NORTHSTAR.email.split("@")[1].split(".")[0] },
  { tenant: "Northstar", what: "street", value: NORTHSTAR.addressLine1 },
  { tenant: "Northstar", what: "customer", value: NORTHSTAR_CUSTOMERS[0].name },
];

/** The reference crest the sample workspace shows (src/server/sample-workspace.ts). */
export const APEX_CREST = apexSettings.branding.logo?.fileName ?? "";

/** What the sample workspace shows beyond the record itself: the person's role and the reference crest. */
export const SAMPLE_WORKSPACE_VALUES: Needle[] = [
  { tenant: "Apex", what: "role", value: currentUser.role },
  { tenant: "Apex", what: "reference crest", value: APEX_CREST },
];

export const BUSINESS_VALUES: Needle[] = [...APEX_VALUES, ...NORTHSTAR_VALUES];

/** The needles found in any of `texts`, each named by the business it identifies. */
export const foundIn = (texts: readonly string[], needles: readonly Needle[]): string[] =>
  needles.filter((needle) => needle.value && texts.some((text) => text.includes(needle.value))).map((needle) => `${needle.tenant} ${needle.what}: ${needle.value}`);
