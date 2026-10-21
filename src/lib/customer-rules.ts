/**
 * What an owner or admin may type when they add a customer, and the checks the server enforces on it. The form runs the same function to show
 * its messages, so the browser's checks are a convenience and these are the rules.
 *
 * A customer here is the fields the Customers module already has: a name, an email, a phone number and how they like to be reached. Nothing else is
 * collected, and no field names a business or a record id: the server chooses the business, the public reference and the key columns.
 *
 * Pure functions: no database, no framework.
 */
import type { ContactChannel } from "@/data/customers";
import { normalizePhone } from "./settings-state";
import { textProblem } from "./site-sections";
import { isRecord, slugify, text, type Parsed } from "./validation";

export const CUSTOMER_NAME_MAX = 80;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CONTACT_CHANNEL_CHOICES: readonly ContactChannel[] = ["SMS", "Phone", "Email"];

export const NEEDS_A_WAY_TO_REACH = "Enter an email address or a phone number.";
export const DUPLICATE_CUSTOMER_EMAIL = "A customer with this email address is already on your list.";

/** A customer as it is stored: trimmed, the phone number in one format, nothing empty (an empty email or phone is null). */
export type NewCustomer = {
  name: string;
  email: string | null;
  phone: string | null;
  preferredContact: ContactChannel;
};

const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

/** The public reference of a new customer ("/customers/dana-lee"): from the name, and "-2", "-3" … when the business already has one. */
export function createCustomerSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name, "customer");
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** How to reach someone by what is known about them: text a phone number, otherwise write to the email. */
export function suggestedChannel(phone: string, email: string): ContactChannel {
  return phone.trim() ? "SMS" : email.trim() ? "Email" : "SMS";
}

export function parseNewCustomer(input: unknown): Parsed<NewCustomer> {
  if (!isRecord(input)) return fail("The customer details were not understood.");
  const rawName = text(input.name, 200);
  const rawEmail = input.email === undefined || input.email === null ? "" : text(input.email, 200);
  const rawPhone = input.phone === undefined || input.phone === null ? "" : text(input.phone, 100);
  if (rawName === undefined || rawEmail === undefined || rawPhone === undefined) return fail("The customer details were not understood.");

  const fields: Record<string, string> = {};
  const name = rawName.trim();
  if (!name) fields.name = "Enter the customer's name.";
  else if (name.length > CUSTOMER_NAME_MAX) fields.name = `Keep the name to ${CUSTOMER_NAME_MAX} characters or fewer.`;
  else {
    const problem = textProblem(name);
    if (problem) fields.name = problem;
  }

  const email = rawEmail.trim();
  if (email && !EMAIL.test(email)) fields.email = "Enter a valid email address.";

  const phone = rawPhone.trim();
  if (phone && (phone.length > 60 || phone.replace(/\D/g, "").length < 7 || textProblem(phone))) fields.phone = "Enter a phone number with at least seven digits, for example (555) 010-0100.";

  if (!email && !phone) {
    fields.email = NEEDS_A_WAY_TO_REACH;
    fields.phone = NEEDS_A_WAY_TO_REACH;
  }

  let preferredContact: ContactChannel | undefined;
  if (input.preferredContact === undefined || input.preferredContact === null || input.preferredContact === "") {
    preferredContact = suggestedChannel(phone, email);
  } else {
    preferredContact = CONTACT_CHANNEL_CHOICES.find((channel) => channel === input.preferredContact);
    if (!preferredContact) return fail("The customer details were not understood.");
  }
  // A channel must be one the customer can be reached on.
  if (preferredContact === "Email" && !email && !fields.email) fields.preferredContact = "Add an email address to contact this customer by email.";
  if ((preferredContact === "SMS" || preferredContact === "Phone") && !phone && !fields.phone) {
    fields.preferredContact = `Add a phone number to contact this customer by ${preferredContact === "SMS" ? "SMS" : "phone"}.`;
  }

  if (Object.keys(fields).length > 0) return fail("Check the highlighted fields.", fields);
  return { ok: true, value: { name, email: email || null, phone: phone ? (normalizePhone(phone) ?? phone) : null, preferredContact } };
}
