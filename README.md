# Climvia Business Workspace

A multi-tenant workspace for HVAC service businesses: bookings and scheduling, jobs, customers and services, the team,
quotes, invoices and payments, maintenance plans, the public website and marketplace listing, reviews, marketing
campaigns, analytics and settings. People sign up, set up their business, and work in it; one person can belong to
several businesses, and one business's data is never visible to another.

## What this is, and what it is not

The **front end is complete** and the **SaaS foundation is in place**: real accounts, businesses ("organizations"), roles,
workspace switching, and a PostgreSQL database that keeps businesses apart. Not every module is on the database yet.

- **On PostgreSQL now:** accounts and sessions, organizations, memberships and roles, the Business information, Business
  hours and Workspace preferences of each business, each person's profile name, the `sites` a business owns, its
  customers (with properties and equipment), Services and team, its **operations** (bookings, jobs with work details and
  photo records, the schedule derived from them, blocked time), its **money** (quotes, invoices and payments, in whole
  cents) and its **maintenance plans and reviews** (plans with their coverage and included visits, reviews with replies
  and review requests). Each business sees only its own.
- **Still on built-in sample data** (in memory for the visit, gone on reload): Website, Marketplace, Marketing and
  Analytics. That sample belongs to **one** business, Apex Climate Heating & Air; every other business sees those modules
  as "not available yet", never Apex's records.
- **Not built:** email (so no verification, password reset or invitations by email), billing for Climvia itself, a payment
  processor, SMS, real domain connection, file storage (logo and photo last for the session), the Website Builder, deployment to AWS.

Read [docs/saas-architecture.md](docs/saas-architecture.md) first: it explains the model, the isolation rules and what comes next.
[docs/production-handoff.md](docs/production-handoff.md) covers the front end.

## Stack

| | |
| --- | --- |
| Framework | Next.js 16.3.8 (App Router, typed routes), React 19.2.8, TypeScript 5 strict |
| UI | Tailwind CSS 4, lucide-react icons, Inter (self-hosted) |
| Database | PostgreSQL 17, Drizzle ORM + drizzle-kit migrations, `pg` |
| Auth | Better Auth (email + password, sessions in PostgreSQL) |
| Local services | Docker Compose (PostgreSQL only; the app runs on your machine) |
| Tests | Playwright 1.63 (Chromium) against the production build and a dedicated test database |

No UI kit, state library or analytics client. No Supabase, Firebase, Clerk or Auth0, and no cloud SDK.

## Getting started

Requires Node.js 20.9 or newer (developed on 24), npm and Docker.

```bash
cp .env.example .env              # then replace every placeholder (see the comments in the file)
docker compose up -d postgres     # PostgreSQL 17 on 127.0.0.1:5432, data kept in a named volume
npm install
npm run db:migrate                # creates the restricted runtime role and applies every migration
npm run db:seed                   # development data: two businesses, four people (see below)
npm run dev                       # http://localhost:3000
```

`docker compose down` stops the database and keeps its data; `docker compose down -v` deletes it.
Set `BETTER_AUTH_URL` in `.env` to the origin you open in the browser (for example `http://localhost:3000`).

### Database scripts

| Script | Does |
| --- | --- |
| `npm run db:generate` | writes a new SQL migration after you change the schema in `src/db/schema` |
| `npm run db:migrate` | creates the `climvia_app` role if missing and applies pending migrations (safe to repeat) |
| `npm run db:seed` | inserts the development data below (idempotent; refuses to run when `NODE_ENV=production`) |
| `npm run db:reset` | drops, recreates, migrates and seeds the **development** database |
| `npm run db:studio` | opens drizzle-kit Studio |
| `npm run db:test:prepare` | recreates the separate `climvia_test` database, migrates and seeds it (run for you by `npm run test:e2e`) |

### Development accounts

All use the `SEED_PASSWORD` from your `.env`.

