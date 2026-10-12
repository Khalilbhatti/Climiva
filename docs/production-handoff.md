# Production handoff

Where the Climvia Business Workspace stands at the end of the build: what is finished, how it is built, what it deliberately does not do,
how it was verified, how to run and deploy it, and where a backend would attach. Written for the next developer, not for end users.

**One sentence:** a complete, navigable front end over sample data, now inside a multi-tenant SaaS foundation (sign-in, businesses, roles, PostgreSQL, Row Level Security) that stores
only Business information, Business hours, Workspace preferences and each person's profile name.

> **Phase 9 update.** Everything below describes the front end and still holds, with these changes. Read [saas-architecture.md](saas-architecture.md) for the model.
> The sample data belongs to **one** business (Apex); any other business sees its modules as "not available yet". Settings (Business information, hours, preferences, profile name)
> is stored in PostgreSQL per business instead of lost on reload. Everything needs a signed-in person with a verified workspace. Wherever this document says "no backend", "nobody signs in"
> or "gone on reload", read the SaaS foundation as the exception for those four Settings sections and for accounts.
>
> **Phase 10 update.** Customers (with their properties and equipment), Services and the Team (members, roles, availability, assigned Services) moved to PostgreSQL per business: they are read from the
> database on every load, Services and the Team are changed through Server Actions that persist, and a new business starts with none of them. The sample records for those three now live in the seed
> (`scripts/db/seed-data`), not in `src/data`. Everything else in this document about the other modules still holds. See [saas-architecture.md §13](saas-architecture.md#13-core-business-data-customers-services-team).
>
> **Phase 11 update.** Bookings, Jobs (with work details and photo metadata), the Schedule (derived) and blocked time moved to PostgreSQL per business, with organization-scoped numbers (`BK-`, `JB-`). See [saas-architecture.md §24](saas-architecture.md#24-operations-bookings-jobs-and-the-schedule).
>
> **Phase 12 update.** Quotes, Invoices (with line items) and Payments moved to PostgreSQL per business: money is stored as integer cents, an invoice's paid amount, balance and status are derived from its lines and payments, a payment is recorded once and
> corrected only by voiding it (never edited, never deleted), and `QT-` / `INV-` / `PAY-` numbers are allocated per business by the database. Record payment, Void payment and Create invoice are Server Actions that persist, so the demo transition (#PAY-1009)
> survives a reload. A customer's page lists their quotes, invoices and payments. A new business gets real empty states for Payments and Quotes & Invoices instead of "not available yet". `financial-state` and `next-id` are gone. Analytics is **not** migrated: its money lines read the stored
> records through the same selectors as the Overview, and its other figures stay approved baselines. See [saas-architecture.md §25](saas-architecture.md#25-financials-quotes-invoices-and-payments).
>
> **Phase 13 update.** Maintenance Plans (with their coverage and included visits) and Reviews (with replies and review requests) moved to PostgreSQL per business. A created plan, a scheduled visit, a posted or edited reply and a recorded review request now survive a reload.
> Sarah's second visit is already scheduled in the baseline as the one real booking #BK-1048, which the visit points at with a real foreign key (a clean seed stores it; no second booking is offered for it); cancelling that booking reopens the visit. A plan's price is information about the agreement: it creates no invoice and no payment.
> A review request is only a record (nothing is sent). Coverage ("Cooling maintenance", "Heating maintenance") is not a Service. The approved totals (14 / 5 / 3 / 2 plans, 12 / 4.7 / 3 / 5 reviews) are reporting baselines, not row counts, and a new plan or reply adds to them.
> A new business gets real empty states for both modules. `maintenance-plans-state` and `reviews-state` are gone. Website, Marketplace, Marketing and Analytics were still sample data. See [saas-architecture.md §26](saas-architecture.md#26-maintenance-plans-and-reviews).
>
> **Phase 14 update.** Marketing and Analytics moved to PostgreSQL per business. Campaigns (email and text) are stored as Draft, Scheduled or Sent with their audience, message, business-local schedule (stored as an instant in the business's time zone), recipient counts and, for a Scheduled or Sent campaign, a **snapshot of its recipients** taken when it was scheduled or sent; saving a draft, scheduling, sending, cancelling a schedule (back to Draft, never deleted) and duplicating are Server Actions that persist, with the status checked and the row locked on the server. A Sent campaign is final. **Nothing is delivered**: there is no email or SMS provider, "Sent" is a recorded state, and only the sample business's seeded history carries a delivery result (provider delivery integration deferred).
> Analytics is now a server-rendered reporting layer: the figures come from PostgreSQL queries over the other modules' rows (`src/db/reporting-queries.ts`), for the active business and a URL-backed date range, and the CSV and PDF exports are built from the same report. The sample business's approved figures that its detailed records cannot reproduce (Bookings 24, Completed Jobs 18, quote value $4,820, invoiced $6,240, the weekly and per-Service tables, plan and review totals, audience sizes) are kept in an explicit, separate, read-only table of signed **imported adjustments** (`analytics_imported_baselines`), so a report is the stored rows in the range plus the adjustments, and nothing is counted twice. A new business gets an empty Marketing and zeros in Analytics; the Overview and the sidebar counts read the same report. `marketing-state` and the static `overviewMetrics` / Analytics aggregates are gone. Website and Marketplace are the sample data that remain. See [saas-architecture.md §27](saas-architecture.md#27-marketing-and-analytics).

## Contents

1. [Completed modules](#completed-modules)
2. [Architecture](#architecture)
3. [Routes](#routes)
4. [The sample-data model](#the-sample-data-model)
5. [Session state and its limits](#session-state-and-its-limits)
6. [What is intentionally absent](#what-is-intentionally-absent)
7. [Testing status](#testing-status)
8. [Running, building and deploying](#running-building-and-deploying)
9. [Known non-blocking limitations](#known-non-blocking-limitations)
10. [Where a backend would attach](#where-a-backend-would-attach)

## Completed modules

Seventeen sidebar destinations, all built. Order and grouping are the approved navigation; a test asserts it.

| Group | Module | What it does |
| --- | --- | --- |
| Overview | Overview | Four summary tiles, four quick actions, the business card (read from Settings) |
| Operations | Bookings | Requests, Upcoming, Past, Cancelled; booking detail; confirm, decline, assign, create a job; the one Create booking flow |
| | Schedule | Week and Day boards, unassigned-work banner, assignment, event details |
| | Jobs | Active, Upcoming, Completed; job overview, work details, files; start, complete, reassign |
| | Customers | Directory, customer overview, properties and equipment |
| Business | Services | Catalog of six Services; Service overview, pricing, booking settings, customer intake, availability; Add service |
| | Team | Members, member overview / availability / permissions / services / activity, roles, Add and Deactivate member |
| Financials | Quotes & Invoices | Quote and invoice lists and details; Create invoice from an approved quote |
| | Payments | Payments and Outstanding invoices; Record payment; Void payment; payment detail |
| | Maintenance Plans | Plan list and detail; Create plan; Schedule an included visit |
| Growth | Website | Overview, Pages & content (five pages), Booking, Domain; page editors with Save, Publish, Discard; the customer-facing preview and booking journeys |
| | Marketplace | Listing overview and editor; set up, hide and publish; the public listing preview |
| | Reviews | Review list and detail; Reply and Edit response; Request review |
| | Marketing | Campaign list, detail and editor (email and SMS); schedule, send, cancel schedule, duplicate; recipients |
| Insights | Analytics | Read-only reporting over the other modules; date range; CSV and PDF export |
| Pinned | Settings | Business information, Business hours, Branding, Workspace preferences, My profile |
| | Help | A landing page of links into each area of the workspace |

Not built, because no flow was approved: the onboarding sequence, customer notes and messaging, drag-and-drop scheduling, map or route views,
service media, tax rules, and anything that needs a backend (see [What is intentionally absent](#what-is-intentionally-absent)).

## Architecture

- **Framework.** Next.js 16.3.8 App Router, React 19, TypeScript strict, Tailwind CSS 4. `typedRoutes` is on: every `<Link href>` is checked against a real
  route at build time, and `src/config/routes.ts` holds the `AppHref` patterns for the dynamic ones (add one when you add a dynamic route).
- **Route groups.** `src/app/(workspace)` renders inside `AppShell` (top bar, sidebar, content). `src/app/(site)` holds the customer-facing pages (the Website
  preview and journeys, the Marketplace listing) with no shell. A root `not-found.tsx` puts the workspace around an unknown address.
- **Shell.** `components/shell/`: `AppShell`, `TopBar` (workspace switcher, `GlobalSearch`, `NotificationsMenu`, profile link), `Sidebar` (driven by
  `config/navigation.ts`). The skip link, landmarks and one-`h1`-per-page structure live here and in `ui/PageHeader`.
- **Shared UI.** `components/ui/`: Button, Card, Modal (native `<dialog>`: focus trap, Escape, focus return), Tabs and TabNav, Table, StatusBadge, FormField and
  inputs, Toast, UnsavedGuard, EmptyState, KpiCard. Colour, radius, shadow and type scale are tokens in `src/app/globals.css`; components use them, never raw values.
- **Data and state.** `src/data/*` holds types and pure selectors (and, for the modules not yet on PostgreSQL, typed sample records). `src/lib/*-state.ts` holds pure transitions for those modules (`assign`, …) that take the current data and return the next;
  the financial and operational ones are Server Actions now (`src/server/actions`). One provider per area keeps the result in React state; all providers mount
  once at the app root (`components/providers/AppProviders`) so the public previews read the same session.
- **Time.** `PROTOTYPE_TODAY` (2024-10-25) and `PROTOTYPE_NOW` (10:45) in `data/fixtures.ts` are the product's clock. `lib/dates.ts` and `lib/format.ts` format by hand
  from "YYYY-MM-DD" and "HH:mm" strings in the business's local time; nothing uses `Date.now`, `new Date()`, `Intl` or `toLocale*`, which a test enforces.
  `lib/display-preferences.ts` carries the saved date and time style to the formatters.
- **Fonts and assets.** Inter is self-hosted (`src/app/fonts`); the only other asset is `src/app/icon.svg`. Nothing is requested from another origin.

## Routes

59 page files (52 workspace, 7 public) expanding to 181 addresses over the sample records, 12 of them public. The list is derived from the folder by the route inventory test,
so a new page cannot be added without being crawled.

| Area | Addresses |
| --- | --- |
| Overview | `/` |
| Operations | `/bookings`, `/schedule`, `/jobs`, `/jobs/[jobId]`, `…/work-details`, `…/files`, `/customers`, `/customers/[customerId]`, `…/properties` |
| Business | `/services`, `/services/[serviceId]`, `…/pricing`, `…/booking-settings`, `…/customer-intake`, `…/availability`, `/team`, `/team/[memberId]`, `…/availability`, `…/permissions`, `…/services`, `…/activity`, `/team/roles`, `/team/roles/new`, `/team/roles/[roleId]` |
| Financials | `/quotes-invoices`, `/quotes-invoices/quotes/[quoteId]`, `/quotes-invoices/invoices/[invoiceId]`, `/payments`, `/payments/[paymentId]`, `/maintenance-plans`, `/maintenance-plans/[planId]` |
| Growth | `/website`, `/website/pages`, `/website/pages/[pageId]`, `/website/booking`, `/website/domain`, `/marketplace`, `/marketplace/edit`, `/reviews`, `/reviews/[reviewId]`, `/marketing`, `/marketing/new`, `/marketing/[campaignId]`, `…/edit` |
| Insights | `/analytics` |
| Pinned | `/settings`, `/settings/hours`, `/settings/branding`, `/settings/preferences`, `/settings/profile`, `/help` |
| Public, no shell | `/website/preview`, `/website/preview/services`, `/about`, `/contact`, `/booking`, `/booking/[serviceId]`, and `/marketplace/preview` |

Tabs, filters and one-off flows are in the address so they can be linked and survive Back: `?tab=`, `?new=1` (Create booking, Create plan), `?record=1`
(Record payment), `?booking=` and `?event=` (open a detail), `?setup=1`, `?range=` (Analytics), and `?state=empty` on the modules that have an approved first-time screen
(`?state=solo` on Team). An address that names nothing real shows the workspace's not-found screen with a way back.

## The sample-data model

One set of records, read everywhere; nothing is typed twice. The facts every module must agree on, and where each lives:

- **The business.** Apex Climate Heating & Air · (555) 392-8100 · service@apexclimate.com · 4820 East Riverside Dr, Suite 110, Austin, TX 78741 · Mon–Fri 7:30 AM–6:00 PM,
  Sat 8:00 AM–2:00 PM, Sun closed · America/Chicago · USD. In `data/fixtures.ts`; Settings starts from it and is then the editable source (`SettingsProvider`).
- **People.** The signed-in user is Alex Morgan, Operations Lead (no email). The customer is Elena **Rodriguez**. Marcus Vance is one Team record that Jobs, Schedule,
  Bookings and plan visits all point at. Sarah Mitchell has one property, Home, 1402 Kinney Ave, Austin, TX 78704.
- **Services.** Exactly six, in `data/services.ts`. Plan coverage labels ("Cooling maintenance", "Heating maintenance") are plan internals and are never Services. The Website,
  Marketplace, Bookings, Analytics and Team eligibility all read this list.
- **Operations.** Job #JB-204 is Sarah Mitchell's AC Repair & Diagnostics at her property, booking #BK-1042, **Completed**. Booking #BK-1048 (Nov 19, 10:00 AM to 12:00 PM, Marcus Vance, confirmed) is her plan's second visit, already scheduled; new bookings take the next free number (#BK-1043), never 1048.
  Bookings and jobs carry either a customer id or a contact snapshot for someone without a record.
- **Money.** Seven recorded payments, $2,130 received, two outstanding invoices, $680 outstanding, $6,240 invoiced. #INV-1044 is paid and is never offered in Record payment;
  #PAY-1001 is the historical voided payment. Recording the $300 on #INV-1050 makes #PAY-1009: eight payments, $2,430, one outstanding invoice, $380. Every total is derived
  from the stored records, never typed. The $200 already paid on #INV-1050 is carried on the invoice (it is not a payment). $6,240 invoiced is a reporting baseline that covers more history than the nine stored invoices; invoices made since are added to it.
- **Plans.** Sarah's Comfort Care: $189 a year, two visits, May 14 2024 to May 14 2025.
- **Growth.** The Marketplace lists five of the six Services (Emergency No-Heat / No-Cool is not selected). Reviews: 12 · 4.7 average · 3 awaiting a reply · 5 requests.
  Marketing: 2 drafts · 1 scheduled · 8 sent · 146 recent recipients.
- **Approved aggregates.** Bookings 24, Completed Jobs 18, Quote value $4,820, and the Analytics weekly and per-Service tables describe a month of history the sample does not
  carry record by record. They are not counts of the sample and are deliberately not forced to equal it: the seed stores the difference between each approved figure and what the detailed rows contribute as signed imported adjustments (`analytics_imported_baselines`, written from `scripts/db/seed-data/reporting.ts`), and every report is the stored rows in the range plus the adjustments that range covers.
  Money, invoice statuses, payments, plans, reviews and campaigns follow the stored records through the same reporting functions, so a new booking, payment, review or campaign moves a figure by exactly its own contribution.

`e2e/canonical-invariants.spec.ts` asserts all of the above from the real exports, and `e2e/session-flows.spec.ts` follows each change across modules.

## Session state and its limits

- Every change to the sample modules is held in React state by the providers, survives moving between modules (including to the public previews), and is **gone on reload**.
  The sample records themselves are never mutated. **Exception (Phase 9):** Business information, Business hours, Workspace preferences and the profile name are stored in
  PostgreSQL for the active business and are read back from there on every page load. Branding (logo, accent) and a chosen photo are still session-only.
- Nothing is saved to `localStorage`. Two cookies exist: the Better Auth session cookie and the `climvia_org` active-workspace preference (both `httpOnly`). A second tab starts from the
  stored settings and the sample data; a different business never sees the sample data. **Exception (Phase 10):** Services and the Team are stored too, and Customers are read from the database.
- Following an in-app link away from a form with unsaved changes asks "Discard unsaved changes?". Reloading or closing the tab is left to the browser, and loses the changes either way.
- A booking, job, quote, invoice or payment takes the next number of its business from the database (never `MAX + 1`); #BK-1048 is stored for Sarah's scheduled visit, and an allocated number that already exists is skipped. A maintenance plan and a review are named by a readable reference unique within the business (`plan-sarah-comfort-care`, `rev-sarah-mitchell`); a campaign is named by a readable reference unique within the business (`cmp-fall-maintenance-reminder`).
- The date and time style, the accent colour and the logo apply to everything read after they are saved; server-rendered text is limited to what does not depend on them.

## What is intentionally absent

None of this is missing by accident; each has no approved screen or needs infrastructure the project does not have.

- **A backend for the sample modules.** Since Phase 9 there is server code (Better Auth's route handler, a proxy, Server Actions) and a PostgreSQL database, but only accounts,
  businesses, memberships, the four Settings sections, `sites`, Customers, Services and the Team (Phase 10), Bookings, Jobs and the Schedule (Phase 11), Quotes, Invoices and Payments (Phase 12), Maintenance Plans and Reviews (Phase 13), and Marketing and Analytics (Phase 14) use it. Website and Marketplace
  are still sample data.
- **Authorization inside a business beyond owner / admin / member.** The Team module's roles and permission matrix are configuration that nothing enforces. SaaS roles are separate (see saas-architecture.md).
- **Payments.** Record payment stores a record of money the business received. No card, bank or processor is involved, and nothing is collected on the booking pages ("No payment is collected online"). There is no screen to write a quote, edit an invoice, refund or credit; invoices are made from approved quotes.
- **Email and SMS.** A review request is only a stored record that one was made (Phase 13), and campaigns are stored as Draft, Scheduled or Sent (Phase 14) with their recipients' snapshot; nothing is sent or delivered, there is no email or SMS provider, and a Scheduled campaign is not sent by anything when its time comes. Provider delivery integration deferred.
- **Domains.** Connecting, verifying and removing a domain is a simulation of the screens; no DNS is touched.
- **File storage.** Job photos keep a name and size for the visit; no file is read or kept.
- **Notifications.** The bell opens a panel that says there are none, because nothing produces one.
- **Reporting beyond what is on screen.** CSV and PDF exports are generated in the browser from the same typed report object the screen shows (built on the server for the active business and range); there is no scheduled or emailed report and no warehouse.
- **Search beyond the workspace's records.** The top-bar search finds Customers, Jobs, Bookings and Schedule entries from the loaded records; there is no index.

## Testing status

Final verification, run on the finished source:

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` (zero warnings allowed) | clean |
| `npm run build` | succeeds with no warnings; every page is rendered on request (`ƒ`), none is prerendered |
| `npm run test:e2e` (production build, own `climvia_test` database, Chromium) | **2547 passed, 0 failed, 0 flaky, 0 skipped**, 73 spec files, about 14 minutes on six workers (Phase 14: the earlier tests kept and adapted where marketing and analytics are now stored (the static `analytics-data` spec was removed with the fixtures it tested), plus seven new specs of 144 tests: the pure marketing and analytics rules, SQL as the restricted role including the campaign concurrency tests, the seed round trip, and the flows through the real application. Phase 13: the earlier tests kept and adapted where plans and reviews are now stored, plus the maintenance and review specs: the pure rules and totals, SQL as the restricted role including the concurrency tests, the seed round trip, and the flows through the real application. Phase 12: the earlier tests kept and adapted where quotes, invoices and payments are now stored, plus the financial specs: money, rules, SQL as the restricted role including the concurrency tests, the seed round trip, and the flows through the real application). One test, the Schedule's keyboard-open check, can miss its keypress when forty copies of it run at once on six workers (it also did before Phase 11); on its own it passed 30 of 30 |
| Repeats for flakiness | Phase 14: the marketing, analytics and reporting specs with the server-boundary, tenant-isolation, invariant and session-flow specs ×3 (885 runs), and the neighbouring module specs (bookings, jobs, payments, reviews, plans, financials, operations, shell and menus, search, states, the final scan, dates and time zones, the JB-204 reconciliation) ×2 (1650 runs), no failure. Phase 8: session flows, navigation, search, payments and financial transitions, quotes and invoices, Settings and the unsaved-changes guard, Website, Marketplace, Marketing, plans, jobs, reviews, bookings and schedule ×3 (1101 runs); responsive shell, dates and time zones, accessibility, route crawl and invariants ×2 (1128 runs). No failure in any. Phase 13: the maintenance and review specs, the plan and review screens, the pure data specs, and the server-boundary, session-flow and tenant-isolation specs ×3 (1032 runs), and the neighbouring module specs (jobs, bookings, schedule, customers, analytics, search, states, shell menus, onboarding, the financial flows, the final scan) ×2 (1486 runs), no failure. After the BK-1048 baseline correction: the maintenance, operations, bookings, jobs, schedule, team, session-flow and invariant specs ×3 (1182 runs), no failure. Phase 12: the financial flows, database, round-trip, payments, quotes and invoices and server-boundary specs ×3 (537 runs), no failure. Phase 9: the SaaS specs, Settings, shell, session flows, navigation, Schedule, dates and search ×3 (927 runs), no failure. One existing test (Schedule: opening an event by keyboard) failed about once in thirty when run in parallel hundreds of times, because the address now changes only after a server round trip; it waits for that explicitly |

Every test runs behind a guard (`e2e/fixtures.ts`) that fails it on any console error, console warning (hydration mismatches included) or uncaught page error.

**Production route crawl** (`route-inventory.spec.ts`, against `next start`): 181 addresses derived from the page files, 30 further states (tabs, one-off flows, empty screens, Analytics ranges)
and 17 unknown-record addresses. Each is checked for: a successful response; no failed or 4xx / 5xx request (so no missing chunk or asset); no console problem; the shell present for workspace pages and absent
for the 12 public ones; exactly one visible `h1`; exactly one current sidebar item and it is the module that owns the address; and no development language in the text or the page title.

What the suite covers beyond each module's own specs (the Phase 8 additions, 1089 tests):

| Spec | Tests | Covers |
| --- | --- | --- |
| `route-inventory` | 231 | The crawl above; Back navigation; a scan of every string a user can read |
| `accessibility` | 280 | On every address: names on every control, ids and references that resolve, heading order, links that go somewhere, errors tied to fields, contrast of every painted text; focus visibility; dialogs (focus trap, Escape, focus return); menus; tabs; ratings; a keyboard-only booking |
| `states` | 254 | No programming artefact on any screen; the approved empty states; unusual addresses; records that lack an optional link; no skeletons or spinners |
| `final-scan` | 225 | No out-of-scope concept on any screen or in the source; no debug output or work markers; assets are real; dependencies are all used |
| `responsive` | 23 | Top bar at 1440, 1280, 1024, 800 and 768; no sideways scroll on any route at each; dialogs inside the window; public pages down to 390 px; desktop geometry pinned |
| `canonical-invariants` | 22 | The facts in [The sample-data model](#the-sample-data-model), from the real exports |
| `navigation-final` | 19 | The sidebar's exact order, labels and active states; Help; the four quick actions |
| `global-search` | 18 | What the search finds, and the combobox from the keyboard |
| `session-flows` | 9 | Settings, assignment, job completion, #PAY-1009, #BK-1048, a review reply, a cancelled campaign, hiding the listing: each followed across modules, then reset by a reload |
| `dates-timezones` | 8 | Twenty-two pages read word for word the same under five other time zones and languages and under system clocks in 1999 and 2031 |

The other 636 tests are the module specs written with each phase (bookings, schedule, jobs, customers, services, team, quotes and invoices, payments, maintenance plans, website, domains,
marketplace, reviews, marketing, analytics, settings, and the data-level specs for each).

## Running, building and deploying

```bash
npm install
npm run dev            # http://localhost:3000
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run build          # production build
npm run start          # serve it
npx playwright install chromium   # once, if the browser is not installed
npm run test:e2e       # builds, serves on 3460, runs the suite, stops the server
```

The app now needs PostgreSQL and environment variables (database URLs, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`); see `.env.example`, the README and
[saas-architecture.md](saas-architecture.md#17-deployment-and-the-future-aws-topology), which also covers the `Dockerfile` and the single-EC2 plan. Local setup: `docker compose up -d postgres`,
`npm run db:migrate`, `npm run db:seed`, `npm run dev`. `npm run test:e2e` prepares its own `climvia_test` database first. The statement that follows from earlier phases, "deploys to Vercel with no
configuration", no longer applies.

Operational notes:

- `npm run test:e2e` reuses a server already listening on port 3460 (except in CI). Rebuild before re-running after a source change, or stop that server and let the command do it.
- Stop only the server you started. Do not kill Node processes by name; other projects on the machine may be using them.
- The reference designs in `design-reference/` are read-only inputs. Tailwind is limited to `src/` so they are never scanned as source, and nothing in `src/` references them.

## Known non-blocking limitations

1. **Aggregates exceed the sample.** Analytics and the Overview show approved workspace totals (24 bookings, 18 completed jobs, $4,820 quoted, plan totals 14 / 5 / 3 / 2, 12 reviews,
   146 recent recipients) over a smaller set of detailed records, so a list can show fewer rows than its total (a campaign can report more recipients than it lists). The difference is held as imported adjustments, so completing a job moves the Jobs tabs and the Completed Jobs total together (18 → 19).
2. **Not every aggregate has records behind it.** For example the quote and invoice breakdowns and the weekly and per-Service tables in Analytics are the approved figures held as imported adjustments, moved by what is stored. The imported history is part of a figure only when the date range covers all of its period (October 2024 for the sample business); a partial range reports the stored rows only and says so.
3. **Renaming yourself does not rename your Team record.** Changing the profile name updates the top bar and the signature on review replies; the Team module's "Alex Morgan" is
   Team's own record. Role and permissions always come from Team.
4. **Authored copy keeps its own words.** Website page text, message templates (the default review request, campaign messages) and the sent quote and invoice messages mention
   "Apex Climate Heating & Air" literally and are not rewritten when the business is renamed. Header, footer, contact card, hours and listing are live.
5. **Session changes to the sample modules reset on reload.** Settings (Business information, hours, preferences, profile name), Services, the Team, operations, financials, maintenance plans and reviews no longer do; Branding, the Website and the Marketplace still do.
6. **Dates in server-rendered text** cannot see the saved date style; the two places that render dates on the server use `DisplayDate`. A new server-rendered date must do the same.
7. **Fixed booking windows.** Arrival windows, instant start times and consultation slots are fixed; Settings only decides which of them fit inside the saved hours.
8. **The workspace is built for tablet width and up.** It is verified from 768 to 1440 px; below that the sidebar is not collapsed. The customer-facing previews are verified down to 390 px.
9. **The footer year** on the public previews is fixed approved text ("© 2025"), not the clock.
10. **One browser engine tested.** The suite runs in Chromium; Firefox and Safari have not been exercised.
11. **Error screens.** A workspace that cannot be loaded (for example the database is down) shows a plain "couldn't load" screen with Try again (`src/app/(workspace)/error.tsx`, `global-error.tsx`);
    it never falls back to sample data. Every unknown address is handled.
12. **One currency.** USD, read-only. The time zone setting only relabels times; stored times are never converted.

## Where a backend would attach

The code is arranged so these are the only places that change:

| Concern | Today | Seam |
| --- | --- | --- |
| Reading records | `src/data/*` exports typed arrays and selectors that accept the data as an argument | Replace the arrays with fetched data; the selectors already work on any `…Data` value passed in |
| Changing records | Bookings, jobs, the financials, maintenance plans, reviews and marketing campaigns are Server Actions already; `src/lib/*-state.ts` pure functions `(data, input) → next data` remain for the other modules | Each is one API mutation; the provider replaces it with a server call, as the financial provider does |
| Holding state | `components/*/…Provider.tsx` (React state, ref for synchronous reads) | Swap for a data-fetching cache; the `use…()` hooks are the only interface components use |
| Identifiers | **Done in Phases 11 and 12:** `BK-` / `JB-` / `QT-` / `INV-` / `PAY-` numbers are allocated per business by `app_next_number()`; plans and reviews (Phase 13) and campaigns (Phase 14) have readable references unique per business | Done: every stored module has its server-assigned reference |
| Business facts | **Done in Phase 9:** `SettingsProvider` is fed by PostgreSQL through `resolveWorkspace()` and saves through Server Actions | Settings stays the single owner |
| The clock | **Done in Phase 11 for operations:** `useClock()` (the business's own "today", computed on the server); the not-yet-migrated modules still use `PROTOTYPE_TODAY` / `PROTOTYPE_NOW` | A business-time-zone "now" for the rest; formatters already take business-local strings |
| Sign-in and roles | **Done in Phase 9:** Better Auth + `organization_memberships` (owner / admin / member) | The Team module's own permissions still become enforced when Team moves to the database |
| Public pages | `src/app/(site)`: the Website and Marketplace renderers read the same providers | Render per tenant from stored content; the renderers take content as props |
| Sending and billing | Review requests (Phase 13) and campaigns with their recipient snapshots (Phase 14) are stored records and nothing is delivered; payments are recorded by hand in PostgreSQL (Phase 12) | Server-side delivery (a provider writing delivery results through its own server path, never a screen), and a payment processor behind the existing financial actions |
| Files | Photo **metadata** is stored (`job_files`); a file chosen in the browser lives for the visit only (`OperationsProvider.addSessionFiles`) | Upload to storage and keep the reference in `job_files.storage_key` |
| Reports | Analytics is computed on the server (`src/db/reporting-queries.ts`); `lib/report-export.ts` builds CSV and a PDF in the browser from the same report object | Keep, or generate the files server-side from the same report |

The pure-function shape means a backend can be introduced one module at a time without touching the screens.
