"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarX, Copy, Megaphone, Pencil, Users } from "lucide-react";
import { useTimeZoneLabel } from "@/components/settings/SettingsProvider";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { BackLink } from "@/components/ui/BackLink";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal } from "@/components/ui/Modal";
import { SectionCard } from "@/components/ui/SectionCard";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { customerHref } from "@/config/routes";
import {
  CHANNEL_LABEL,
  DELIVERY_STATUS_LABEL,
  FIRST_NAME_TOKEN,
  formatCampaignTime,
  getCampaignById,
  type Campaign,
  type CampaignRecipient,
  type DeliveryStatus,
} from "@/data/marketing";
import { formatTime } from "@/lib/dates";
import { useMarketing } from "./MarketingProvider";
import { RecipientsModal } from "./RecipientsModal";
import { CampaignStatusBadge, ChannelBadge, DeliveryBadge, audienceName, recipientsText } from "./marketing-ui";

/** The message with its first-name token marked, as the approved screens show it. */
function Message({ text }: { text?: string }) {
  if (!text) return <p className="text-sm text-ink-muted">No message has been written yet.</p>;
  const parts = text.split(FIRST_NAME_TOKEN);
  return (
    <p className="text-sm whitespace-pre-line text-ink">
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && <code className="rounded bg-primary-subtle px-1 py-0.5 font-mono text-xs text-primary">{FIRST_NAME_TOKEN}</code>}
        </span>
      ))}
    </p>
  );
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className={cardClasses("md")}>
      <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
    </div>
  );
}

/**
 * A Sent campaign. Where a delivery result was recorded (the sample business's earlier sends) it shows the recipients' snapshot with
 * the result for each; a campaign sent from here records who it went to, but no delivery result (nothing is delivered).
 */