| Email | Workspaces |
| --- | --- |
| `alex.morgan@apex.test` | Apex Climate Heating & Air, owner (has the canonical customers, Services, team, bookings and jobs, and the sample data of the modules not yet on the database) |
| `jamie.rivera@apex.test` | Apex, member (can view Settings, not change them) |
| `taylor.brooks@northstar.test` | Northstar Heating & Cooling, owner (a small set of its own customers, Services, team, two bookings and a job; none of Apex's, and no sample data) |
| `casey.nguyen@climvia.test` | admin in **both** (use the workspace switcher) |

Or sign up with a new email and the setup flow creates a business of your own.

### Checks and production build

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run build          # production build
npm run start          # serve the production build at http://localhost:3000
```

### Tests

```bash
npx playwright install chromium   # once, only if the Playwright browser is not installed yet
npm run test:e2e                  # prepares climvia_test, builds, serves on port 3460, runs every spec, stops the server
```

PostgreSQL must be running (`docker compose up -d postgres`). The suite never touches your development database: it
recreates, migrates and seeds `climvia_test` from nothing every run, which is also the clean-database migration check.
`npm run test:e2e` reuses a server already listening on port 3460 (outside CI). Run one spec with
`npx playwright test e2e/payments.spec.ts`.

## How it is put together

```
src/
  app/
    (auth)/         Log in, Sign up and business set-up: no shell
    (workspace)/    every module, inside the one shell (sidebar + top bar), behind a verified workspace
    (site)/         the customer-facing Website preview and Marketplace listing, no shell
    api/auth/       Better Auth's endpoints
    layout.tsx      fonts, global styles, and the providers for the signed-in workspace
  components/       one folder per module, plus auth/, shell/ (layout), workspace/ and ui/ (shared primitives)
  config/           navigation (the sidebar) and typed route helpers
  data/             types and selectors per module; the sample records of the modules not yet on the database (customers, Services, the team and the operations are read from PostgreSQL)
  db/               the PostgreSQL schema (Drizzle), the connection, and the tenant-context helpers
  lib/              auth setup, validation, state transitions, the operations rules, business-time conversions, date and display helpers
  server/           server-only code: session, active workspace, organizations, Server Actions (including bookings and jobs), the sample-data gate
  proxy.ts          the early "no session cookie" redirect (not the security boundary)
drizzle/            SQL migrations, including the Row Level Security policies
scripts/db/         migrate, seed (and seed-data/, the canonical Apex and the Northstar records), reset and test-database preparation
e2e/                Playwright specs and their helpers
docs/               SaaS architecture, design map, visual audit, production handoff
```

- **The shell.** `AppShell` (top bar, 240 px sidebar, content area) wraps every route in `(workspace)` and stays mounted
  as the user moves between modules. The public previews live in `(site)` so they never get the workspace chrome.
- **Who is signed in, and where.** `resolveWorkspace()` (`src/server/workspace.ts`) validates the session in the database,
  lists the person's memberships and picks the active workspace (a cookie is only a preference, re-checked each time).
  Every page and Server Action asks it again next to its data; PostgreSQL's Row Level Security checks once more.
- **Providers.** One provider per area is mounted once at the root, around the signed-in workspace only, so the public
  previews read the same session as the workspace. Signing in or out and switching workspace are full page loads, so one
  business's state can never carry into another's.
- **Records and selectors.** `src/data/*` holds the types, the pure selectors that derive everything shown, and the sample
  records of the modules not yet on the database. Those change in memory only; reloading restores the sample. Customers,
  Services, the team, bookings, jobs and blocked time come from PostgreSQL for the active business.
- **A clock per business.** The sample business's "today" is Friday, October 25, 2024, 10:45, in its time zone; every
  other business's is the real time in its own zone, worked out on the server (`useClock()`). Appointments are stored as
  local dates and times and never converted. The browser never reads the system clock or its own time zone, so the server
  and every browser time zone render the same text.

### Which module owns which fact

| Fact | Owner | Stored |
| --- | --- | --- |
| Business name, phone, email, address | Settings → Business information | PostgreSQL (`organizations`) |
| Business hours | Settings → Business hours | PostgreSQL (`organization_business_hours`) |
| Date, time and time zone display | Settings → Workspace preferences | PostgreSQL (`organizations`) |
| Signed-in person's name | Settings → My profile | PostgreSQL (`profiles`) |
| Logo and accent | Settings → Branding | the session only (needs file storage) |
| Customers, Services, Team | their module | PostgreSQL (`customers`, `services`, `team_members` …) |
| Bookings, Jobs, work details, photo records, blocked time | Bookings, Jobs | PostgreSQL (`bookings`, `jobs`, `job_files`, `schedule_blocks`); the Schedule is derived, not stored |
| Quotes, invoices, payments | Quotes & Invoices, Payments | PostgreSQL (`quotes`, `invoices`, `payments` …), money in integer cents |
| Maintenance plans, coverage, visits; reviews, replies, review requests | Maintenance Plans, Reviews | PostgreSQL (`maintenance_plans`, `maintenance_plan_visits`, `reviews`, `review_replies`, `review_requests` …) |
| Everything else (website, marketplace, marketing) | its module | the sample data, sample business only |

Analytics owns nothing: it reads the other modules.

## Testing

The Playwright suite drives the production build in Chromium against its own database. It covers each module's screens
and flows, then the whole product: a crawl of every route and state (no console error, hydration warning or failed
request), the sidebar and Overview quick actions, the sample-data invariants, session changes followed across modules,
five screen sizes, accessibility and colour contrast, identical text under other time zones, languages and clocks, and a
scan for leftovers and out-of-scope concepts. For the SaaS foundation it adds sign-up, log-in and log-out, session
expiry, business set-up, workspace switching, tenant isolation (through the browser and straight against PostgreSQL as
the restricted runtime role), Settings persistence, and source-level checks of the server boundaries. Each worker signs
in as the owner of its own copy of the Apex workspace, restored before every test.

At the last run all 2383 tests passed (67 spec files, about ten minutes on six workers): the earlier front-end and SaaS tests, none skipped and adapted only where Settings, customers, Services, the team, bookings, jobs, quotes, invoices, payments, maintenance plans and reviews are stored or every page needs a sign-in, plus the operations specs (SQL as the restricted role, bookings, jobs, the schedule, the cross-module checks and the business-time conversions) and the financial specs (money in cents, the payment and invoice rules, SQL as the restricted role with the concurrency tests, the seed round trip, and the record-payment, void and create-invoice flows through the real application) and the maintenance and review specs (the pure rules and totals, SQL as the restricted role with the concurrency tests, the seed round trip, and the create-plan, schedule-visit, reply, edit-reply and request-review flows through the real application).
See [docs/production-handoff.md](docs/production-handoff.md#testing-status) for what each group covers.

## Deploying

Nothing is deployed from this repository yet. The app is built so that one Ubuntu server (EC2) can run it later:
a `Dockerfile` builds the app and a one-off `tools` image that applies migrations; configuration is environment
variables only. See [docs/saas-architecture.md](docs/saas-architecture.md#17-deployment-and-the-future-aws-topology)
for the commands, the environment, the backup plan and the AWS layout.

## More

- [docs/saas-architecture.md](docs/saas-architecture.md): authentication, organizations, roles, tenant isolation, deployment, billing, what is deferred.
- [docs/production-handoff.md](docs/production-handoff.md): modules, routes, data model, limits.
- [docs/final-visual-audit.md](docs/final-visual-audit.md): how the finished product compares with the approved designs.
- [docs/stitch-screen-map.md](docs/stitch-screen-map.md): the design export, screen by screen, and every decision made where it contradicted itself.
