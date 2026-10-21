/**
 * The boundaries that keep one business's data away from another's, checked in the source rather than in a browser:
 * what may reach the client, who must authorize, what must never be cached, and what may never be switched off.
 * A change that crosses one of these lines fails here before it can ship.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "playwright/test";
import {
  NORTHSTAR_CUSTOMERS,
  NORTHSTAR_FINANCIALS,
  NORTHSTAR_MAINTENANCE,
  NORTHSTAR_OPERATIONS,
  NORTHSTAR_REVIEWS,
  NORTHSTAR_SERVICES,
  NORTHSTAR_TEAM,
} from "../scripts/db/seed-data/northstar";
import { NORTHSTAR_MARKETING } from "../scripts/db/seed-data/northstar";
import { RESERVED_PAGE_SLUGS, STALE_DRAFT } from "../src/lib/site-builder-rules";
import { BOOKINGS, CUSTOMERS, FINANCIALS, JOBS, MARKETING, PLANS, PROPERTIES, REVIEWS, SARAH_REPLY, SERVICES, TEAM } from "./apex-data";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, accept: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path, accept);
    return accept(path) ? [path] : [];
  });
}

const sourceFiles = walk(SRC, (path) => /\.(ts|tsx)$/.test(path));
const posix = (path: string) => relative(ROOT, path).split(sep).join("/");
const read = (path: string) => readFileSync(path, "utf8");
const isClientFile = (source: string) => /^\s*(["'])use client\1/.test(source.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
const importsOf = (source: string) => [...source.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)].map((match) => match[1] ?? match[2]);

test.describe("nothing server-only reaches the browser", () => {
  const clientFiles = sourceFiles.filter((path) => isClientFile(read(path)));

  test("there are client components to check", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
  });

  test("no client component imports the database, the auth server, server-only code or Node modules", () => {
    const offenders: string[] = [];
    for (const path of clientFiles) {
      for (const specifier of importsOf(read(path))) {
        const forbidden =
          specifier === "pg" ||
          specifier.startsWith("drizzle-orm") ||
          specifier === "server-only" ||
          specifier === "better-auth" ||
          (specifier.startsWith("better-auth/") && specifier !== "better-auth/react") ||
          specifier.startsWith("node:") ||
          specifier.startsWith("@/db") ||
          specifier === "@/lib/auth" ||
          (specifier.startsWith("@/server") && !specifier.startsWith("@/server/actions/"));
        if (forbidden) offenders.push(`${posix(path)} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the only server modules a client component may call are Server Actions", () => {
    for (const path of clientFiles) {
      for (const specifier of importsOf(read(path))) {
        if (!specifier.startsWith("@/server/actions/")) continue;
        const actionFile = join(SRC, `${specifier.replace("@/", "")}.ts`);
        expect(existsSync(actionFile), `${posix(path)} -> ${specifier}`).toBe(true);
        expect(/^\s*(["'])use server\1/m.test(read(actionFile)), `${specifier} must be a "use server" file`).toBe(true);
      }
    }
  });

  test("server-only code says so: every file in src/server and src/db that needs the request marks itself server-only", () => {
    for (const path of walk(join(SRC, "server"), (file) => /\.(ts|tsx)$/.test(file))) {
      const source = read(path);
      const isAction = /^\s*(["'])use server\1/m.test(source);
      expect(isAction || source.includes('import "server-only"'), `${posix(path)} must import "server-only" or be a "use server" file`).toBe(true);
    }
  });

  test("no customer, property, Service, team, booking, job, quote, invoice, payment, maintenance plan or review record is compiled into the browser's JavaScript", () => {
    // The foundations and the operations are read from PostgreSQL for the verified business and sent to that business's browser
    // only. Their seed lives in scripts/db/seed-data, which nothing under src imports; this checks the built result, where a stray
    // import would show.
    const staticDir = join(ROOT, ".next", "static");
    expect(existsSync(staticDir), "run a production build first (npm run build)").toBe(true);
    const bundle = walk(staticDir, (path) => path.endsWith(".js")).map(read).join("\n");
    expect(bundle.length).toBeGreaterThan(100_000);
    const distinctive = [
      ...CUSTOMERS.flatMap((customer) => [customer.email, customer.phone]),
      ...PROPERTIES.flatMap((property) => [property.street, property.accessInstructions ?? ""]),
      ...SERVICES.map((service) => service.description),
      ...TEAM.flatMap((member) => [member.email ?? "", member.notes ?? ""]),
      ...NORTHSTAR_CUSTOMERS.flatMap((customer) => [customer.name, customer.email]),
      ...NORTHSTAR_SERVICES.map((service) => service.name),
      ...NORTHSTAR_TEAM.map((member) => member.name),
    ].filter(Boolean);
    expect(distinctive.length).toBeGreaterThan(30);
    expect(distinctive.filter((value) => bundle.includes(value) || bundle.includes(JSON.stringify(value).slice(1, -1)))).toEqual([]);

    // The operations: the people on bookings that have no customer record, and the free text of jobs and bookings.
    const fixtureText = walk(join(SRC, "data"), (path) => path.endsWith(".ts")).map(read).join("\n");
    const operations = [
      ...BOOKINGS.flatMap((booking) => [booking.contactName ?? "", booking.intake?.reportedIssue ?? "", booking.contact?.address ?? ""]),
      ...JOBS.flatMap((job) => [
        job.details.technicianDiagnosis ?? "",
        job.details.workPerformed ?? "",
        job.details.customerSummary ?? "",
        job.details.safetyNote ?? "",
        job.completion?.notes ?? "",
        ...job.files.map((file) => file.caption ?? ""),
      ]),
      ...NORTHSTAR_OPERATIONS.bookings.flatMap((booking) => [booking.contactName ?? "", booking.contact?.email ?? "", booking.contact?.address ?? ""]),
    ]
      // A name that the not-yet-migrated modules' own sample records also use (Claire Dubois on a quote) legitimately ships.
      .filter((value) => value.length > 12 && !fixtureText.includes(value));
    expect(operations.length).toBeGreaterThan(20);
    expect(operations.filter((value) => bundle.includes(value) || bundle.includes(JSON.stringify(value).slice(1, -1)))).toEqual([]);

    // The financials: the people named on invoices and quotes, what was billed, and the messages. They are read from PostgreSQL for
    // the verified business and sent to that business's browser only; the canonical Apex records are seed data.
    const billed = [FINANCIALS, NORTHSTAR_FINANCIALS].flatMap((set) =>
      [...set.quotes, ...set.invoices].flatMap((record) => [record.contactName ?? "", record.message ?? "", ...record.lineItems.flatMap((line) => [line.description, line.detail ?? ""])]),
    );
    const financials = billed.filter((value) => value.length > 12 && !fixtureText.includes(value));
    expect(financials.length).toBeGreaterThan(10);
    expect(financials.filter((value) => bundle.includes(value) || bundle.includes(JSON.stringify(value).slice(1, -1)))).toEqual([]);
    // The maintenance plans and the reviews: the addresses and names on plans with no customer record, the plans' notes, what customers
    // wrote and what the business replied. They are read from PostgreSQL for the verified business and sent to that business's browser only.
    const maintenance = [
      ...PLANS.flatMap((plan) => [plan.contactName ?? "", plan.propertyText ?? "", plan.note ?? ""]),
      ...NORTHSTAR_MAINTENANCE.plans.flatMap((plan) => [plan.contactName ?? "", plan.propertyText ?? "", plan.note ?? ""]),
    ].filter((value) => value.length > 8 && !fixtureText.includes(value));
    expect(maintenance.length).toBeGreaterThan(4);
    expect(maintenance.filter((value) => bundle.includes(value) || bundle.includes(JSON.stringify(value).slice(1, -1)))).toEqual([]);
    const reviewed = [
      SARAH_REPLY,
      ...REVIEWS.flatMap((review) => [review.text, review.contactName ?? "", review.replyDraft ?? "", review.response?.body ?? ""]),
      ...NORTHSTAR_REVIEWS.reviews.flatMap((review) => [review.text, review.response?.body ?? ""]),
      ...NORTHSTAR_REVIEWS.requests.map((request) => request.message),
    ].filter((value) => value.length > 12 && !fixtureText.includes(value));
    expect(reviewed.length).toBeGreaterThan(8);
    expect(reviewed.filter((value) => bundle.includes(value) || bundle.includes(JSON.stringify(value).slice(1, -1)))).toEqual([]);
    // Marketing: every campaign's name, line, subject and message, the people a sent campaign went to and their contact details, for both
    // businesses. They are read from PostgreSQL for the verified business and sent to that business's browser only (the recipients, not even
    // that: a page asks for one campaign's at a time).
    const campaigns = [...MARKETING.campaigns, ...NORTHSTAR_MARKETING.campaigns]
      .flatMap((campaign) => [campaign.name, campaign.summary ?? "", campaign.subject ?? "", campaign.message ?? "", ...(campaign.recipientRows ?? []).flatMap((recipient) => [recipient.name, recipient.phone ?? "", recipient.email ?? ""])])
      .filter((value) => value.length > 8 && !fixtureText.includes(value));
    expect(campaigns.length).toBeGreaterThan(30);
    expect(campaigns.filter((value) => bundle.includes(value) || bundle.includes(JSON.stringify(value).slice(1, -1)))).toEqual([]);
    // Nor the seed modules themselves: nothing under src may import them.
    expect(sourceFiles.filter((path) => importsOf(read(path)).some((specifier) => /seed-data/.test(specifier))).map(posix)).toEqual([]);
  });

  test("no tenant aggregate, approved baseline or campaign sample is written in the application's source", () => {
    // They are seed data (scripts/db/seed-data) turned into imported adjustments at seed time; the browser only ever gets the active business's report.
    const removed = ["BOOKING_BREAKDOWN", "JOB_BREAKDOWN", "QUOTE_BASELINE", "INVOICE_BASELINE_COUNTS", "CANONICAL_INVOICE_COUNTS", "WEEKLY_ACTIVITY", "SERVICE_ACTIVITY", "overviewMetrics", "CAMPAIGN_BASELINE", "PLAN_BASELINE", "REVIEW_BASELINE", "MARKETING_DATA", "REPORT_PERIOD"];
    const hits = sourceFiles.flatMap((path) => removed.filter((name) => read(path).includes(name)).map((name) => `${posix(path)}: ${name}`));
    expect(hits).toEqual([]);
    // Nor the numbers themselves, written as the approved totals.
    const numbers = sourceFiles.filter((path) => /recentRecipients:\s*146|totalInvoiced:\s*6240|totalValue:\s*4820|approvedValue:\s*2975/.test(read(path))).map(posix);
    expect(numbers).toEqual([]);
  });

  test("no secret is exposed to the browser through NEXT_PUBLIC_ variables", () => {
    const offenders = sourceFiles.filter((path) => /NEXT_PUBLIC_[A-Z_]*(SECRET|PASSWORD|KEY|TOKEN|DATABASE)/.test(read(path))).map(posix);
    expect(offenders).toEqual([]);
    expect(read(join(ROOT, ".env.example"))).not.toMatch(/NEXT_PUBLIC_/);
  });
});

test.describe("every Server Action authorizes its caller", () => {
  const actionFiles = walk(join(SRC, "server", "actions"), (path) => path.endsWith(".ts"));

  test("each exported action resolves the caller from the session before it does anything else", () => {
    // signOutAction only ends the caller's own session: it needs no workspace and is safe when already signed out. submitPublicBookingAction and
    // submitMarketplaceBookingAction are the visitor's: they have no session by design and are held to their own rules in "a visitor's booking" below.
    // submitReviewAction is the customer's, through a link they hold: it has no session either, and is held to its own order below.
    const exempt = new Set(["signOutAction", "submitPublicBookingAction", "submitMarketplaceBookingAction", "submitReviewAction"]);
    const CHECKS = /resolveWorkspace\(|getSessionUser\(|manager\(|authorize\(|requireMember\(|requirePlatformAdmin\(/;
    for (const path of actionFiles) {
      const source = read(path);
      const exported = [...source.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
      expect(exported.length, `${posix(path)} exports no actions`).toBeGreaterThan(0);
      // team.ts and operations.ts route every write through one helper whose first step is the authorization; it is checked below.
      const helper = /async function (?:change|mutate)[<(][\s\S]*?\n}\n/.exec(source)?.[0];
      for (const [, name, body] of exported) {
        if (exempt.has(name)) continue;
        const direct = CHECKS.test(body);
        const viaHelper = helper !== undefined && /\b(?:change|mutate)\(/.test(body) && /await authorize\(/.test(helper);
        expect(direct || viaHelper, `${name} in ${posix(path)} does not check the session`).toBe(true);
      }
    }
  });

  test("the actions that read or write a business's data authorize before they open a tenant transaction", () => {
    for (const path of actionFiles) {
      const source = read(path);
      for (const [, name, body] of source.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)) {
        const opens = body.search(/withTenant\(|withUser\(/);
        if (opens === -1) continue;
        const checks = body.search(/resolveWorkspace\(|getSessionUser\(|manager\(|authorize\(|requireMember\(|requirePlatformAdmin\(/);
        expect(checks, `${name} in ${posix(path)} opens a transaction without checking the session`).toBeGreaterThanOrEqual(0);
        expect(checks, `${name} in ${posix(path)} checks the session after it opens a transaction`).toBeLessThan(opens);
      }
    }
  });

  test("Services, Team, operations, financial, maintenance and review writes need the owner/admin capability", () => {
    const services = read(join(SRC, "server", "actions", "services.ts"));
    expect(services.match(/authorize\("services:manage"/g)?.length).toBe(2);
    expect(services).not.toMatch(/requireMember\(/);
    // Adding a customer by hand: the one action, authorized before anything is parsed or written, and it names no organization, id or public reference.
    const customerActions = read(join(SRC, "server", "actions", "customers.ts"));
    expect(customerActions.match(/authorize\("customers:manage"/g)?.length).toBe(1);
    expect(customerActions).not.toMatch(/requireMember\(|organizationId:\s*(input|payload|body)/);
    expect([...customerActions.matchAll(/export async function (\w+)\(/g)].map(([, name]) => name)).toEqual(["addCustomerAction"]);
    expect(customerActions.indexOf('authorize("customers:manage"')).toBeLessThan(customerActions.indexOf("parseNewCustomer("));
    const team = read(join(SRC, "server", "actions", "team.ts"));
    expect(team).toMatch(/authorize\("team:manage"/);
    // Every booking and job write goes through the one helper that authorizes "operations:manage" first.
    const operations = read(join(SRC, "server", "actions", "operations.ts"));
    expect(operations.match(/authorize\("operations:manage"/g)?.length).toBe(1);
    expect(operations).not.toMatch(/requireMember\(/);
    const exported = [...operations.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
    expect(exported.map(([, name]) => name).sort()).toEqual(
      ["assignAction", "cancelBookingAction", "completeJobAction", "confirmBookingAction", "createBookingAction", "createJobAction", "setFileVisibilityAction", "startJobAction", "updateJobDetailsAction"].sort(),
    );
    // Each one hands everything it does to mutate(): nothing is parsed, looked up or written before the caller is authorized.
    for (const [, name, body] of exported) expect(/>\s\{\s+return mutate\(/.test(body), `${name} must start by handing everything to mutate()`).toBe(true);
    // Every payment, void, invoice and quote write goes through the one helper that authorizes "financials:manage" first.
    const financials = read(join(SRC, "server", "actions", "financials.ts"));
    expect(financials.match(/authorize\("financials:manage"/g)?.length).toBe(1);
    expect(financials).not.toMatch(/requireMember\(/);
    const financialActions = [...financials.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
    expect(financialActions.map(([, name]) => name).sort()).toEqual(
      ["createInvoiceFromQuoteAction", "createQuoteAction", "recordPaymentAction", "updateQuoteStatusAction", "voidPaymentAction"].sort(),
    );
    for (const [, name, body] of financialActions) expect(/>\s\{\s+return mutate\(/.test(body), `${name} must start by handing everything to mutate()`).toBe(true);
    // No action names an organization, an owner or a customer on a payment: the tenant is the verified one, the customer is the invoice's.
    expect(financials).not.toMatch(/organizationId:\s*(input|payload|body)/);
    // Every plan and visit write goes through the one helper that authorizes "maintenance:manage" first, and every reply and request write
    // through the one that authorizes "reviews:manage" first.
    const maintenance = read(join(SRC, "server", "actions", "maintenance.ts"));
    expect(maintenance.match(/authorize\("maintenance:manage"/g)?.length).toBe(1);
    expect(maintenance).not.toMatch(/requireMember\(/);
    const maintenanceActions = [...maintenance.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
    expect(maintenanceActions.map(([, name]) => name).sort()).toEqual(["createPlanAction", "scheduleVisitAction"]);
    for (const [, name, body] of maintenanceActions) expect(/>\s\{\s+return mutate\(/.test(body), `${name} must start by handing everything to mutate()`).toBe(true);
    const reviews = read(join(SRC, "server", "actions", "reviews.ts"));
    expect(reviews.match(/authorize\("reviews:manage"/g)?.length).toBe(1);
    expect(reviews).not.toMatch(/requireMember\(/);
    const reviewActions = [...reviews.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
    expect(reviewActions.map(([, name]) => name).sort()).toEqual(["createReviewRequestAction", "editReplyAction", "postReplyAction", "reissueReviewLinkAction"]);
    for (const [, name, body] of reviewActions) expect(/>\s\{\s+return mutate\(/.test(body), `${name} must start by handing everything to mutate()`).toBe(true);
    // Neither names an organization from the request: the tenant is the verified one.
    expect(maintenance).not.toMatch(/organizationId:\s*(input|payload|body)/);
    expect(reviews).not.toMatch(/organizationId:\s*(input|payload|body)/);
    // Every campaign write goes through the one helper that authorizes "marketing:manage" first; the reads that need the server (who a campaign
    // is for) are open to any member of the workspace, and change nothing.
    const marketing = read(join(SRC, "server", "actions", "marketing.ts"));
    expect(marketing.match(/authorize\("marketing:manage"/g)?.length).toBe(1);
    expect(marketing).not.toMatch(/requireMember\(/);
    const marketingActions = [...marketing.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
    expect(marketingActions.map(([, name]) => name).sort()).toEqual(["cancelScheduleAction", "duplicateCampaignAction", "saveDraftAction", "scheduleCampaignAction", "sendCampaignAction"]);
    for (const [, name, body] of marketingActions) expect(/>\s\{\s+return mutate\(/.test(body), `${name} must start by handing everything to mutate()`).toBe(true);
    expect(marketing).not.toMatch(/organizationId:\s*(input|payload|body)/);
    const marketingReads = read(join(SRC, "server", "actions", "marketing-reads.ts"));
    expect([...marketingReads.matchAll(/export async function (\w+)\(/g)].map(([, name]) => name).sort()).toEqual(["campaignRecipientsAction", "previewRecipientsAction"]);
    expect(marketingReads).not.toMatch(/authorize\(/);
    expect(marketingReads.match(/await requireMember\(\)/g)?.length).toBe(2);
    expect(marketingReads).not.toMatch(/\.(insert|update|delete)\(|Tx\(/);
    // Every Website write goes through the one helper that authorizes "website:manage" first, and every Marketplace write through the one that
    // authorizes "marketplace:manage" first. Neither names an organization or a site: both are found from the verified business.
    const website = read(join(SRC, "server", "actions", "website.ts"));
    // Two places authorize, and nowhere else: the helper every change goes through, and the ownership check (it must not hold a transaction while DNS is asked).
    expect(website.match(/authorize\("website:manage"/g)?.length).toBe(2);
    expect(website).not.toMatch(/requireMember\(/);
    const websiteActions = [...website.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
    expect(websiteActions.map(([, name]) => name).sort()).toEqual(
      [
        "activateDomainAction",
        "addDomainAction",
        "applyTemplateAction",
        "createWebsiteAction",
        "disableDomainAction",
        "publishWebsiteAction",
        "removeDomainAction",
        "saveDraftAction",
        "setMainDomainAction",
        "unpublishWebsiteAction",
        "verifyDomainAction",
      ].sort(),
    );
    // verifyDomainAction authorizes itself (above) because DNS is asked between two short transactions; every other action hands everything to mutate().
    for (const [, name, body] of websiteActions) {
      if (name === "verifyDomainAction") expect(body).toContain('authorize("website:manage"');
      else expect(/>\s\{\s+(const [^\n]+\n\s+)*return mutate\(/.test(body), `${name} must hand everything to mutate()`).toBe(true);
    }
    expect(website).not.toMatch(/organizationId:\s*(input|payload|body)|siteId:\s*(input|payload|body)/);
    expect(website).toContain("findPrimarySite(tx, organizationId)");
    const marketplace = read(join(SRC, "server", "actions", "marketplace.ts"));
    expect(marketplace.match(/authorize\("marketplace:manage"/g)?.length).toBe(1);
    expect(marketplace).not.toMatch(/requireMember\(/);
    const marketplaceActions = [...marketplace.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
    expect(marketplaceActions.map(([, name]) => name).sort()).toEqual(["hideListingAction", "publishListingAction", "requestListingReviewAction", "saveListingAction", "setUpListingAction"]);
    for (const [, name, body] of marketplaceActions) expect(/>\s\{\s+return mutate\(/.test(body), `${name} must start by handing everything to mutate()`).toBe(true);
    expect(marketplace).not.toMatch(/organizationId:\s*(input|payload|body)/);
    // The capabilities are decided in one place.
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"website:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"marketplace:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"marketing:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"financials:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"services:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"customers:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"team:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"operations:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"maintenance:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"reviews:manage": \["owner", "admin"\]/);
  });

  test("a customer's review is the other anonymous action: it holds a link's secret and what the customer typed, never names a business, a customer or a Job, and reads the form again before it asks the database", () => {
    const path = join(SRC, "server", "actions", "public-review.ts");
    const source = read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source.trimStart().startsWith('"use server"')).toBe(true);
    expect([...source.matchAll(/export async function (\w+)\(/g)].map(([, name]) => name)).toEqual(["submitReviewAction"]);
    // The order: the secret's shape, then the form, then the platform's own name (never a customer's domain), then the rate limits, then the database.
    const order = ["REVIEW_TOKEN_PATTERN.test(token)", "parseReviewSubmission(", 'origin.kind !== "platform"', "withinLimit(", "submitReview("].map((needle) => source.indexOf(needle));
    expect(order.every((position) => position > 0), "every step is present").toBe(true);
    expect([...order].sort((a, b) => a - b), "and they run in this order").toEqual(order);
    // Nothing the request says names who the review is about, and the secret is never logged.
    expect(source).not.toMatch(/organizationId|customerId|jobId|requestId|withTenant|withUser|@\/db\/schema|session/);
    expect(source).not.toMatch(/console\.\w+\([^)]*token/);
  });

  test("a visitor's booking is the one kind of anonymous action (from a website, or from the Marketplace): it names a Site or a listing and a Service, never a business, and reaches the database only through the public functions", () => {
    const path = join(SRC, "server", "actions", "public-booking.ts");
    const source = read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The only action files that do not authorize are the visitor's two (the workspace actions resolve the session in their own ways).
    const anonymous = actionFiles.filter((file) => !/authorize\(|resolveWorkspace\(|getSessionUser\(|requireMember\(|requirePlatformAdmin\(/.test(read(file))).map(posix);
    expect(anonymous).toEqual(["src/server/actions/public-booking.ts", "src/server/actions/public-review.ts"]);
    expect([...source.matchAll(/export async function (\w+)\(/g)].map(([, name]) => name)).toEqual(["submitPublicBookingAction", "submitMarketplaceBookingAction"]);
    // The Marketplace's action is held to the same order: read the request, then the rate limit, then the listing as a visitor sees it, then the slot, then the write.
    expect(source.indexOf("parseMarketplaceBooking(")).toBeGreaterThan(-1);
    expect(source.indexOf("withinLimit(", source.indexOf("parseMarketplaceBooking("))).toBeGreaterThan(source.indexOf("parseMarketplaceBooking("));
    expect(source.indexOf("loadMarketplaceBooking(")).toBeGreaterThan(source.indexOf("withinLimit(", source.indexOf("parseMarketplaceBooking(")));
    expect(source.indexOf("createMarketplaceBooking(")).toBeGreaterThan(source.indexOf("checkPublicBooking(", source.indexOf("loadMarketplaceBooking(")));
    // It is for the platform's own names only (a customer's domain serves a customer's site), and the source of the booking is never read from the request.
    expect(source).toMatch(/origin\.kind !== "platform"/);
    expect(source).not.toMatch(/request\.source|input\.source|\.source\b/);
    // The request is parsed and rate limited before anything is looked up, and the answer is a reference, a status and whether it repeated one.
    expect(source.indexOf("parsePublicBooking(")).toBeGreaterThan(-1);
    expect(source.indexOf("withinLimit(")).toBeGreaterThan(source.indexOf("parsePublicBooking("));
    expect(source.indexOf("loadPublicSite(")).toBeGreaterThan(source.indexOf("withinLimit("));
    expect(source.indexOf("createPublicBooking(")).toBeGreaterThan(source.indexOf("checkPublicBooking("));
    // No organization anywhere in it, no tenant transaction, no table.
    expect(source).not.toMatch(/organization/i);
    expect(source).not.toMatch(/withTenant|withUser|@\/db\/schema|@\/db\/index|getDb\(/);
    expect(source).not.toMatch(/cookies\(|session/i);
    // The visitor's address is the right-most entry of the forwarded header (the one the nearest proxy appended), never the first.
    expect(read(join(SRC, "server", "rate-limit.ts"))).toContain("parts[parts.length - 1]");
  });

  test("no action takes an organization id from the client and trusts it", () => {
    for (const path of actionFiles) {
      const source = read(path);
      // `switchOrganizationAction` is the one that receives an id, and it verifies it against the caller's memberships.
      const trusting = [...source.matchAll(/export async function (\w+)\((\w*[oO]rganization\w*)[:)]/g)].filter(([, name]) => name !== "switchOrganizationAction");
      expect(trusting.map(([, name]) => name), posix(path)).toEqual([]);
    }
    expect(read(join(SRC, "server", "actions", "workspace.ts"))).toContain("isActiveMember(user.id, organizationId)");
  });
});

test.describe("tenant data is never cached or prerendered", () => {
  test("nothing in src uses a data cache, static revalidation or static generation", () => {
    const patterns = [/unstable_cache/, /["']use cache["']/, /export const revalidate/, /export const fetchCache/, /["']force-static["']/, /generateStaticParams/, /cacheLife|cacheTag/];
    const offenders: string[] = [];
    for (const path of sourceFiles) {
      const source = read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const pattern of patterns) if (pattern.test(source)) offenders.push(`${posix(path)} matches ${pattern}`);
    }
    expect(offenders).toEqual([]);
  });

  test("the workspace, public, preview and auth route groups are force-dynamic", () => {
    for (const file of ["(signed-in)/layout.tsx", "(public)/layout.tsx", "(entry)/layout.tsx", "(unmatched)/layout.tsx", "(auth)/login/page.tsx", "(auth)/signup/page.tsx", "(auth)/onboarding/page.tsx"]) {
      expect(read(join(SRC, "app", file)), file).toMatch(/export const dynamic = "force-dynamic"/);
    }
  });

  test("the app has exactly nine route handlers: Better Auth's, the Branding upload, the public header's session answer, the public logo, the sitemap and robots file, the two health checks and the certificate permission, and each keeps to its own line", () => {
    const routes = walk(join(SRC, "app"), (path) => /route\.(ts|tsx)$/.test(path)).map(posix);
    expect(routes).toEqual([
      "src/app/(public)/assets/[assetId]/route.ts",
      "src/app/(public)/robots.txt/route.ts",
      "src/app/(public)/sitemap.xml/route.ts",
      "src/app/api/auth/[...all]/route.ts",
      "src/app/api/branding/route.ts",
      "src/app/api/session-state/route.ts",
      "src/app/health/live/route.ts",
      "src/app/health/ready/route.ts",
      "src/app/internal/tls-allow/route.ts",
    ]);

    // The health checks read no session, cookie, workspace or tenant context, and they answer without saying why.
    for (const file of ["health/live/route.ts", "health/ready/route.ts"]) {
      expect(read(join(SRC, "app", file)).replace(/\/\*[\s\S]*?\*\//g, ""), file).not.toMatch(/cookies\(|headers\(|getSessionUser|resolveWorkspace|withTenant|withUser|session|error\.message|String\(error/i);
    }
    expect(read(join(SRC, "server", "readiness.ts")).replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/cookies\(|headers\(|resolveWorkspace|withTenant|withUser|schema/i);

    // The certificate permission checks the secret before it looks at the name, compares it in constant time, and logs no name.
    const allow = read(join(SRC, "app", "internal", "tls-allow", "route.ts")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(allow.indexOf("sameSecret(params.get(")).toBeGreaterThan(-1);
    expect(allow.indexOf("sameSecret(params.get(")).toBeLessThan(allow.indexOf("isTlsEligible("));
    expect(allow).toContain("timingSafeEqual");
    expect(allow).not.toMatch(/console\.|cookies\(|headers\(|getSessionUser|resolveWorkspace|withTenant/);

    // The upload is the only one that takes a file, and it does everything that needs no body before it reads one: the request must come from
    // this site's own pages, the caller is a verified member who may manage settings, and only then is the body read, under a byte limit.
    const upload = read(join(SRC, "app", "api", "branding", "route.ts")).replace(/\/\*[\s\S]*?\*\//g, "");
    const order = ["isSameOrigin(request)", "resolveWorkspace()", 'can(state.context.role, "settings:manage")', "readLimited(request, MAX_BODY)", "formData()"].map((needle) => upload.indexOf(needle));
    expect(order.every((position) => position > 0), "every step is present").toBe(true);
    expect([...order].sort((a, b) => a - b), "and they run in this order").toEqual(order);
    expect(upload).not.toMatch(/organization_?id|organizationId\s*[:=]\s*(form|body|request)|searchParams/i);

    // The public logo route reads no session, cookie, workspace or tenant context: it asks the database's public function and the store.
    const logo = read(join(SRC, "app", "(public)", "assets", "[assetId]", "route.ts")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(logo).not.toMatch(/cookies\(|headers\(|getSessionUser|resolveWorkspace|withTenant|withUser|session/i);
    expect(logo).toMatch(/loadPublicAsset\(/);

    // The session answer takes no parameter and no body, asks only the entry module, and is never cached.
    const sessionState = read(join(SRC, "app", "api", "session-state", "route.ts")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sessionState).toContain("sessionState()");
    expect(sessionState).not.toMatch(/searchParams|formData|request\.|withTenant|organizationId/);
    expect(sessionState).toContain('"private, no-store"');
    // The sitemap and the robots file are the Marketplace's and are public: no session, cookie, workspace or tenant context. The sitemap asks the public
    // reader for the pages of providers a visitor may reach, and the robots file asks nothing.
    for (const file of ["sitemap.xml", "robots.txt"]) {
      const source = read(join(SRC, "app", "(public)", file, "route.ts")).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(source, file).not.toMatch(/cookies\(|headers\(|getSessionUser|resolveWorkspace|withTenant|withUser|session|@\/db\//i);
      expect(source, file).toContain('export const dynamic = "force-dynamic"');
    }
    expect(read(join(SRC, "app", "(public)", "sitemap.xml", "route.ts"))).toContain("getMarketplaceSitemap()");
  });

  test("no module-level variable in src/server holds tenant rows between requests", () => {
    for (const path of walk(join(SRC, "server"), (file) => /\.(ts|tsx)$/.test(file))) {
      const topLevelLets = read(path).match(/^(?:let|var) /gm);
      expect(topLevelLets, `${posix(path)} has a module-level mutable variable`).toBeNull();
    }
  });
});

test.describe("every module reads the database for the verified workspace", () => {
  /** Every module is on PostgreSQL: it works for every workspace, with that workspace's own rows. Nothing runs on the sample dataset any more. */
  const DATABASE_MODULES = ["analytics", "bookings", "customers", "jobs", "maintenance-plans", "marketing", "marketplace-listing", "overview", "payments", "quotes-invoices", "reviews", "schedule", "services", "team", "website"];
  const workspaceDir = join(SRC, "app", "(signed-in)", "(workspace)");

  test("the module list matches the sidebar: every module folder is a database module", () => {
    const present = readdirSync(workspaceDir).filter((entry) => statSync(join(workspaceDir, entry)).isDirectory() && !["settings", "help"].includes(entry));
    expect(present.sort()).toEqual([...DATABASE_MODULES].sort());
  });

  test("no sample-data gate, unavailable-module screen or fixture access check is left anywhere in src", () => {
    const leftovers = sourceFiles.filter((path) => /fixtureGate|hasSampleDataAccess|publicGate|ModuleUnavailable|isn't available for/.test(read(path))).map(posix);
    expect(leftovers).toEqual([]);
    expect(existsSync(join(SRC, "server", "fixture-gate.tsx"))).toBe(false);
  });

  test("every page and layout of every module verifies the workspace next to its data: no sample gate, no sample data", () => {
    const pages = DATABASE_MODULES.flatMap((module) => walk(join(workspaceDir, module), (path) => /(page|layout)\.tsx$/.test(path)));
    expect(pages.length).toBeGreaterThan(25);
    const ASKS_THE_SERVER = /await requireWorkspaceContext\(\)|await getCustomerBook\(\)|await getCustomerDetail\(|await getServices\(\)|await getTeam\(\)/;
    expect(pages.filter((path) => !ASKS_THE_SERVER.test(read(path))).map(posix), "pages that do not verify the workspace next to their data").toEqual([]);
    expect(pages.filter((path) => /@\/data\/fixtures/.test(read(path))).map(posix)).toEqual([]);
    // A record is asked for by its reference, and the answer for one the active business does not have is "not found".
    for (const file of [
      "customers/[customerId]/layout.tsx",
      "customers/[customerId]/page.tsx",
      "customers/[customerId]/properties/page.tsx",
      "services/[serviceId]/layout.tsx",
      "team/[memberId]/layout.tsx",
      "team/roles/[roleId]/page.tsx",
      "website/builder/page.tsx",
    ]) {
      expect(read(join(workspaceDir, file)), file).toMatch(/notFound\(\)/);
    }
  });

  test("the published pages and the Draft previews are separate: a published page asks for no session and no business, a preview requires a verified one", () => {
    const pages = [join(SRC, "app", "(public)"), join(SRC, "app", "(signed-in)", "(preview)")].flatMap((dir) => walk(dir, (path) => /(page|layout)\.tsx$/.test(path))).filter((path) => !path.endsWith(join("(public)", "layout.tsx")));
    expect(pages.length).toBeGreaterThan(6);
    const published = pages.filter((path) => /(\\|\/)(sites|listings|marketplace|custom-site|review)(\\|\/)/.test(path));
    const answersNotFound = (path: string) => /^\s*import \{ notFound \} from "next\/navigation";\s*[\s\S]*notFound\(\);\s*\}\s*$/.test(read(path)) && !/requireWorkspaceContext|@\/server|@\/db/.test(read(path));
    const previews = pages.filter((path) => !published.includes(path));
    expect(published.map(posix).sort()).toEqual([
      // A customer's own domain: the one route its requests are rewritten to. It names the site through the Host (src/server/request-host).
      "src/app/(public)/custom-site/[[...slug]]/page.tsx",
      "src/app/(public)/listings/[listingSlug]/[...rest]/page.tsx",
      "src/app/(public)/listings/[listingSlug]/book/[serviceSlug]/page.tsx",
      "src/app/(public)/listings/[listingSlug]/page.tsx",
      "src/app/(public)/listings/page.tsx",
      // The public Marketplace: its index, its Service and place pages, and the catch-all that answers "not found" under it.
      "src/app/(public)/marketplace/[...rest]/page.tsx",
      "src/app/(public)/marketplace/locations/[locationSlug]/page.tsx",
      "src/app/(public)/marketplace/page.tsx",
      "src/app/(public)/marketplace/services/[serviceSlug]/[locationSlug]/page.tsx",
      "src/app/(public)/marketplace/services/[serviceSlug]/page.tsx",
      // The page a customer opens from a review link: the secret in its address is looked up by the database.
      "src/app/(public)/review/[token]/page.tsx",
      "src/app/(public)/sites/[siteSlug]/[...slug]/page.tsx",
      "src/app/(public)/sites/[siteSlug]/page.tsx",
      "src/app/(public)/sites/page.tsx",
    ]);
    for (const path of published) {
      // An address that names no page is answered with "not found" and nothing else (no data, no session).
      if (answersNotFound(path)) continue;
      const source = read(path);
      // A visitor's page reads the public projection only: it names a site or a listing by its public identity, and nothing else.
      expect(source, posix(path)).toMatch(/@\/server\/(public-site|marketplace-route)/);
      expect(source, posix(path)).not.toMatch(/requireWorkspaceContext|getCoreSnapshot|withTenant|@\/db\/schema|cookies\(|headers\(/);
    }
    // The Marketplace's own server files ask the public readers and nothing else: no session, no tenant, no table.
    for (const file of [join(SRC, "server", "marketplace-route.ts"), join(SRC, "components", "marketplace", "discovery", "DiscoveryPage.tsx")]) {
      expect(read(file), posix(file)).toMatch(/@\/server\/public-site|\.\/public-site/);
      expect(read(file), posix(file)).not.toMatch(/requireWorkspaceContext|getCoreSnapshot|withTenant|@\/db\/|cookies\(|headers\(/);
    }
    // A preview is the signed-in person's own Draft: every one goes through requireWorkspaceContext (directly or through the preview route).
    expect(previews.map(posix).sort()).toEqual([
      "src/app/(signed-in)/(preview)/marketplace-listing/preview/page.tsx",
      "src/app/(signed-in)/(preview)/website/preview/[...slug]/page.tsx",
      "src/app/(signed-in)/(preview)/website/preview/layout.tsx",
      "src/app/(signed-in)/(preview)/website/preview/page.tsx",
    ]);
    expect(read(join(SRC, "app", "(signed-in)", "(preview)", "website", "preview", "layout.tsx"))).toContain("await requireWorkspaceContext()");
    expect(read(join(SRC, "app", "(signed-in)", "(preview)", "marketplace-listing", "preview", "page.tsx"))).toContain("await requireWorkspaceContext()");
    // The layout above them (shared with the workspace) verifies the caller and mounts the providers; nothing else does.
    expect(read(join(SRC, "app", "(signed-in)", "layout.tsx"))).toContain("<WorkspaceProviders>");
    expect(read(join(SRC, "server", "preview-route.tsx"))).toContain("await requireWorkspaceContext()");
    for (const path of previews.filter((file) => !file.endsWith("layout.tsx") && !file.includes("marketplace"))) expect(read(path), posix(path)).toContain("PreviewRoute");
  });

  test("Overview, Settings and Help are real for every workspace and still require a verified one", () => {
    expect(read(join(workspaceDir, "overview", "page.tsx"))).toContain("requireWorkspaceContext()");
    expect(read(join(SRC, "app", "(signed-in)", "layout.tsx"))).toContain("<WorkspaceProviders>");
    expect(read(join(SRC, "server", "workspace-providers.tsx"))).toContain("await requireWorkspaceContext()");
  });
});

test.describe("database access", () => {
  test("only the database layer and the auth adapter open a connection", () => {
    // src/db/public-queries.ts is the visitor's door (below): the public functions, and nothing else.
    const users = sourceFiles.filter((path) => /\bgetDb\(|\bgetPool\(/.test(read(path))).map(posix).sort();
    expect(users).toEqual(["src/db/index.ts", "src/db/public-queries.ts", "src/db/tenant.ts", "src/lib/auth.ts"]);
  });

  test("the visitor's door runs only the fourteen public database functions: no table, no tenant context, no organization", () => {
    const source = read(join(SRC, "db", "public-queries.ts")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const calls = [...source.matchAll(/select (app_\w+)\(/g)].map(([, name]) => name).sort();
    expect(calls).toEqual([
      "app_public_asset",
      "app_public_create_booking",
      "app_public_create_marketplace_booking",
      "app_public_domain",
      "app_public_listing",
      "app_public_listing_booking",
      "app_public_marketplace_facets",
      "app_public_marketplace_search",
      "app_public_marketplace_sitemap",
      "app_public_review_request",
      "app_public_site",
      "app_public_site_domain",
      "app_public_submit_review",
      "app_tls_eligible",
    ]);
    expect(source).not.toMatch(/@\/db\/schema|\.(select|insert|update|delete)\(|\.from\(|set_config|withTenant|runAsTenant|organization_?id/i);
    // Only the server's public routes, the public logo route, the host resolver, the visitor's booking action, the certificate-authorization
    // endpoint (the proxy's one question) and the readiness check (which asks that same question about a name that can not exist) import it.
    const importers = sourceFiles.filter((path) => importsOf(read(path)).some((specifier) => /public-queries$/.test(specifier))).map(posix).sort();
    expect(importers).toEqual(["src/app/(public)/assets/[assetId]/route.ts", "src/app/internal/tls-allow/route.ts", "src/server/actions/public-booking.ts", "src/server/actions/public-review.ts", "src/server/public-site.ts", "src/server/readiness.ts", "src/server/request-host.ts"]);
    // The owner credential is never reachable from a request handler (this file included).
    expect(source).not.toContain("DATABASE_ADMIN_URL");
  });

  test("tenant queries in the server layer go through withTenant / withUser", () => {
    for (const path of walk(join(SRC, "server"), (file) => /\.(ts|tsx)$/.test(file))) {
      const source = read(path);
      const usesTables = /from "@\/db\/schema"/.test(source);
      expect(usesTables && !/with(Tenant|User)\(/.test(source), `${posix(path)} reads or writes tables outside a tenant transaction`).toBe(false);
    }
  });

  test("the runtime connection string never uses the owner role", () => {
    const example = read(join(ROOT, ".env.example"));
    expect(example).toMatch(/^DATABASE_URL=postgres:\/\/climvia_app:/m);
    expect(example).toMatch(/^DATABASE_ADMIN_URL=postgres:\/\/climvia_owner:/m);
    // Nothing outside the database layer reads the owner's credential. One file NAMES it: the production configuration rules refuse to start an
    // application whose environment holds it, and they look settings up by name, never by `process.env.DATABASE_ADMIN_URL`.
    for (const path of sourceFiles.filter((file) => !posix(file).startsWith("src/db/") && posix(file) !== "src/lib/deployment.ts")) {
      expect(read(path), posix(path)).not.toContain("DATABASE_ADMIN_URL");
    }
    const refusal = read(join(SRC, "lib", "deployment.ts"));
    expect(refusal).not.toMatch(/\.DATABASE_ADMIN_URL|\["DATABASE_ADMIN_URL"\]/);
    expect(refusal).toMatch(/NEVER_IN_THE_APP = \[[^\]]*"DATABASE_ADMIN_URL"/);
  });
});

test.describe("authentication safeguards stay on", () => {
  const auth = () => read(join(SRC, "lib", "auth.ts")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("origin / CSRF checks and rate limiting are not disabled", () => {
    expect(auth()).not.toMatch(/disableCSRFCheck|disableOriginCheck|rateLimit\s*:\s*\{[^}]*enabled\s*:\s*false|disableIpTracking/);
  });

  test("telemetry is not switched on, and email verification is the only relaxed default", () => {
    expect(auth()).not.toMatch(/telemetry\s*:\s*\{[^}]*enabled\s*:\s*true/);
    expect(auth()).toMatch(/requireEmailVerification: false/);
  });

  test("sessions are looked up in the database on every request (no cookie cache)", () => {
    expect(auth()).toMatch(/cookieCache: \{ enabled: false \}/);
  });

  test("the active-workspace cookie is httpOnly and SameSite", () => {
    const cookie = read(join(SRC, "server", "workspace-cookie.ts"));
    expect(cookie).toMatch(/httpOnly: true/);
    expect(cookie).toMatch(/sameSite: "lax"/);
  });

  test("the secret and the origin are required, not defaulted", () => {
    const source = read(join(SRC, "lib", "auth.ts"));
    expect(source).toContain('requiredEnv("BETTER_AUTH_SECRET")');
    expect(source).toContain('requiredEnv("BETTER_AUTH_URL")');
    expect(source).toContain("at least 32 characters");
  });
});

test.describe("secrets and deployment files", () => {
  const tracked = () => execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);

  test("only the two example files (.env.example, .env.production.example) are committed; .env files are ignored", () => {
    const envFiles = tracked().filter((path) => /(^|\/)\.env(\.|$)/.test(path));
    expect(envFiles.filter((path) => path !== ".env.example" && path !== ".env.production.example")).toEqual([]);
    const ignore = read(join(ROOT, ".gitignore"));
    expect(ignore).toMatch(/^\.env\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
    expect(ignore).toMatch(/^!\.env\.production\.example$/m);
  });

  test(".env.example holds placeholders, not real secrets", () => {
    const values = read(join(ROOT, ".env.example"))
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=./.test(line));
    expect(values.length).toBeGreaterThan(8);
    for (const line of values) {
      const [name, value] = [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)];
      if (/SECRET|PASSWORD/.test(name)) expect(value, name).toMatch(/replace-with/);
    }
  });

  test("the Docker image never contains an .env file and runs as an unprivileged user", () => {
    const dockerfile = read(join(ROOT, "Dockerfile"));
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    // A fixed numeric user, so a volume written by one container is owned by the same user in the next.
    expect(dockerfile).toMatch(/^USER 10001:10001$/m);
    const ignore = read(join(ROOT, ".dockerignore"));
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
  });

  test("docker-compose.yml runs PostgreSQL only and binds it to the loopback interface", () => {
    const compose = read(join(ROOT, "docker-compose.yml"));
    expect(compose).toMatch(/image: postgres:17/);
    expect(compose).toMatch(/127\.0\.0\.1:\$\{POSTGRES_PORT:-5432\}:5432/);
    const services = compose.slice(compose.indexOf("\nservices:"), compose.indexOf("\nvolumes:"));
    expect(services.match(/^ {2}[a-z][\w-]*:\s*$/gm)).toEqual(["  postgres:"]);
  });
});

test.describe("the documentation covers the architecture", () => {
  const doc = () => read(join(ROOT, "docs", "saas-architecture.md"));

  test("docs/saas-architecture.md has every required topic", () => {
    const required = [
      /Authentication model/,
      /Profile model/,
      /Organization model/,
      /Memberships/,
      /Authorization roles/,
      /Active-organization resolution/,
      /Tenant query rules/,
      /Database isolation/,
      /Settings migration/,
      /Transitional fixtures/,
      /Organization → many Sites/,
      /Website Builder/,
      /visual Website Builder/,
      /AWS topology/,
      /SaaS billing vs\. business-customer payments/,
      /Domain routing/,
      /Custom domains/,
      /Deferred domain migrations/,
    ];
    const headings = doc().split(/\r?\n/).filter((line) => /^## /.test(line));
    for (const topic of required) expect(headings.some((heading) => topic.test(heading)), String(topic)).toBe(true);
  });

  test("section 28 documents the Website and Marketplace architecture, topic by topic", () => {
    const text = doc();
    const start = text.indexOf("## 28. Websites, Site Versions and the Marketplace");
    expect(start).toBeGreaterThan(0);
    const section = text.slice(start);
    const headings = section.split(/\r?\n/).filter((line) => /^###? /.test(line));
    const required = [
      /Site ownership and the primary-Site strategy/,
      /Public identity/,
      /Template model/,
      /Site Version model/,
      /Draft \/ Published lifecycle/,
      /Pages and Sections/,
      /section registry/,
      /Theme model/,
      /Dynamic bindings/,
      /Public read security/,
      /Draft preview security/,
      /tenant resolution/,
      /Marketplace listing/,
      /Authorization and tenant isolation/,
      /Custom domains/,
      /Assets and uploaded files/,
      /Phase 16 changed/,
    ];
    for (const topic of required) expect(headings.some((heading) => topic.test(heading)), String(topic)).toBe(true);
    for (const expected of ["Durable assets and Organization Branding", "private S3 bucket", "app_public_asset", "SELECT … FOR UPDATE", "SECURITY DEFINER", "snapshot-versioned", "Docker verification was required before AWS deployment"]) {
      expect(text, expected).toContain(expected);
    }
  });

  test("section 29 documents the Website Builder, topic by topic, with the reserved addresses and the stale-tab sentence", () => {
    const text = doc();
    const start = text.indexOf("## 29. The visual Website Builder");
    expect(start).toBeGreaterThan(0);
    const section = text.slice(start);
    const headings = section.split(/\r?\n/).filter((line) => /^###? /.test(line));
    for (const topic of [
      /The rule: one model/,
      /Route and layout/,
      /State: one working copy/,
      /Save \/ Discard lifecycle/,
      /saveSiteDraft/,
      /Optimistic concurrency/,
      /registry drives the inspector/,
      /canvas is the one renderer/,
      /Sections: add, copy, remove, hide, reorder/,
      /Pages/,
      /Theme editing/,
      /Undo and Redo/,
      /Who can use it/,
      /Multi-Site seam/,
      /Phase 17 template seam/,
      /Accessibility/,
      /Tests/,
      /Limitations/,
    ]) expect(headings.some((heading) => topic.test(heading)), String(topic)).toBe(true);
    // Every address a page may not take is written down, and so is what a person is told when their tab is behind.
    for (const slug of RESERVED_PAGE_SLUGS) expect(section, `reserved address ${slug}`).toContain(`\`${slug}\``);
    expect(section).toContain(STALE_DRAFT);
    for (const expected of ["Docker verification was required before AWS deployment", "no shortcut that publishes", "site_versions.revision", "@dnd-kit/core"]) {
      expect(section, expected).toContain(expected);
    }
  });

  test("the deployment section documents the container, environment, migration and start commands, and backups", () => {
    const text = doc();
    for (const expected of ["docker build", "--target tools", "npm run db:migrate", "docker-compose.production.yml", "deploy/scripts/deploy.sh", "deploy/scripts/restore-drill.sh", "BETTER_AUTH_SECRET", "DATABASE_ADMIN_URL", "pg_dump", "private S3"]) {
      expect(text, expected).toContain(expected);
    }
  });

  test("the README documents the database and auth setup and the db scripts", () => {
    const readme = read(join(ROOT, "README.md"));
    for (const expected of ["docs/saas-architecture.md", "db:migrate", "db:seed", "db:generate", "db:studio", "docker compose up"]) {
      expect(readme, expected).toContain(expected);
    }
  });

  test("the package scripts exist", () => {
    const scripts = JSON.parse(read(join(ROOT, "package.json"))).scripts as Record<string, string>;
    for (const name of ["db:generate", "db:migrate", "db:seed", "db:studio", "db:reset", "db:test:prepare", "typecheck", "lint", "build"]) expect(scripts[name], name).toBeTruthy();
  });
});
