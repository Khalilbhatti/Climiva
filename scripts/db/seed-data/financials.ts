/**
 * The canonical Apex Climate financial records: quotes, invoices and payments.
 *
 * SEED AND TEST INFRASTRUCTURE ONLY (nothing in src/ imports this file, so none of it is compiled into a browser bundle).
 * scripts/db/seed-lib.ts writes it to PostgreSQL for the sample business, with deterministic ids; the specs read it as the expected
 * record. The money is the baseline the audit board locked ("post-#PAY-1008": 7 payments, $2,130 received, 2 open invoices, $680
 * balance); every conflict in the design source is listed in docs/stitch-screen-map.md §9. In short:
 *
 *  - INV-1044 is fully paid by PAY-1008 and is NOT linked to QT-884 (the source contradicted itself; the link is not restored).
 *    PAY-1001 is the historical payment recorded by mistake and voided: it counts toward nothing.
 *  - INV-1050 ($500) shows $200 already paid on the Stitch screens, but no payment record backs it and the approved received total
 *    ($2,130) is exactly the seven active payments. Adding a $200 payment would make the baseline 8 payments and $2,330. So the $200
 *    is carried on the invoice as `previouslyPaid` (money received before payment records were kept), and the invoice is marked
 *    `imported`: it belongs to the history this system did not record itself. It is not invented as a payment.
 *  - Every invoice here is `imported`: together they are part of the $6,240 "Total Invoiced" reporting baseline, which covers more
 *    invoicing history than these nine records. Invoices created after the seed add to it.
 *  - People without a Customers record (Kevin Vance, Arthur Pendleton, Maya Lin…) are a `contactName` snapshot, the same
 *    pattern bookings and jobs use.
 *
 * Dollars here are the display values the screens use; the database stores whole cents (src/lib/money).
 */
import type { FinancialData, Invoice, LineItem, Payment, PaymentMethod, Quote } from "@/data/financials";

/** QT-884 and the Stitch invoice screens share these three lines ($285.00 in all). */
const CAPACITOR_JOB_LINES: readonly LineItem[] = [
  {
    id: "line-1",
    description: "Titan HD 45/5 µF 440V Dual Run Capacitor",
    detail: "Replacement dual run capacitor for outdoor condensing unit",
    quantity: 1,
    rate: 89.5,
  },
  {
    id: "line-2",
    description: "Diagnostic & Compressor Electrical Recovery Labor",
    detail: "Diagnostic testing, capacitor replacement, wiring inspection and system restart verification",
    quantity: 1.5,
    unit: "hrs",
    rate: 130,
  },
  { id: "line-3", description: "Rounding adjustment", detail: "Standard balance adjustment", quantity: 1, rate: 0.5 },
];

/** A single-line item for records where Stitch only gives a description and a total. Lines are numbered from 1 within their document. */
const oneLine = (description: string, rate: number): readonly LineItem[] => [{ id: "line-1", description, quantity: 1, rate }];

export const QUOTES: readonly Quote[] = [
  {
    id: "QT-884",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: "ac-repair-diagnostics",
    jobId: "JB-204",
    bookingId: "BK-1042",
    status: "approved",
    lineItems: CAPACITOR_JOB_LINES,
    createdOn: "2024-10-24",
    approvedOn: "2024-10-24",
    validThrough: "2024-11-23",
    updatedOn: "2024-10-24",
    message:
      "Recommended replacement of the failed dual run capacitor identified during AC diagnostic service. The quoted amount includes the replacement part and installation labor.",
    activity: [
      { label: "Quote approved", on: "2024-10-24" },
      { label: "Quote sent", on: "2024-10-24" },
      { label: "Quote created", on: "2024-10-24" },
    ],
  },
  {
    id: "QT-891",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    serviceId: "heat-pump-diagnostics-repair",
    status: "sent",
    lineItems: oneLine("Heat Pump Diagnostics & Repair", 1240),
    createdOn: "2024-10-23",
    updatedOn: "2024-10-23",
    activity: [
      { label: "Quote sent", on: "2024-10-23" },
      { label: "Quote created", on: "2024-10-23" },
    ],
  },
  {
    id: "QT-893",
    contactName: "Claire Dubois",
    serviceId: "heat-pump-diagnostics-repair",
    status: "draft",
    lineItems: oneLine("Heat Pump Diagnostics & Repair", 4850),
    createdOn: "2024-10-24",
    updatedOn: "2024-10-24",
    activity: [{ label: "Quote created", on: "2024-10-24" }],
  },
  {
    id: "QT-879",
    customerId: "bradley-cooper",
    propertyId: "prop-bradley-bungalow",
    serviceId: "annual-cooling-tune-up",
    status: "declined",
    lineItems: oneLine("Annual Cooling Tune-Up & Maintenance", 195),
    createdOn: "2024-10-17",
    updatedOn: "2024-10-18",
    activity: [
      { label: "Quote declined", on: "2024-10-18" },
      { label: "Quote sent", on: "2024-10-17" },
      { label: "Quote created", on: "2024-10-17" },
    ],
  },
];

