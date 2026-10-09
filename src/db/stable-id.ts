import { createHash } from "node:crypto";

// A fixed namespace for Climvia's deterministic ids (random once, then constant forever).
const NAMESPACE = "5f0b1b52-62a4-4d2c-9c5e-3a1d0f6b7c41";

/**
 * A version 5 (name-based) UUID: the same input always gives the same id, and different inputs never collide in practice.
 *
 * Used only by the seed and the tests, so that the canonical sample records keep the same database identity every time the
 * database is rebuilt. The `organizationId` is part of the name, so "sarah-mitchell" in two businesses is two different rows.
 * The application itself lets PostgreSQL generate random ids.
 */
export function stableId(organizationId: string, kind: string, slug: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(NAMESPACE.replace(/-/g, ""), "hex"))
    .update(`${organizationId}:${kind}:${slug}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
