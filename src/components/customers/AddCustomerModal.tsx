"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { customerHref } from "@/config/routes";
import type { ContactChannel } from "@/data/customers";
import { CUSTOMER_NAME_MAX, parseNewCustomer, suggestedChannel } from "@/lib/customer-rules";
import { send } from "@/lib/send-action";
import { addCustomerAction } from "@/server/actions/customers";

const CHANNEL_LABEL: Record<ContactChannel, string> = { SMS: "Text message (SMS)", Phone: "Phone call", Email: "Email" };
const CHANNELS = Object.keys(CHANNEL_LABEL) as ContactChannel[];

/**
 * Add a customer: a name, how to reach them, and how they prefer to be reached. It mounts only while open, so every open starts blank. Nothing is saved
 * until the form is sent; the server then checks it again, and on success the new customer's page opens.
 */
export function AddCustomerModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // null: follow what was entered (text a phone number, otherwise write to the email) until a channel is chosen.
  const [channel, setChannel] = useState<ContactChannel | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const preferred = channel ?? suggestedChannel(phone, email);

  // After a refused attempt, put the focus on the first thing to fix.
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  function refuse(fields: Record<string, string> | undefined, error: string) {
    const shown = fields ?? {};
    setErrors(shown);
    setProblem(Object.keys(shown).length > 0 ? undefined : error);
    setAttempt((count) => count + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const draft = { name, email, phone, preferredContact: preferred };
    const checked = parseNewCustomer(draft);
    if (!checked.ok) return refuse(checked.fields, checked.error);
    setErrors({});
    setProblem(undefined);
    setSaving(true);
    const result = await send(() => addCustomerAction(draft));
    setSaving(false);
    if (!result.ok) return refuse(result.fields, result.error);
    toast(`${checked.value.name} was added to your customers.`);
    onClose();
    router.push(customerHref(result.data.id));
    // The list and the pickers elsewhere (the review request, a new booking) read the business's customers from the server.
    router.refresh();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Add customer"
      description="Add someone you serve. You can add their service locations and equipment afterwards."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? "Adding…" : "Add customer"}
          </Button>
        </>
      }
    >
      <form id={formId} ref={formRef} onSubmit={submit} noValidate className="space-y-4">
        <Input label="Full name" required autoComplete="off" maxLength={CUSTOMER_NAME_MAX} value={name} error={errors.name} onChange={(event) => setName(event.target.value)} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Email address" type="email" autoComplete="off" maxLength={200} value={email} error={errors.email} onChange={(event) => setEmail(event.target.value)} />
          <Input label="Phone number" type="tel" autoComplete="off" maxLength={60} value={phone} error={errors.phone} onChange={(event) => setPhone(event.target.value)} />
        </div>
        <p className="-mt-2 text-xs text-ink-muted">An email address or a phone number is needed to reach them. Both help.</p>
        <Select label="Preferred contact" value={preferred} error={errors.preferredContact} onChange={(event) => setChannel(event.target.value as ContactChannel)}>
          {CHANNELS.map((option) => (
            <option key={option} value={option}>
              {CHANNEL_LABEL[option]}
            </option>
          ))}
        </Select>
        {problem && <FormAlert>{problem}</FormAlert>}
      </form>
    </Modal>
  );
}
