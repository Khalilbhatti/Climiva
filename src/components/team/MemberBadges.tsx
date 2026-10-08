import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import type { MemberStatus } from "@/data/team";

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Active",
  invited: "Invitation pending",
  inactive: "Inactive",
};

const MEMBER_TONE: Record<MemberStatus, StatusTone> = {
  active: "positive",
  invited: "warning",
  inactive: "neutral",
};

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  return <StatusBadge tone={MEMBER_TONE[status]}>{MEMBER_STATUS_LABEL[status]}</StatusBadge>;
}
