"use server";

import { createCustomer } from "@/db/core-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_CUSTOMERS, failure, ok, type ActionResult } from "@/lib/action-result";
import { DUPLICATE_CUSTOMER_EMAIL, parseNewCustomer } from "@/lib/customer-rules";
import { authorize } from "../authorize";
import { isIntegrityViolation, uniqueViolationOf } from "../db-errors";

/**
 * Adding a customer by hand. The action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "customers:manage" capability (owner or admin),
 *   3. parses and validates the input again (the form's checks are a convenience, these are the enforcement),
 *   4. writes inside a tenant transaction, so Row Level Security checks the same rules a second time.
 * No argument names an organization, and the public reference (the address of the customer's page) is chosen by the server.
 *
 * A customer is also made, by the database, when a guest books on the business's website or Marketplace profile (drizzle/0030). That path needs no
 * member and does not come through here.
 */

/** The PostgreSQL error code (or a Node network code) under a wrapped error, if there is one. */
function codeOf(error: unknown): string | undefined {
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function translate(error: unknown): ReturnType<typeof failure> {
  // The same email and phone written at the same instant by something that did not take the lock: the customer is already on the list.
  if (uniqueViolationOf(error) === "customers_org_identity_unique") return failure(DUPLICATE_CUSTOMER_EMAIL, { email: DUPLICATE_CUSTOMER_EMAIL });
  if (isIntegrityViolation(error)) return failure("The customer details break a rule. Check them and try again.");
  // Only the database's error code is logged: the library's message carries the statement's parameters, which are the customer's name, email and phone.
  console.error("[customers] could not add a customer:", codeOf(error) ?? "unexpected error");
  return failure("The customer could not be added. Try again.");
}

/** Add a customer to the active business. Resolves with the new customer's public reference (the end of its address), or with why it was refused. */
export async function addCustomerAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("customers:manage", NOT_ALLOWED_CUSTOMERS);
  if (!auth.ok) return auth.result;
  const parsed = parseNewCustomer(input);
  if (!parsed.ok) return parsed;
  const { userId, organizationId } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const added = await createCustomer(tx, organizationId, parsed.value);
      if (!added.created) return failure(DUPLICATE_CUSTOMER_EMAIL, { email: DUPLICATE_CUSTOMER_EMAIL });
      return ok({ id: added.slug });
    });
  } catch (error) {
    return translate(error);
  }
}
