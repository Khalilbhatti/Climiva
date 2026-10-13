/**
 * The canonical Marketing records of the Apex sample business: eleven campaigns (2 Drafts, 1 Scheduled, 8 Sent), the recipient
 * snapshot and delivery result the approved Sent campaign screen shows, and the recipients' contact details.
 *
 * Seed data only. Nothing under src imports this file, and a test checks that none of it reaches the browser's JavaScript.
 * Campaigns are written through the same function the application's reads use (src/db/marketing-queries), as history the product
 * carries in: statuses, times, recipient counts and delivery results exactly as the approved screens show them.
 *
 * The first five campaigns are the approved Stitch ones, in the order the screens list them. The other six (one more Draft and
 * five older Sent campaigns, all sent more than 60 days before the sample day) make the workspace totals (2 Drafts, 1 Scheduled,
 * 8 Sent, 146 recent recipients) counts of stored campaigns rather than numbers written on a screen. They are deliberately plain:
 * a name, a channel, an audience, a short message and the day they went out; no delivery results were kept for them.
 *
 * Recipient snapshots: the Sent "Cooling tune-up reminder" lists 6 of its 42 recipients (the two that were not delivered and
 * some that were) with the delivery result recorded for each; the other campaigns' recipients are counted, not listed.
 */
import { DEFAULT_SUBJECT, FIRST_NAME_TOKEN, defaultEmailMessage, defaultSmsMessage } from "../../../src/data/marketing";
import type { SeedCampaign, SeedMarketing, SeedRecipient } from "../../../src/db/marketing-queries";
import { business } from "./apex";
import { CUSTOMERS } from "./customers";

const BUSINESS = business.name;
const EMAIL = defaultEmailMessage(BUSINESS);
const SMS = defaultSmsMessage(BUSINESS);

const customer = (slug: string) => {
  const found = CUSTOMERS.find((item) => item.id === slug);
  if (!found) throw new Error(`Unknown customer "${slug}".`);
  return found;
};

/** A recipient who is a Customers record: the snapshot takes the name and phone the record has. */
const known = (slug: string, status: SeedRecipient["status"], at: string): SeedRecipient => ({
  customerId: slug,
  name: customer(slug).name,
  phone: customer(slug).phone,
  status,
  at,
});

/** A recipient with no Customers record: just a name and a contact. */
const contact = (name: string, phone: string, status: SeedRecipient["status"], at: string): SeedRecipient => ({ name, phone, status, at });

const COOLING_RECIPIENTS: readonly SeedRecipient[] = [
  known("david-chen", "delivered", "2024-10-18T10:15"),
  known("sarah-mitchell", "delivered", "2024-10-18T10:15"),
  contact("Robert Garcia", "(555) 441-2098", "delivered", "2024-10-18T10:15"),
  { ...contact("Linda Zhao", "(555) 782-9904", "not-delivered", "2024-10-18T10:16"), failureReason: "The number could not be reached" },
  contact("James Wilson", "(555) 883-1200", "delivered", "2024-10-18T10:15"),
  { ...contact("Marcus Sterling", "(555) 310-7742", "not-delivered", "2024-10-18T10:16"), failureReason: "The number could not be reached" },
];

const APPROVED: readonly SeedCampaign[] = [
  {
    id: "cmp-fall-maintenance-reminder",
    name: "Fall maintenance reminder",
    summary: "Pre-season tune-up scheduling",
    channel: "email",
    audienceId: "due-for-maintenance",
    recipients: 38,
    subject: DEFAULT_SUBJECT,
    message: EMAIL,
    status: "scheduled",
    scheduledFor: "2024-10-30T09:00",
  },
  {
    id: "cmp-cooling-tune-up-reminder",
    name: "Cooling tune-up reminder",
    summary: "AC final maintenance checklist",
    channel: "sms",
    audienceId: "maintenance-customers",
    recipients: 42,
    message: SMS,
    status: "sent",
    sentAt: "2024-10-18T10:15",
    delivery: { delivered: 40, notDelivered: 2 },
    recipientRows: COOLING_RECIPIENTS,
  },
  {
    id: "cmp-seasonal-service-reminder",
    name: "Seasonal service reminder",
    summary: "Early heating audit offer",
    channel: "email",
    audienceId: "selected",
    selectedCustomerIds: [],
    status: "draft",
  },
  {
    id: "cmp-winter-heating-prep-notice",
    name: "Winter heating prep notice",
    summary: "Furnace diagnostics protocol",
    channel: "email",
    audienceId: "all-customers",
    recipients: 48,
    status: "sent",
    sentAt: "2024-10-05",
  },
  {
    id: "cmp-filter-replacement-reminder",
    name: "Filter replacement reminder",
    summary: "Quarterly filter renewal notice",
    channel: "sms",
    audienceId: "active-plans",
    recipients: 18,
    status: "sent",
    sentAt: "2024-09-22",
  },
];

