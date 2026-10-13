import type { StatusTone } from "@/components/ui/StatusBadge";
import type { DomainStatus } from "@/lib/domain-rules";

/**
 * How each state of a domain claim is toned. Nothing is "positive" (green) until it is something Climvia itself has done: the app serving the
 * Site for the name. Whether the name's DNS and certificate work is not something Climvia can show here.
 */
export const DOMAIN_TONE: Record<DomainStatus, StatusTone> = {
  pending_verification: "warning",
  verified: "primary",
  active: "positive",
  disabled: "neutral",
  removed: "neutral",
};