function SentDetail({ campaign, records }: { campaign: Campaign; records: readonly CampaignRecipient[] }) {
  const [filter, setFilter] = useState<"all" | DeliveryStatus>("all");
  const [viewing, setViewing] = useState(false);
  const delivery = campaign.delivery;
  const rows = records.filter((record) => record.status !== "pending" && (filter === "all" || record.status === filter));
  const total = campaign.recipients ?? 0;
  const tabCount = filter === "all" ? total : filter === "delivered" ? (delivery?.delivered ?? 0) : (delivery?.notDelivered ?? 0);

  return (
    <>
      <section aria-label="Campaign results" className={`grid grid-cols-2 gap-4 ${delivery ? "lg:grid-cols-4" : "lg:grid-cols-2"}`}>
        <Tile label="Recipients" value={total} hint="Total targeted contacts" />
        <Tile label="Sent" value={total} hint="Messages sent" />
        {delivery && <Tile label="Delivered" value={delivery.delivered} hint="Messages delivered" />}
        {delivery && <Tile label="Not delivered" value={delivery.notDelivered} hint="Messages not delivered" />}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <SectionCard title="Campaign details">
            <KeyValueList
              items={[
                { label: "Channel", value: <ChannelBadge channel={campaign.channel} /> },
                { label: "Sent date", value: campaign.sentAt ? formatCampaignTime(campaign.sentAt) : "—" },
                { label: "Audience", value: audienceName(campaign) },
              ]}
            />
            {campaign.channel === "email" && campaign.subject && (
              <div className="mt-4">
                <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Subject</p>
                <p className="mt-1 text-sm text-ink">{campaign.subject}</p>
              </div>
            )}
            {campaign.message && (
              <div className="mt-4">
                <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Message</p>
                <div className="mt-1 rounded-card bg-surface-low p-3">
                  <Message text={campaign.message} />
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="lg:col-span-8">
          {delivery ? (
            <SectionCard title={`Delivery records (${total})`} description="Delivery status for campaign recipients">
              <Tabs
                label="Delivery status"
                idPrefix="delivery"
                variant="segmented"
                value={filter}
                onChange={(id) => setFilter(id as "all" | DeliveryStatus)}
                tabs={[
                  { id: "all", label: "All", count: total },
                  { id: "delivered", label: "Delivered", count: delivery.delivered },
                  { id: "not-delivered", label: "Not delivered", count: delivery.notDelivered },
                ]}
              />
              <div role="tabpanel" id={`delivery-panel-${filter}`} aria-labelledby={`delivery-tab-${filter}`} className="mt-4 space-y-3">
                <Table aria-label="Delivery records">
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Customer</TableHeaderCell>
                      <TableHeaderCell>Destination</TableHeaderCell>
                      <TableHeaderCell>Delivery status</TableHeaderCell>
                      <TableHeaderCell>Time</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {rows.map((record, index) => {
                      const [date, time] = (record.at ?? "").split("T");
                      return (
                        <TableRow key={`${record.name}-${index}`}>
                          <TableCell>
                            {record.customerId ? (
                              <Link href={customerHref(record.customerId)} className="font-medium text-ink hover:text-primary hover:underline">
                                {record.name}
                              </Link>
                            ) : (
                              <span className="font-medium">{record.name}</span>
                            )}
                            {record.status === "not-delivered" && <p className="mt-0.5 text-xs text-danger">The message could not be delivered to this contact.</p>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-ink-muted">{(campaign.channel === "email" ? record.email : record.phone) ?? ""}</TableCell>
                          <TableCell>
                            <DeliveryBadge status={record.status as DeliveryStatus} />
                          </TableCell>
                          <TableCell className="text-ink-muted">{date && time ? `${formatCampaignTime(date)} · ${formatTime(time)}` : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p aria-live="polite" className="text-xs text-ink-muted">
                  Showing {rows.length} sample records of {tabCount} {filter === "all" ? "recipients" : DELIVERY_STATUS_LABEL[filter].toLowerCase()}
                </p>
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="Delivery records">
              <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">Delivery records aren’t kept for this campaign.</p>
              <div className="mt-3">
                <Button variant="secondary" size="sm" onClick={() => setViewing(true)}>
                  <Users aria-hidden className="size-3.5" />
                  View recipients
                </Button>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
      {viewing && <RecipientsModal channel={campaign.channel} audienceId={campaign.audienceId} count={campaign.recipients} campaignId={campaign.id} onClose={() => setViewing(false)} />}
    </>
  );
}

export function CampaignDetail({ campaignId, deliveryRecords = [] }: { campaignId: string; deliveryRecords?: readonly CampaignRecipient[] }) {
  const { data, cancelSchedule, duplicateCampaign } = useMarketing();
  const router = useRouter();
  const { toast } = useToast();
  const timeZone = useTimeZoneLabel();
  const canManage = useCan("marketing:manage");
  const [cancelling, setCancelling] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const campaign = getCampaignById(campaignId, data);

  if (!campaign) {
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

  const scheduled = campaign.status === "scheduled";
  const sent = campaign.status === "sent";

  async function duplicate() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    const result = await duplicateCampaign(campaign!.id);
    setPending(false);
    if (!result.ok) return setError(result.error);
    toast(`Draft created from ${campaign!.name}.`);
    router.push(`/marketing/${result.data.reference}`);
  }

  async function confirmCancel() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    const result = await cancelSchedule(campaign!.id);
    setPending(false);
    setCancelling(false);
    if (!result.ok) return setError(result.error);
    toast("Scheduled send cancelled. The campaign is now a Draft.");
  }

  return (
    <>
      <BackLink href="/marketing">Back to Marketing</BackLink>

      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">{campaign.name}</h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          {campaign.summary && <p className="text-sm text-ink-muted">{campaign.summary}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {scheduled && canManage && (
            <Button variant="secondary" onClick={() => setCancelling(true)} disabled={pending}>
              <CalendarX aria-hidden className="size-4" />
              Cancel scheduled send
            </Button>
          )}
          {!sent && canManage && (
            <ButtonLink href={`/marketing/${campaign.id}/edit`}>
              <Pencil aria-hidden className="size-4" />
              Edit campaign
            </ButtonLink>
          )}
          {sent && canManage && (
            <Button variant="secondary" onClick={duplicate} disabled={pending}>
              <Copy aria-hidden className="size-4" />
              Duplicate campaign
            </Button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {sent ? (
        <SentDetail campaign={campaign} records={deliveryRecords} />
      ) : (
        <>
          <section aria-label="Campaign summary" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Tile label="Channel" value={CHANNEL_LABEL[campaign.channel]} hint={campaign.channel === "email" ? "Sent to customer email addresses" : "Sent to customer phone numbers"} />
            <Tile label="Audience" value={recipientsText(campaign)} hint={`${audienceName(campaign)} · recipients`} />
            <Tile
              label={scheduled ? "Scheduled send" : "Send date"}
              value={scheduled && campaign.scheduledFor ? formatCampaignTime(campaign.scheduledFor) : "Not scheduled"}
              hint={scheduled ? `${timeZone}, your business local time` : "Schedule it from Edit campaign"}
            />
          </section>

          {scheduled && campaign.scheduledFor && (
            <div className="space-y-3 rounded-card bg-surface-low p-4 text-sm text-ink-muted">
              <p>
                This campaign will be sent to {campaign.recipients} customers on {formatCampaignTime(campaign.scheduledFor)}.
                {canManage ? " You can edit the campaign or cancel the scheduled send at any time before then." : " Only an owner or admin can change it."}
              </p>
              <Button variant="secondary" size="sm" onClick={() => setViewing(true)}>
                <Users aria-hidden className="size-3.5" />
                View recipients
              </Button>
            </div>
          )}

          <SectionCard title="Message details">
            <div className="space-y-4">
              {campaign.channel === "email" && (
                <div>
                  <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Subject</p>
                  <p className="mt-1 text-sm text-ink">{campaign.subject ?? "No subject yet"}</p>
                </div>
              )}
              <div>
                <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Message</p>
                <div className="mt-1 rounded-card bg-surface-low p-3">
                  <Message text={campaign.message} />
                </div>
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {viewing && scheduled && (
        <RecipientsModal channel={campaign.channel} audienceId={campaign.audienceId} count={campaign.recipients} campaignId={campaign.id} onClose={() => setViewing(false)} />
      )}

      {cancelling && scheduled && campaign.scheduledFor && (
        <Modal
          open
          onClose={() => setCancelling(false)}
          title="Cancel scheduled campaign?"
          description="This campaign will remain saved as a Draft and will not be sent at the scheduled time."
          footer={
            <>
              <Button variant="secondary" onClick={() => setCancelling(false)}>
                Keep scheduled
              </Button>
              <Button variant="destructive-solid" onClick={confirmCancel} disabled={pending}>
                Cancel scheduled send
              </Button>
            </>
          }
        >
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Campaign", value: campaign.name },
              { label: "Channel", value: CHANNEL_LABEL[campaign.channel] },
              { label: "Recipients", value: recipientsText(campaign) },
              { label: "Scheduled send", value: formatCampaignTime(campaign.scheduledFor) },
            ]}
          />
          <p className="text-xs text-ink-muted">You can edit the campaign, reschedule it, or send it later from Drafts.</p>
        </Modal>
      )}
    </>
  );
}