/** The history that makes the workspace totals counts of stored campaigns. */
const HISTORY: readonly SeedCampaign[] = [
  {
    id: "cmp-heat-pump-efficiency-tips",
    name: "Heat pump efficiency tips",
    summary: "Getting more from a heat pump",
    channel: "email",
    audienceId: "all-customers",
    recipients: 146,
    subject: "Get more from your heat pump this winter",
    message: `Hi ${FIRST_NAME_TOKEN},\n\nA few simple habits keep a heat pump efficient all winter. Reply to this email or book online with ${BUSINESS} if you would like a check-up.`,
    status: "draft",
  },
  {
    id: "cmp-spring-ac-check-up-offer",
    name: "Spring AC check-up offer",
    summary: "Early-season cooling check",
    channel: "email",
    audienceId: "all-customers",
    recipients: 52,
    subject: "Book your spring AC check-up",
    message: `Hi ${FIRST_NAME_TOKEN},\n\nSpring is the best time to have your air conditioning checked before the heat arrives. Book a visit with ${BUSINESS} online.`,
    status: "sent",
    sentAt: "2024-04-09",
  },
  {
    id: "cmp-heat-pump-seasonal-care",
    name: "Heat pump seasonal care",
    summary: "Seasonal heat pump reminder",
    channel: "email",
    audienceId: "maintenance-customers",
    recipients: 29,
    subject: "Seasonal care for your heat pump",
    message: `Hi ${FIRST_NAME_TOKEN},\n\nA seasonal visit keeps your heat pump running well. ${BUSINESS} can schedule one at a time that suits you.`,
    status: "sent",
    sentAt: "2024-05-02",
  },
  {
    id: "cmp-pre-summer-tune-up-reminder",
    name: "Pre-summer tune-up reminder",
    summary: "Last call before the heat",
    channel: "sms",
    audienceId: "maintenance-customers",
    recipients: 35,
    message: `Hi ${FIRST_NAME_TOKEN}, this is ${BUSINESS}. Book your pre-summer tune-up in Climvia before the heat arrives.`,
    status: "sent",
    sentAt: "2024-05-21",
  },
  {
    id: "cmp-summer-cooling-safety-tips",
    name: "Summer cooling safety tips",
    summary: "Staying cool safely",
    channel: "email",
    audienceId: "all-customers",
    recipients: 47,
    subject: "Keep your home cool and safe this summer",
    message: `Hi ${FIRST_NAME_TOKEN},\n\nA few safety tips for running your air conditioning through the hottest weeks, from the team at ${BUSINESS}.`,
    status: "sent",
    sentAt: "2024-06-18",
  },
  {
    id: "cmp-maintenance-plan-renewal-notice",
    name: "Maintenance plan renewal notice",
    summary: "Plans coming up for renewal",
    channel: "email",
    audienceId: "active-plans",
    recipients: 14,
    subject: "Your maintenance plan is coming up for renewal",
    message: `Hi ${FIRST_NAME_TOKEN},\n\nYour maintenance plan with ${BUSINESS} is coming up for renewal. Reply to this email and we will take care of it.`,
    status: "sent",
    sentAt: "2024-07-10",
  },
];

export const MARKETING: SeedMarketing = { campaigns: [...APPROVED, ...HISTORY] };

/** The Sent campaign whose recipients and delivery result the approved screen shows. */
export const COOLING_TUNE_UP_RECIPIENTS = COOLING_RECIPIENTS;
