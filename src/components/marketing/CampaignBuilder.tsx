"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarClock, Eye, Megaphone, Plus, Send, Users } from "lucide-react";
import { useBusiness, useTimeZoneLabel } from "@/components/settings/SettingsProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { useUnsavedGuard } from "@/components/ui/UnsavedGuard";
import { getCustomerById } from "@/data/customers";
import {
  AUDIENCES,
  CAMPAIGN_STATUS_LABEL,
  CHANNEL_LABEL,
  DEFAULT_AUDIENCE,
  DEFAULT_SUBJECT,
  FIRST_NAME_HELPER,
  FIRST_NAME_TOKEN,
  SMS_LIMIT,
  defaultEmailMessage,
  defaultSmsMessage,
  formatCampaignTime,
  getAudience,
  getCampaignById,
  renderMessage,
  type AudienceId,
  type Campaign,
  type CampaignChannel,
  type CampaignInput,
} from "@/data/marketing";
import { addDays } from "@/lib/dates";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useCan, useClock } from "@/components/workspace/WorkspaceProvider";
import { useMarketing } from "./MarketingProvider";
import { RecipientsModal } from "./RecipientsModal";

/** How many people each audience reaches for each channel, read from the business's own customers by the server. */
export type AudienceSizes = Record<CampaignChannel, Record<Exclude<AudienceId, "selected">, number>>;

type Form = { name: string; channel: CampaignChannel; audienceId: AudienceId; selectedCustomerIds: string[]; subject: string; message: string };
type Timing = { mode: "now" | "later"; date: string; time: string };

/** The send time a new campaign opens with: five days from the business's today, at 9:00 AM. It is only a suggestion: it can be changed. */
const suggestedTiming = (today: string): Timing => ({ mode: "later", date: addDays(today, 5), time: "09:00" });

const startingForm = (businessName: string, campaign?: Campaign): Form =>
  campaign
    ? {
        name: campaign.name,
        channel: campaign.channel,
        audienceId: campaign.audienceId,
        selectedCustomerIds: [...(campaign.selectedCustomerIds ?? [])],
        subject: campaign.subject ?? "",
        message: campaign.message ?? "",
      }
    : { name: "", channel: "email", audienceId: DEFAULT_AUDIENCE.email, selectedCustomerIds: [], subject: DEFAULT_SUBJECT, message: defaultEmailMessage(businessName) };

const startingTiming = (today: string, campaign?: Campaign): Timing => {
  if (campaign?.status === "scheduled" && campaign.scheduledFor) {
    const [date, time] = campaign.scheduledFor.split("T");
    return { mode: "later", date, time };
  }
  return suggestedTiming(today);
};

/** Create campaign / Edit campaign, then Review & schedule. One flow for email and SMS, for new and existing campaigns. */
export function CampaignBuilder({ campaignId, audienceSizes }: { campaignId?: string; audienceSizes: AudienceSizes }) {
  const { data } = useMarketing();
  const canManage = useCan("marketing:manage");
  // The campaign as it was when this screen opened. Saving changes the stored campaign, and the screen must not turn into
  // "this campaign has been sent" in the moment before it moves on.
  const [existing] = useState(() => (campaignId ? getCampaignById(campaignId, data) : undefined));

  if (!canManage) {
    return (
      <EmptyState
        as="h1"
        icon={Megaphone}
        title="Only an owner or admin can change campaigns"
        description="You can view your business's campaigns, but creating and changing them needs an owner or admin."
        action={<ButtonLink href="/marketing">Back to Marketing</ButtonLink>}
      />
    );
  }
  if (campaignId && !existing) {
    return (
      <EmptyState
        as="h1"
        icon={Megaphone}
        title="Campaign not found"
        description="That campaign isn’t in your list. It may have been removed, or the link may be incorrect."
        action={<ButtonLink href="/marketing">Back to Marketing</ButtonLink>}
      />
    );
  }
  if (existing?.status === "sent") {
    return (
      <EmptyState
        as="h1"
        icon={Megaphone}
        title="This campaign has been sent"
        description="A sent campaign can’t be edited. Duplicate it to start a new draft from the same message."
        action={<ButtonLink href={`/marketing/${existing.id}`}>View campaign</ButtonLink>}
      />
    );
  }
  return <BuilderForm existing={existing} audienceSizes={audienceSizes} />;
}

