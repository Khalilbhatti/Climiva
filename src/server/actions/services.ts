"use server";

import { and, eq } from "drizzle-orm";
import type { Service } from "@/data/services";
import { insertServices, loadServices } from "@/db/core-queries";
import { serviceValues } from "@/db/core-mappers";
import { services } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_SERVICES, NOT_FOUND, failure, ok, type ActionResult } from "@/lib/action-result";
import { createServiceId, parseService } from "@/lib/service-rules";
import { authorize } from "../authorize";
import { isIntegrityViolation, uniqueViolationOf } from "../db-errors";

/**
 * Service writes. Each action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "services:manage" capability (owner or admin),
 *   3. parses and validates the input again (the form's checks are a convenience, these are the enforcement),
 *   4. writes inside a tenant transaction, so Row Level Security checks the same rules a second time.
 * No argument names an organization, and the id a browser sends is never trusted: the server chooses it.
 */

const DUPLICATE_NAME = "A service with this name already exists.";

function translate(error: unknown): ReturnType<typeof failure> {
  if (uniqueViolationOf(error)?.startsWith("services_org_")) return failure(DUPLICATE_NAME, { name: DUPLICATE_NAME });
  if (isIntegrityViolation(error)) return failure("Some of this Service's details can't be saved. Check the name, price and duration, then try again.");
  console.error("[services] could not save:", error instanceof Error ? error.message : error);
  return failure("We couldn't save this Service. Your changes weren't saved. Try again.");
}

export async function addServiceAction(input: unknown): Promise<ActionResult<Service>> {
  const auth = await authorize("services:manage", NOT_ALLOWED_SERVICES);
  if (!auth.ok) return auth.result;
  const { userId, organizationId } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const existing = await loadServices(tx, organizationId);
      const parsed = parseService(input, existing);
      if (!parsed.ok) return parsed;
      const service: Service = {
        ...parsed.value,
        id: createServiceId(parsed.value.name, existing),
        // It joins the end of the list; the browser's number is only a suggestion.
        displayOrder: existing.reduce((highest, item) => Math.max(highest, item.displayOrder), 0) + 1,
      };
      await insertServices(tx, organizationId, [service]);
      return ok(service);
    });
  } catch (error) {
    return translate(error);
  }
}

/** Save every field of one Service of the active business, activate and deactivate included. */
export async function updateServiceAction(serviceId: unknown, input: unknown): Promise<ActionResult<Service>> {
  const auth = await authorize("services:manage", NOT_ALLOWED_SERVICES);
  if (!auth.ok) return auth.result;
  if (typeof serviceId !== "string" || serviceId.length > 100) return failure(NOT_FOUND);
  const { userId, organizationId } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const existing = await loadServices(tx, organizationId);
      if (!existing.some((item) => item.id === serviceId)) return failure(NOT_FOUND);
      const parsed = parseService(input && typeof input === "object" ? { ...(input as object), id: serviceId } : input, existing);
      if (!parsed.ok) return parsed;
      const service: Service = { ...parsed.value, id: serviceId };
      const updated = await tx
        .update(services)
        .set(serviceValues(service))
        .where(and(eq(services.organizationId, organizationId), eq(services.slug, serviceId)))
        .returning({ id: services.id });
      if (updated.length === 0) return failure(NOT_FOUND);
      return ok(service);
    });
  } catch (error) {
    return translate(error);
  }
}
