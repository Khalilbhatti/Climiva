"use client";

import { useState } from "react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { useTeam } from "@/components/team/TeamProvider";
import { getAssignableMembers } from "@/data/team";

type AssignDialogProps = {
  /** "Heat Pump Diagnostics & Repair · Mon, Oct 28, 9:00 AM – 11:00 AM" */
  description: string;
  currentAssigneeId?: string;
  /** A member who must not be offered, e.g. the one being deactivated. */
  excludeMemberId?: string;
  onClose: () => void;
  /** Resolves with the reason it failed, or nothing when the assignment was saved (the caller then closes the dialog). */
  onAssign: (memberId: string | undefined) => Promise<string | undefined>;
};

const UNASSIGNED = "unassigned";

/** Pick a team member for a booking or job. Mount it while open; it starts from the current assignee each time. */
export function AssignDialog({ description, currentAssigneeId, excludeMemberId, onClose, onAssign }: AssignDialogProps) {
  const { data: team } = useTeam();
  // Only active, field-assignable members can be given work; a deactivated member still shows on past records.
  const members = getAssignableMembers(team).filter((member) => member.id !== excludeMemberId);
  const [choice, setChoice] = useState(members.some((member) => member.id === currentAssigneeId) ? currentAssigneeId! : UNASSIGNED);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function save() {
    if (saving) return;
    setSaving(true);
    setProblem(undefined);
    const error = await onAssign(choice === UNASSIGNED ? undefined : choice);
    setSaving(false);
    if (error) setProblem(error);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign technician"
      description={description}
      footer={
        <ModalActions onCancel={onClose}>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save assignment"}
          </Button>
        </ModalActions>
      }
    >
      <OptionGroup legend="Team member">
        {members.map((member) => (
          <OptionCard
            key={member.id}
            type="radio"
            name="assignee"
            title={member.name}
            description={member.role}
            checked={choice === member.id}
            onChange={() => setChoice(member.id)}
          />
        ))}
        <OptionCard
          type="radio"
          name="assignee"
          title="Leave unassigned"
          description="Assign a technician later from the Schedule."
          checked={choice === UNASSIGNED}
          onChange={() => setChoice(UNASSIGNED)}
        />
      </OptionGroup>
      {problem && <FormAlert>{problem}</FormAlert>}
    </Modal>
  );
}