function BuilderForm({ existing, audienceSizes }: { existing?: Campaign; audienceSizes: AudienceSizes }) {
  const dir = useDirectory();
  const business = useBusiness();
  const { today, now } = useClock();
  const { saveDraft, scheduleCampaign, sendCampaign } = useMarketing();
  const router = useRouter();
  const { toast } = useToast();
  const timeZone = useTimeZoneLabel();
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // What the form started as, so edits can be told from a form nobody has touched.
  const [initial] = useState(() => ({ form: startingForm(business.name, existing), timing: startingTiming(today, existing) }));
  const [form, setForm] = useState<Form>(initial.form);
  const [timing, setTiming] = useState<Timing>(initial.timing);
  const [stage, setStage] = useState<"compose" | "review">("compose");
  const [showErrors, setShowErrors] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [viewingRecipients, setViewingRecipients] = useState(false);
  const [tokenNote, setTokenNote] = useState<string>();
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string>();

  const dirty = JSON.stringify({ form, timing }) !== JSON.stringify(initial);
  const { guard, leave } = useUnsavedGuard(dirty, "your edits to this campaign");

  const email = form.channel === "email";
  const audience = getAudience(form.audienceId);
  // Customers with no email address (or no phone number) could not receive the campaign, so they are not counted.
  const chosen = dir.customers.filter((customer) => form.selectedCustomerIds.includes(customer.id) && (email ? customer.email : customer.phone));
  const recipients = form.audienceId === "selected" ? (chosen.length > 0 ? chosen.length : undefined) : audienceSizes[form.channel][form.audienceId];
  const sample = getCustomerById(form.selectedCustomerIds[0] ?? "", dir) ?? dir.customers[0];
  const destinationNote = email ? "Customers without an email address will not receive this campaign." : "Customers without a phone number will not receive this campaign.";
  // The recipient snapshot of a Scheduled campaign is shown as it is while the audience is unchanged; once edited, the audience as it resolves now.
  const audienceUnchanged =
    existing?.status === "scheduled" &&
    form.channel === initial.form.channel &&
    form.audienceId === initial.form.audienceId &&
    form.selectedCustomerIds.join(",") === initial.form.selectedCustomerIds.join(",");

  const patch = (change: Partial<Form>) => setForm((current) => ({ ...current, ...change }));

  /* ───────── validation ───────── */
  const composeErrors: Partial<Record<"name" | "audience" | "subject" | "message", string>> = {};
  if (!form.name.trim()) composeErrors.name = "Enter a campaign name.";
  if (form.audienceId === "selected") {
    if (form.selectedCustomerIds.length === 0) composeErrors.audience = "Choose at least one customer.";
    else if (chosen.length === 0) composeErrors.audience = `None of the chosen customers has ${email ? "an email address" : "a phone number"}.`;
  } else if (recipients === 0) composeErrors.audience = "No customers match this audience yet.";
  if (email && !form.subject.trim()) composeErrors.subject = "Enter a subject line.";
  if (!form.message.trim()) composeErrors.message = "Write the message.";
  const timingErrors: Partial<Record<"date" | "time", string>> = {};
  if (timing.mode === "later") {
    if (!timing.date) timingErrors.date = "Choose the date to send.";
    else if (timing.date < today) timingErrors.date = "Choose today or a later date.";
    if (!timing.time) timingErrors.time = "Choose the time to send.";
    else if (timing.date === today && `${timing.date}T${timing.time}` <= now) timingErrors.time = "Choose a time later than now.";
  }
  const shown = (message?: string) => (showErrors ? message : undefined);

  /* ───────── actions ───────── */
  function changeChannel(channel: CampaignChannel) {
    if (channel === form.channel) return;
    setForm((current) => {
      const starter = (on: CampaignChannel) => (on === "email" ? defaultEmailMessage(business.name) : defaultSmsMessage(business.name));
      const messageIsStarter = current.message === starter(current.channel);
      const audienceIsStarter = current.audienceId === DEFAULT_AUDIENCE[current.channel];
      return {
        ...current,
        channel,
        message: messageIsStarter ? starter(channel) : current.message,
        audienceId: audienceIsStarter ? DEFAULT_AUDIENCE[channel] : current.audienceId,
      };
    });
  }

  function insertToken() {
    const field = messageRef.current;
    const start = field?.selectionStart ?? form.message.length;
    const end = field?.selectionEnd ?? start;
    const next = form.message.slice(0, start) + FIRST_NAME_TOKEN + form.message.slice(end);
    if (!email && next.length > SMS_LIMIT) {
      setTokenNote(`There isn’t room for the token: a text message can be ${SMS_LIMIT} characters.`);
      return;
    }
    setTokenNote(undefined);
    patch({ message: next });
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + FIRST_NAME_TOKEN.length, start + FIRST_NAME_TOKEN.length);
    });
  }

  const input = (): CampaignInput => ({
    name: form.name,
    channel: form.channel,
    audienceId: form.audienceId,
    selectedCustomerIds: form.audienceId === "selected" ? form.selectedCustomerIds : [],
    subject: form.subject,
    message: form.message,
  });

  // An existing campaign is named together with the status this screen saw it in: a stale screen changes nothing.
  const target = existing && existing.status !== "sent" ? { id: existing.id, status: existing.status } : undefined;

  function continueToReview() {
    if (Object.keys(composeErrors).length > 0) return setShowErrors(true);
    setShowErrors(false);
    setStage("review");
  }

  async function saveAsDraft() {
    if (pending) return;
    if (composeErrors.name) {
      setStage("compose");
      return setShowErrors(true);
    }
    setPending(true);
    setServerError(undefined);
    const result = await saveDraft(target, input());
    setPending(false);
    if (!result.ok) return setServerError(result.error);
    toast("Draft saved.");
    router.push(`/marketing/${result.data.reference}`);
  }

  async function finish() {
    if (pending) return;
    if (Object.keys(composeErrors).length > 0) {
      setStage("compose");
      return setShowErrors(true);
    }
    if (Object.keys(timingErrors).length > 0) return setShowErrors(true);
    setPending(true);
    setServerError(undefined);
    if (timing.mode === "now") {
      const result = await sendCampaign(target, input());
      setPending(false);
      if (!result.ok) return setServerError(result.error);
      const sent = result.data.marketing.campaigns.find((campaign) => campaign.id === result.data.reference);
      toast(`Campaign recorded as sent to ${sent?.recipients ?? recipients ?? 0} recipients. Nothing was delivered.`);
      router.push(`/marketing/${result.data.reference}`);
    } else {
      const when = `${timing.date}T${timing.time}`;
      const result = await scheduleCampaign(target, input(), { mode: "later", date: timing.date, time: timing.time });
      setPending(false);
      if (!result.ok) return setServerError(result.error);
      toast(`Campaign scheduled for ${formatCampaignTime(when)}.`);
      router.push(`/marketing/${result.data.reference}`);
    }
  }

  const heading = existing ? "Edit campaign" : "Create campaign";

  return (
    <div className="space-y-6">
      <div>
        {stage === "review" ? (
          <button
            type="button"
            onClick={() => setStage("compose")}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-primary"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back to campaign details
          </button>
        ) : (
          <Link href="/marketing" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-primary">
            <ArrowLeft aria-hidden className="size-4" />
            Back to Marketing
          </Link>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{stage === "review" ? "Review & schedule campaign" : heading}</h1>
          {existing && <StatusBadge tone={existing.status === "scheduled" ? "warning" : "neutral"}>{CAMPAIGN_STATUS_LABEL[existing.status]}</StatusBadge>}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          {stage === "review"
            ? "Review your audience and message, and choose when to send."
            : `Set up ${email ? "an email" : "a text message"} campaign to communicate with existing customers.`}
        </p>
      </div>

      {stage === "compose" ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-6">
            <section aria-labelledby="details-heading" className={cardClasses("lg", "space-y-5")}>
              <h2 id="details-heading" className="text-base font-semibold text-ink">
                1. Campaign details
              </h2>
              <Input
                label="Campaign name"
                required
                value={form.name}
                hint="Internal campaign name for your records."
                error={shown(composeErrors.name)}
                onChange={(event) => patch({ name: event.target.value })}
              />
              <OptionGroup legend="Channel" hint="Choose how this campaign will be sent." className="sm:grid-cols-2">
                <OptionCard
                  type="radio"
                  name="channel"
                  title="Email"
                  description="Send via customer email addresses."
                  checked={email}
                  onChange={() => changeChannel("email")}
                />
                <OptionCard
                  type="radio"
                  name="channel"
                  title="SMS"
                  description="Send via customer mobile phone numbers."
                  checked={!email}
                  onChange={() => changeChannel("sms")}
                />
              </OptionGroup>
            </section>

            <section aria-labelledby="audience-heading" className={cardClasses("lg", "space-y-4")}>
              <div>
                <h2 id="audience-heading" className="text-base font-semibold text-ink">
                  2. Audience
                </h2>
                <p className="mt-0.5 text-sm text-ink-muted">Choose which existing customers should receive this campaign.</p>
              </div>
              <OptionGroup legend="Audience">
                {AUDIENCES.map((item) => (
                  <OptionCard
                    key={item.id}
                    type="radio"
                    name="audience"
                    title={item.label}
                    badge={item.id !== "selected" && <span className="text-xs font-normal text-ink-muted">{audienceSizes[form.channel][item.id]} customers</span>}
                    description={item.description}
                    checked={form.audienceId === item.id}
                    onChange={() => patch({ audienceId: item.id })}
                  />
                ))}
              </OptionGroup>
              {form.audienceId === "selected" && (
                <fieldset className="rounded-card bg-surface-low p-4">
                  <legend className="px-1 text-xs font-medium text-ink">Choose customers</legend>
                  <ul className="space-y-2">
                    {dir.customers.map((customer) => (
                      <li key={customer.id}>
                        <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={form.selectedCustomerIds.includes(customer.id)}
                            onChange={(event) =>
                              patch({
                                selectedCustomerIds: event.target.checked
                                  ? [...form.selectedCustomerIds, customer.id]
                                  : form.selectedCustomerIds.filter((id) => id !== customer.id),
                              })
                            }
                          />
                          {customer.name}
                          <span className="text-xs text-ink-muted">{email ? customer.email : customer.phone}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {shown(composeErrors.audience) && (
                    <p role="alert" className="mt-2 text-xs text-danger">
                      {composeErrors.audience}
                    </p>
                  )}
                </fieldset>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-low p-4">
                <div>
                  <p className="text-sm font-semibold text-ink">{recipients === undefined ? "No recipients yet" : `${recipients} recipients`}</p>
                  <p className="text-xs text-ink-muted">{recipients === undefined ? "Choose who should receive this campaign." : `${recipients} customers match ${audience.label.toLowerCase()}.`}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setViewingRecipients(true)}>
                  <Users aria-hidden className="size-3.5" />
                  View recipients
                </Button>
              </div>
              {form.audienceId !== "selected" && shown(composeErrors.audience) && (
                <p role="alert" className="text-xs text-danger">
                  {composeErrors.audience}
                </p>
              )}
              <p className="text-xs text-ink-muted">{destinationNote}</p>
            </section>

            <section aria-labelledby="message-heading" className={cardClasses("lg", "space-y-4")}>
              <h2 id="message-heading" className="text-base font-semibold text-ink">
                3. Message ({CHANNEL_LABEL[form.channel]})
              </h2>
              {email && (
                <Input
                  label="Subject line"
                  required
                  value={form.subject}
                  error={shown(composeErrors.subject)}
                  onChange={(event) => patch({ subject: event.target.value })}
                />
              )}
              <Textarea
                ref={messageRef}
                label={email ? "Message content" : "Message text"}
                required
                rows={email ? 8 : 4}
                maxLength={email ? undefined : SMS_LIMIT}
                value={form.message}
                error={shown(composeErrors.message)}
                hint={email ? `Your ${business.name} signature will be added.` : `${form.message.length} / ${SMS_LIMIT} characters`}
                onChange={(event) => patch({ message: event.target.value })}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-btn bg-surface-low px-3 py-2 text-xs">
                <span className="flex flex-wrap items-center gap-2 text-ink-muted">
                  <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink">{FIRST_NAME_TOKEN}</code>
                  {FIRST_NAME_HELPER}
                </span>
                <Button variant="tertiary" size="sm" onClick={insertToken}>
                  <Plus aria-hidden className="size-3.5" />
                  Insert token
                </Button>
              </div>
              {tokenNote && (
                <p role="alert" className="text-xs text-danger">
                  {tokenNote}
                </p>
              )}
              <div>
                <Button variant="secondary" size="sm" onClick={() => setPreviewing((value) => !value)} aria-expanded={previewing}>
                  <Eye aria-hidden className="size-3.5" />
                  {previewing ? "Hide preview" : email ? "Preview email" : "Preview message"}
                </Button>
                {previewing && (
                  <div role="region" aria-label="Message preview" className="mt-3 rounded-card border border-line p-4">
                    <p className="text-xs text-ink-muted">Preview for {sample?.name ?? "a customer"}</p>
                    {email && <p className="mt-2 text-sm font-semibold text-ink">{form.subject}</p>}
                    <p className="mt-2 text-sm whitespace-pre-line text-ink">{renderMessage(form.message, sample?.name.split(" ")[0])}</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside aria-label="Campaign summary" className={cardClasses("lg", "space-y-4 xl:sticky xl:top-24 xl:self-start")}>
            <h2 className="text-base font-semibold text-ink">Campaign summary</h2>
            <KeyValueList
              items={[
                { label: "Channel", value: CHANNEL_LABEL[form.channel] },
                { label: "Audience segment", value: audience.label },
                { label: "Estimated count", value: recipients === undefined ? "—" : `${recipients} contacts` },
              ]}
            />
            <p className="text-xs text-ink-muted">{destinationNote}</p>
          </aside>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-6">
            <section aria-labelledby="timing-heading" className={cardClasses("lg", "space-y-4")}>
              <h2 id="timing-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
                <CalendarClock aria-hidden className="size-5 text-primary" />
                Send timing
              </h2>
              <p className="rounded-btn bg-surface-low px-3 py-2 text-xs text-ink-muted">
                Sending records this campaign and who it is for. Climvia does not deliver email or text messages yet, so nothing reaches your customers from here.
              </p>
              <OptionGroup legend="When should this campaign go out?">
                <OptionCard
                  type="radio"
                  name="timing"
                  title="Send now"
                  description="Send immediately upon confirmation."
                  checked={timing.mode === "now"}
                  onChange={() => setTiming((current) => ({ ...current, mode: "now" }))}
                />
                <OptionCard
                  type="radio"
                  name="timing"
                  title="Schedule for later"
                  description="Pick a date and time to send this campaign."
                  checked={timing.mode === "later"}
                  onChange={() => setTiming((current) => ({ ...current, mode: "later" }))}
                />
              </OptionGroup>
              {timing.mode === "later" && (
                <div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      label="Date"
                      type="date"
                      required
                      min={today}
                      value={timing.date}
                      error={shown(timingErrors.date)}
                      onChange={(event) => setTiming((current) => ({ ...current, date: event.target.value }))}
                    />
                    <Input
                      label="Time"
                      type="time"
                      required
                      value={timing.time}
                      error={shown(timingErrors.time)}
                      onChange={(event) => setTiming((current) => ({ ...current, time: event.target.value }))}
                    />
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">Uses your business local time. {timeZone}.</p>
                </div>
              )}
            </section>

            <section aria-labelledby="summary-heading" className={cardClasses("lg", "space-y-4")}>
              <div className="flex items-center justify-between gap-3">
                <h2 id="summary-heading" className="text-base font-semibold text-ink">
                  Campaign summary
                </h2>
                <Button variant="tertiary" size="sm" onClick={() => setStage("compose")}>
                  Edit content
                </Button>
              </div>
              <KeyValueList
                items={[
                  { label: "Campaign name", value: form.name },
                  { label: "Channel", value: CHANNEL_LABEL[form.channel] },
                  { label: "Target audience", value: audience.label },
                  { label: "Recipients", value: recipients === undefined ? "—" : `${recipients} recipients` },
                  ...(email ? [{ label: "Subject line", value: form.subject }] : []),
                ]}
              />
              <div className="rounded-card bg-surface-low p-4">
                <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Message preview</p>
                <p className="mt-2 text-sm whitespace-pre-line text-ink">{form.message}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setViewingRecipients(true)}>
                <Users aria-hidden className="size-3.5" />
                View recipients
              </Button>
            </section>
          </div>

          <aside aria-label="What happens next" className={cardClasses("lg", "space-y-2 xl:self-start")}>
            <h2 className="text-base font-semibold text-ink">What happens next</h2>
            <p className="text-sm text-ink-muted">
              {timing.mode === "now"
                ? `The campaign is sent to ${recipients ?? 0} recipients as soon as you confirm.`
                : `The campaign is sent to ${recipients ?? 0} recipients at the time you choose. Until then you can edit it or cancel the scheduled send.`}
            </p>
            <p className="text-xs text-ink-muted">{destinationNote}</p>
          </aside>
        </div>
      )}

      {serverError && (
        <p role="alert" className="rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">
          {serverError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        {stage === "review" ? (
          <Button variant="secondary" onClick={() => setStage("compose")}>
            <ArrowLeft aria-hidden className="size-4" />
            Back
          </Button>
        ) : (
          <Button variant="tertiary" onClick={() => leave("/marketing")}>
            Discard
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={saveAsDraft} disabled={pending}>
            Save draft
          </Button>
          {stage === "compose" ? (
            <Button onClick={continueToReview} disabled={pending}>
              Continue to review &amp; timing
              <ArrowRight aria-hidden className="size-4" />
            </Button>
          ) : (
            <Button onClick={finish} disabled={pending}>
              <Send aria-hidden className="size-4" />
              {timing.mode === "now" ? "Send campaign" : "Schedule campaign"}
            </Button>
          )}
        </div>
      </div>
      {existing?.status === "scheduled" && (
        <p className="text-xs text-ink-muted">This campaign is scheduled. Saving it as a draft cancels the scheduled send.</p>
      )}

      {viewingRecipients && (
        <RecipientsModal
          channel={form.channel}
          audienceId={form.audienceId}
          selectedCustomerIds={form.selectedCustomerIds}
          count={recipients}
          campaignId={audienceUnchanged ? existing?.id : undefined}
          onClose={() => setViewingRecipients(false)}
        />
      )}
      {guard}
    </div>
  );
}