const GENERIC_LINE = "HVAC service visit";

/** Every canonical invoice is carried in from before this system kept its own records (see the header). */
const imported = { imported: true } as const;

export const INVOICES: readonly Invoice[] = [
  { id: "INV-1043", contactName: "Kevin Vance", date: "2024-10-25", terms: "due-on-receipt", lineItems: oneLine(GENERIC_LINE, 285), ...imported },
  {
    id: "INV-1044",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: "ac-repair-diagnostics",
    jobId: "JB-204",
    bookingId: "BK-1042",
    date: "2024-10-25",
    terms: "due-on-receipt",
    lineItems: CAPACITOR_JOB_LINES,
    message: "Thank you for choosing Apex Climate Heating & Air. This invoice covers the approved AC Repair & Diagnostics work.",
    ...imported,
  },
  { id: "INV-1045", contactName: "Amanda Diaz", date: "2024-10-25", terms: "due-on-receipt", lineItems: oneLine(GENERIC_LINE, 400), ...imported },
  { id: "INV-1046", contactName: "Marcus Bell", date: "2024-10-26", terms: "due-on-receipt", lineItems: oneLine(GENERIC_LINE, 180), ...imported },
  { id: "INV-1047", contactName: "Robert Miller", date: "2024-10-26", terms: "due-on-receipt", lineItems: oneLine(GENERIC_LINE, 210), ...imported },
  {
    id: "INV-1048",
    customerId: "elena-rodriguez",
    propertyId: "prop-elena-condo",
    date: "2024-10-26",
    terms: "due-on-receipt",
    lineItems: oneLine(GENERIC_LINE, 450),
    ...imported,
  },
  {
    id: "INV-1049",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    date: "2024-10-27",
    terms: "due-on-receipt",
    lineItems: oneLine(GENERIC_LINE, 320),
    ...imported,
  },
  {
    id: "INV-1050",
    contactName: "Arthur Pendleton",
    date: "2024-10-27",
    terms: "due-on-receipt",
    lineItems: oneLine("Blower Motor Replacement & Diagnostics", 500),
    previouslyPaid: 200,
    ...imported,
  },
  {
    id: "INV-1051",
    contactName: "Maya Lin",
    date: "2024-10-28",
    terms: "due-on-receipt",
    lineItems: oneLine("Dual-Zone Thermostat Wiring & Commissioning", 380),
    ...imported,
  },
];

const recorded = (id: string, invoiceId: string, amount: number, method: PaymentMethod, date: string): Payment => ({
  id,
  invoiceId,
  amount,
  method,
  date,
  status: "recorded",
  recordedBy: "alex-morgan",
});

export const PAYMENTS: readonly Payment[] = [
  {
    // The historical corrective scenario: recorded by mistake, then voided. It counts toward nothing.
    ...recorded("PAY-1001", "INV-1044", 285, "check", "2024-10-25"),
    status: "voided",
    void: { reason: "Payment entered by mistake", on: "2024-10-25", by: "alex-morgan" },
  },
  recorded("PAY-1002", "INV-1043", 285, "check", "2024-10-25"),
  recorded("PAY-1003", "INV-1045", 400, "card", "2024-10-25"),
  recorded("PAY-1004", "INV-1046", 180, "cash", "2024-10-26"),
  recorded("PAY-1005", "INV-1047", 210, "check", "2024-10-26"),
  recorded("PAY-1006", "INV-1048", 450, "bank-transfer", "2024-10-27"),
  recorded("PAY-1007", "INV-1049", 320, "card", "2024-10-28"),
  recorded("PAY-1008", "INV-1044", 285, "check", "2024-10-28"),
];

export const FINANCIALS: FinancialData = { quotes: QUOTES, invoices: INVOICES, payments: PAYMENTS };
