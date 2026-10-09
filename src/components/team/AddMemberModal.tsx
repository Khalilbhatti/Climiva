"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { StepList } from "@/components/ui/StepList";
import { memberHref } from "@/config/routes";
import { getRoleById, type AvailabilityMode, type TeamMember } from "@/data/team";
import { useTeam } from "./TeamProvider";

const STEPS = [
  { id: "person", label: "Person" },
  { id: "role", label: "Role" },
  { id: "field", label: "Field access" },
  { id: "availability", label: "Availability" },
  { id: "review", label: "Review" },
] as const;

const FIELD_ROLES = ["technician", "apprentice"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AVAILABILITY_OPTIONS: { id: AvailabilityMode; title: string; description: string }[] = [
  { id: "business-hours", title: "Uses business hours", description: "Follows the company operating hours and updates when they change." },
  { id: "custom", title: "Custom availability", description: "Set day-by-day hours on their Schedule & availability tab after inviting them." },
  { id: "not-set", title: "Set later", description: "Not shown as available for assignment until availability is configured." },
];

type Draft = {
  name: string;
  email: string;
  phone: string;
  roleId: string;
  fieldAssignable: boolean;
  availabilityMode: AvailabilityMode;
};

/**
 * Add team member: five steps, then a confirmation. The person is saved to the business's team as a pending record. Nothing
 * is emailed and no sign-in is created: email invitations are not part of this release, and a team member is not an account.
 */
export function AddMemberModal({ onClose }: { onClose: () => void }) {
  const { data, addMember } = useTeam();
  const [draft, setDraft] = useState<Draft>({
    name: "",
    email: "",
    phone: "",
    roleId: "technician",
    fieldAssignable: true,
    availabilityMode: "business-hours",
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [sent, setSent] = useState<TeamMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const step = STEPS[stepIndex];
  const role = getRoleById(draft.roleId, data);
  const roles = data.roles.filter((item) => item.id !== "owner");

  const errors: { name?: string; email?: string } = {};
  if (!draft.name.trim()) errors.name = "Enter the person's name.";
  if (!draft.email.trim()) errors.email = "Enter an email address.";
  else if (!EMAIL_PATTERN.test(draft.email.trim())) errors.email = "Enter a valid email address, like name@example.com.";
  else if (data.members.some((member) => member.email?.toLowerCase() === draft.email.trim().toLowerCase())) {
    errors.email = "A team member with this email address already exists.";
  }
  const stepHasErrors = step.id === "person" && Boolean(errors.name || errors.email);

  // Move focus to the step heading when the step changes so screen reader users hear where they are.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex, sent]);

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function next() {
    if (stepHasErrors) return setShowErrors(true);
    setShowErrors(false);
    setStepIndex((index) => index + 1);
  }

  async function save() {
    if (errors.name || errors.email || saving) return;
    setSaving(true);
    setProblem(undefined);
    const result = await addMember({
      name: draft.name,
      email: draft.email,
      phone: draft.phone,
      roleId: draft.roleId,
      fieldAssignable: draft.fieldAssignable,
      availabilityMode: draft.availabilityMode,
    });
    setSaving(false);
    if (result.ok) setSent(result.data.member);
    else setProblem(result.error);
  }

  /* ───────── invitation sent ───────── */
  if (sent) {
    const sentRole = getRoleById(sent.roleId, data);
    return (
      <Modal
        open
        onClose={onClose}
        title="Team member added"
        description={`${sent.name} is on your team as pending. No email was sent and no account was created for ${sent.email}.`}
        footer={
          <>
            <Button variant="tertiary" onClick={onClose} className="mr-auto">
              Close
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSent(null);
                setStepIndex(0);
                setDraft({ name: "", email: "", phone: "", roleId: "technician", fieldAssignable: true, availabilityMode: "business-hours" });
              }}
            >
              Add another team member
            </Button>
            <ButtonLink href={memberHref(sent.id)}>View team member</ButtonLink>
          </>
        }
      >
        <div role="status" className="space-y-4">
          <p className="flex items-center gap-2 text-base font-semibold text-positive">
            <CircleCheck aria-hidden className="size-5" />
            {sent.name} · Pending
          </p>
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Role", value: sentRole?.name ?? sent.role },
              { label: "Field access", value: sent.fieldAssignable ? "Assignable to Jobs" : "Not assignable to Jobs" },
              { label: "Assigned services", value: "All active services" },
              { label: "Availability", value: AVAILABILITY_OPTIONS.find((item) => item.id === sent.availability.mode)?.title ?? "" },
            ]}
          />
          <p className="text-xs text-ink-muted">
            Email invitations are not available yet. Their record is saved, and it stays pending until they have a sign-in.
          </p>
        </div>
      </Modal>
    );
  }

  /* ───────── wizard ───────── */
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Add team member"
      description="Add someone to your team and choose how they appear in your workspace."
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} className="mr-auto">
            Cancel
          </Button>
          {stepIndex > 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                setShowErrors(false);
                setStepIndex((index) => index - 1);
              }}
            >
              Back
            </Button>
          )}
          {isLast ? (
            <Button onClick={save} disabled={saving}>
              {saving ? "Adding…" : "Add team member"}
            </Button>
          ) : (
            <Button onClick={next}>Next: {STEPS[stepIndex + 1].label}</Button>
          )}
        </>
      }
    >
      <StepList steps={STEPS} current={stepIndex} label="Add team member steps" />

      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none">
        {step.id === "person" && "Who are you adding?"}
        {step.id === "role" && "What role will they have?"}
        {step.id === "field" && "Can they be assigned to Jobs?"}
        {step.id === "availability" && "When are they available?"}
        {step.id === "review" && "Review team member"}
        <span className="sr-only">
          , step {stepIndex + 1} of {STEPS.length}
        </span>
      </h3>

      {step.id === "person" && (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">Enter their contact details. This saves a team record; it does not send an email or create a sign-in.</p>
          <Input
            label="Name"
            required
            autoComplete="off"
            value={draft.name}
            error={showErrors ? errors.name : undefined}
            onChange={(event) => update({ name: event.target.value })}
          />
          <Input
            label="Email"
            type="email"
            required
            autoComplete="off"
            value={draft.email}
            hint="Saved on their team record. No email is sent."
            error={showErrors ? errors.email : undefined}
            onChange={(event) => update({ email: event.target.value })}
          />
          <Input
            label="Direct phone (optional)"
            type="tel"
            autoComplete="off"
            value={draft.phone}
            onChange={(event) => update({ phone: event.target.value })}
          />
        </div>
      )}

      {step.id === "role" && (
        <OptionGroup legend="Role" hint="Roles control which parts of Climvia they can open.">
          {roles.map((item) => (
            <OptionCard
              key={item.id}
              type="radio"
              name="member-role"
              title={item.name}
              description={item.description}
              checked={draft.roleId === item.id}
              onChange={() => update({ roleId: item.id, fieldAssignable: FIELD_ROLES.includes(item.id) })}
            />
          ))}
        </OptionGroup>
      )}

      {step.id === "field" && (
        <OptionGroup legend="Field access" hint="Job assignment is set separately from their role's permissions.">
          <OptionCard
            type="radio"
            name="member-field"
            title="Assignable to Jobs"
            description="Can be assigned to Jobs and appears in Schedule assignment."
            checked={draft.fieldAssignable}
            onChange={() => update({ fieldAssignable: true })}
          />
          <OptionCard
            type="radio"
            name="member-field"
            title="Not assignable to Jobs"
            description="Office work only. Won't appear in Schedule assignment."
            checked={!draft.fieldAssignable}
            onChange={() => update({ fieldAssignable: false })}
          />
        </OptionGroup>
      )}

      {step.id === "availability" && (
        <OptionGroup legend="Availability" hint="You can change this any time from their Schedule & availability tab.">
          {AVAILABILITY_OPTIONS.map((item) => (
            <OptionCard
              key={item.id}
              type="radio"
              name="member-availability"
              title={item.title}
              description={item.description}
              checked={draft.availabilityMode === item.id}
              onChange={() => update({ availabilityMode: item.id })}
            />
          ))}
        </OptionGroup>
      )}

      {step.id === "review" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">Check the details before adding them to your team.</p>
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Name", value: draft.name.trim() },
              { label: "Email", value: draft.email.trim() },
              { label: "Direct phone", value: draft.phone.trim() || "Not provided" },
              { label: "Role", value: role?.name ?? "" },
              { label: "Field access", value: draft.fieldAssignable ? "Assignable to Jobs" : "Not assignable to Jobs" },
              { label: "Availability", value: AVAILABILITY_OPTIONS.find((item) => item.id === draft.availabilityMode)?.title ?? "" },
            ]}
          />
          <p className="text-xs text-ink-muted">They will appear in the Team list as Pending. No invitation email is sent.</p>
          {problem && <FormAlert>{problem}</FormAlert>}
        </div>
      )}
    </Modal>
  );
}
