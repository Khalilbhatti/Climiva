/**
 * Proving that the person controls a domain: look for the TXT record that carries the claim's token.
 *
 *   1. a short transaction stamps the check (the cooldown) and reads what to look for,
 *   2. DNS is asked, with no transaction and no lock held (it is a network wait, bounded by the resolver),
 *   3. a second short transaction marks the claim verified, only if it is still the same pending claim.
 *
 * Only an exact match counts (lib/domain-rules `txtRecordsMatch`). The outcome says what was found, and a DNS failure or timeout changes
 * nothing: the claim stays as it was and the person can try again. Nothing here fetches anything from the customer's website; only DNS is read.
 *
 * No `server-only` import on purpose: the specs call it with their own resolver.
 */
import { beginOwnershipCheck, markVerified } from "@/db/domain-queries";
import { withTenant } from "@/db/tenant";
import { txtRecordsMatch, verificationRecordName, verificationRecordValue, type OwnershipOutcome } from "@/lib/domain-rules";
import type { DnsResolver } from "@/lib/dns-resolver";

/** What a check found: see lib/domain-rules `OwnershipOutcome`. A DNS failure or timeout is "unavailable" and changes nothing. */
export type VerificationOutcome = OwnershipOutcome;

export async function verifyDomainOwnership(
  identity: { userId: string; organizationId: string },
  siteId: string,
  domainId: unknown,
  expectedRevision: unknown,
  resolver: DnsResolver,
): Promise<VerificationOutcome> {
  const check = await withTenant(identity, (tx) => beginOwnershipCheck({ tx, organizationId: identity.organizationId }, siteId, domainId, expectedRevision));
  if (check.kind === "settled") return "settled";
  if (check.kind === "too-soon") return "too-soon";

  const answer = await resolver.resolveTxt(verificationRecordName(check.hostname));
  if (answer.kind === "unavailable") return "unavailable";
  if (answer.kind === "none") return "not-found";
  if (!txtRecordsMatch(answer.records, verificationRecordValue(check.token))) return "wrong-value";

  return withTenant(identity, (tx) => markVerified({ tx, organizationId: identity.organizationId }, siteId, check.id, check.token));
}
