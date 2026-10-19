# Climvia Business Workspace

A multi-tenant workspace for HVAC service businesses: bookings and scheduling, jobs, customers and services, the team,
quotes, invoices and payments, maintenance plans, the public website and marketplace listing, reviews, marketing
campaigns, analytics and settings. People sign up, set up their business, and work in it; one person can belong to
several businesses, and one business's data is never visible to another.

## What this is, and what it is not

The **front end is complete** and the **SaaS foundation is in place**: real accounts, businesses ("organizations"), roles,
workspace switching, and a PostgreSQL database that keeps businesses apart. Every module is on the database.

- **On PostgreSQL now:** accounts and sessions, organizations, memberships and roles, the Business information, Business
  hours and Workspace preferences of each business, each person's profile name, the `sites` a business owns, its
  customers (with properties and equipment), Services and team, its **operations** (bookings, jobs with work details and
  photo records, the schedule derived from them, blocked time), its **money** (quotes, invoices and payments, in whole
  cents), its **maintenance plans and reviews** (plans with their coverage and included visits, reviews with replies
  and review requests), its **marketing campaigns** (Draft, Scheduled and Sent, with a snapshot of each campaign's
  recipients), **Analytics** (reporting queries over those records; the sample business's approved history that its
  detailed records cannot reproduce is stored as explicit imported adjustments), its **Website** (one primary Site and
  any others, each with one editable Draft and immutable Published versions of pages and sections, built from an
  application-owned template (four of them, with a Gallery to preview and choose from); published pages are public, the Draft only to people signed in; a visitor can book; a visual
  **Website Builder** edits the Draft in the browser and saves it whole, so a tab that is behind cannot overwrite a newer one) and its
  **Marketplace listing**. Each business sees only its own.
- **No module runs on sample data any more.** The sample business, Apex Climate Heating & Air, and a second one,
  Northstar, are seed data. A new business starts with a private Site and a Draft in neutral words, and no listing.
- **Not built:** email (so no verification, password reset or invitations by email), billing for Climvia itself, a payment
  processor, delivery of campaigns (a campaign is recorded as sent; no email or SMS provider exists) or of the Website's
  contact form, Internet DNS routing and certificates for custom domains (a domain can be claimed, verified and activated in the application; pointing its DNS and TLS at Climvia is the next phase),
  a profile photo that lasts beyond the visit, an image or media library, private files, a CDN, real S3 (the S3 driver is written
  and tested against a fake client, never against AWS), deployment to AWS.

Read [docs/saas-architecture.md](docs/saas-architecture.md) first: it explains the model, the isolation rules and what comes next.
[docs/production-handoff.md](docs/production-handoff.md) covers the front end.

## Stack

| | |
| --- | --- |
| Framework | Next.js 16.3.8 (App Router, typed routes), React 19.2.8, TypeScript 5 strict |
| UI | Tailwind CSS 4, lucide-react icons, Inter (self-hosted) |
| Database | PostgreSQL 17, Drizzle ORM + drizzle-kit migrations, `pg` |
| Auth | Better Auth (email + password, sessions in PostgreSQL) |
| Files | The business logo, behind a storage seam: a local directory in development, a private S3 bucket (`@aws-sdk/client-s3`) in production; `sharp` validates and re-encodes images |
| Local services | Docker Compose (PostgreSQL only; the app runs on your machine) |
| Tests | Playwright 1.63 (Chromium) against the production build and a dedicated test database |

No UI kit, state library or analytics client. No Supabase, Firebase, Clerk or Auth0, and no cloud SDK but the S3 client behind the storage seam.

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

### Custom domains

Website → Domain lets a business claim a domain for its Site, prove it owns it with a DNS TXT record (`_climvia-verification.<domain>`), and activate it so this application serves the Site for requests whose `Host` is that name. **Active in Climvia is not "live":** the domain's DNS and a certificate are separate and are not set up by this application. Climvia only reads DNS; it never writes a record or calls a DNS provider, and needs no credentials.

| | |
| --- | --- |
| `APP_HOSTS` | every other name this application answers on (besides `climvia.com`, `localhost`, IP addresses and the host of `BETTER_AUTH_URL`). Any other multi-label `Host` is treated as a customer's domain and shown "not found", so list each name a deployment is reached by. |
| `CUSTOM_DOMAIN_TARGET` | the name customers point their DNS at (shown in the instructions; can not be claimed). |
| `CUSTOM_DOMAIN_URL_SCHEME` | `https` (default) or `http` for local development: the scheme of a page's canonical address. |

In development nothing is needed: send any `Host` header to the local server (for example `curl -H "Host: www.example.test" http://localhost:3000/`) once a claim for that name is active. The tests never use the internet; they answer the DNS questions themselves. See saas-architecture §34.

### Uploaded files (the business logo)

Settings → Branding stores the logo. In development and in the tests it is kept in a **local directory** and needs no AWS account:

| | |
| --- | --- |
| `ASSET_STORAGE_DRIVER` | `local` (the default outside production) or `s3`. **Required in production.** |
| `ASSET_LOCAL_DIR` | where the local driver writes. Default `.data/assets`: git-ignored, never under `public/`, never served by path (every file is reached through `/assets/<id>`). In a container it is a mounted volume (`/data/assets`). |
| `TEST_ASSET_DIR` | the end-to-end tests' own directory (default `.data/assets-test`), recreated with the test database |
| `AWS_REGION`, `AWS_S3_BUCKET` | the S3 driver (a **private** bucket). Credentials are the AWS default provider chain (an IAM role in production); never put keys in `.env` |

The files are runtime data: back the directory up with the database, and `npm run db:reset` clears it with the database. `sharp` is a native dependency (installed by `npm install`).

### Database scripts

| Script | Does |
| --- | --- |
| `npm run db:generate` | writes a new SQL migration after you change the schema in `src/db/schema` |
| `npm run db:migrate` | creates the `climvia_app` role if missing and applies pending migrations (safe to repeat) |
| `npm run db:seed` | inserts the development data below (idempotent; refuses to run when `NODE_ENV=production`) |
| `npm run db:reset` | drops, recreates, migrates and seeds the **development** database (run it once after pulling Phase 14: the seed only fills a business that has no core data yet) |
| `npm run db:studio` | opens drizzle-kit Studio |
| `npm run db:test:prepare` | recreates the separate `climvia_test` database, migrates and seeds it (run for you by `npm run test:e2e`) |

### Platform administrators

Climvia's own console (`/platform-admin`) is for the people who run the platform, not for the businesses on it. **A platform super administrator is not an Organization owner**, and nothing creates one automatically: public signup never does, the seed does not, and no address is written in the code. After a person has signed up like anyone else, an operator grants them access from the command line (it needs the database owner's credential in `DATABASE_ADMIN_URL`):

| Script | Does |
| --- | --- |
| `npm run platform-admin:grant -- --email <address>` | makes an **existing** account a platform super administrator (an unknown address is refused; running it again changes nothing) |
| `npm run platform-admin:revoke -- --email <address>` | takes it away at once; the account and its businesses are untouched |
| `npm run platform-admin:list` | shows who is an administrator now |

They then sign in at `/platform-admin/login` with their ordinary account. In the container stack the same commands run through the tools image (`docker compose run --rm migrate npm run platform-admin:grant -- --email <address>`). See [docs/saas-architecture.md](docs/saas-architecture.md#36-platform-administration-phase-19a) and [docs/deployment-runbook.md](docs/deployment-runbook.md).

### Development accounts

All use the `SEED_PASSWORD` from your `.env`. None of them is a platform administrator.

| Email | Workspaces |
| --- | --- |
| `alex.morgan@apex.test` | Apex Climate Heating & Air, owner (has the canonical customers, Services, team, bookings, jobs, financials, plans, reviews, marketing campaigns and imported Analytics history, and the approved website at `/sites/apexclimate` and listing) |
| `jamie.rivera@apex.test` | Apex, member (can view Settings, not change them) |
| `taylor.brooks@northstar.test` | Northstar Heating & Cooling, owner (a small set of its own customers, Services, team, two bookings and a job, and its own website at `/sites/northstar` and listing; none of Apex's) |
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
    (signed-in)/    verifies the person and mounts the workspace's providers for the two groups inside it:
      (workspace)/  every module, inside the one shell (sidebar + top bar), behind a verified workspace
      (preview)/    the signed-in Draft previews (`/website/preview`, `/marketplace/preview`): no shell
    (public)/       no shell, no providers, no session: the published Websites (`/sites/<slug>`) and Marketplace listings (`/listings/<slug>`)
    (unmatched)/    an address that matches no route
    api/auth/       Better Auth's endpoints
    layout.tsx      the document, fonts and global styles only (the workspace's providers are mounted by `(signed-in)`)
  components/       one folder per module, plus auth/, shell/ (layout), workspace/ and ui/ (shared primitives)
  config/           navigation (the sidebar) and typed route helpers
  data/             types and selectors per module (every module is read from PostgreSQL for the active business)
  db/               the PostgreSQL schema (Drizzle), the connection, and the tenant-context helpers
  lib/              auth setup, validation, state transitions, the operations rules, business-time conversions, date and display helpers
  server/           server-only code: session, active workspace, organizations, Server Actions (including bookings and jobs, the Website and the Marketplace, and the visitor's booking), the public read path
  proxy.ts          the early "no session cookie" redirect (not the security boundary)
drizzle/            SQL migrations, including the Row Level Security policies
scripts/db/         migrate, seed (and seed-data/, the canonical Apex and the Northstar records, websites and listings included), reset, test-database preparation and `template-sql.ts` (prints the `INSERT` of the application's website Templates)
e2e/                Playwright specs and their helpers
docs/               SaaS architecture, design map, visual audit, production handoff
```

- **The shell.** `AppShell` (top bar, 240 px sidebar, content area) wraps every route in `(signed-in)/(workspace)` and stays mounted
  as the user moves between modules. The published Sites and listings live in `(public)` and the Draft previews in `(signed-in)/(preview)`, so they never get the workspace chrome, and a public page never loads the workspace's providers whoever is signed in.
- **Who is signed in, and where.** `resolveWorkspace()` (`src/server/workspace.ts`) validates the session in the database,
  lists the person's memberships and picks the active workspace (a cookie is only a preference, re-checked each time).
  Every page and Server Action asks it again next to its data; PostgreSQL's Row Level Security checks once more.
- **Providers.** One provider per area is mounted once at the root, around the signed-in workspace only, so the Draft
  previews read the same session as the workspace. The published pages need no session and read nothing from a provider. Signing in or out and switching workspace are full page loads, so one
  business's state can never carry into another's.
- **Records and selectors.** `src/data/*` holds the types and the pure selectors that derive everything shown; the records
  themselves come from PostgreSQL for the active business. The approved sample records are seed data (`scripts/db/seed-data`).
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
| Marketing campaigns, chosen customers, recipient snapshots | Marketing | PostgreSQL (`marketing_campaigns`, `marketing_campaign_selected_customers`, `marketing_campaign_recipients`) |
| Websites: Sites, versions, pages, sections, theme; the four Templates | Website | PostgreSQL (`sites`, `site_versions`, `site_pages`, `site_sections`, `site_templates`); business details and Services are read live, never copied |
| The Website Builder's edits (pages, sections, theme) | Website → Edit website | Browser memory until **Save changes**, then the Draft in PostgreSQL, saved whole against a revision (§29 of the architecture notes) |
| Marketplace listing and its selected Services | Marketplace | PostgreSQL (`marketplace_listings`, `marketplace_listing_services`) |

Analytics owns no records: its figures are computed from the other modules' rows, plus the sample business's imported
adjustments (`analytics_imported_baselines`, written by the seed, read-only for the application).

## Testing

The Playwright suite drives the production build in Chromium against its own database. It covers each module's screens
and flows, then the whole product: a crawl of every route and state (no console error, hydration warning or failed
request), the sidebar and Overview quick actions, the sample-data invariants, session changes followed across modules,
five screen sizes, accessibility and colour contrast, identical text under other time zones, languages and clocks, and a
scan for leftovers and out-of-scope concepts. For the SaaS foundation it adds sign-up, log-in and log-out, session
expiry, business set-up, workspace switching, tenant isolation (through the browser and straight against PostgreSQL as
the restricted runtime role), Settings persistence, and source-level checks of the server boundaries. Each worker signs
in as the owner of its own copy of the Apex workspace, restored before every test.

The tests need the project's own PostgreSQL: Docker running and `docker compose up -d postgres` (the container `climvia-postgres` on `127.0.0.1:5432`, with the credentials in `.env`). `npm run test:e2e` creates, migrates and seeds its separate `climvia_test` database in it. Nothing else is supported as the local database.

At the last run all 3416 tests passed (115 spec files, about 14 to 17 minutes): the earlier front-end and SaaS tests, none skipped and adapted only where Settings, customers, Services, the team, bookings, jobs, quotes, invoices, payments, maintenance plans, reviews, marketing campaigns, Analytics, the Website and the Marketplace are stored or every page needs a sign-in, plus the operations specs (SQL as the restricted role, bookings, jobs, the schedule, the cross-module checks and the business-time conversions) and the financial specs (money in cents, the payment and invoice rules, SQL as the restricted role with the concurrency tests, the seed round trip, and the record-payment, void and create-invoice flows through the real application) and the maintenance and review specs (the pure rules and totals, SQL as the restricted role with the concurrency tests, the seed round trip, and the create-plan, schedule-visit, reply, edit-reply and request-review flows through the real application) and the marketing and analytics specs (the pure campaign and reporting rules, SQL as the restricted role with the campaign concurrency tests, the seed round trip, and the save-draft, schedule, send, cancel, duplicate, date-range and export flows through the real application) and the website and marketplace specs (the pure section, theme, template and booking rules, SQL as the restricted role and as nobody through the three public functions, publishing's atomicity and concurrency, more than one Site in a business, the Server Actions replayed as a member, as nobody, as another business and six at once, the public pages and what they never show, a visitor's booking, a new business, the built JavaScript, and the seed round trip) and the Website Builder specs (the editing core as pure functions, saving a Draft on PostgreSQL with its revision, stale-tab and concurrency tests, and the Builder in the browser: pages, sections, the theme, Undo and Redo, Publish, the preview sizes, leaving with unsaved work, the inert canvas and accessibility) and the website Template specs (the four definitions and the rows the migration wrote, the Gallery and the preview, choosing a Template with its confirmation and every way of cancelling, a tab that is behind, a member who may only look, the Server Action replayed as nobody, as a member, with forged arguments and as another business, each Template as a visitor gets it on every page at three widths, and the Builder working on each Template) and the tenant-fixture specs (no Client Component reaches a business's sample records through any chain of imports, no business's values are in the source or in the client JavaScript the production build emits, and Apex, Northstar, a business that has just been set up and a visitor to a Site each get only their own values in pages and scripts) and the asset and branding specs (the storage seam on a local directory and against a fake S3 client, the image checks, the upload endpoint, SQL as the restricted role with the concurrency tests, the public Asset route, Settings → Branding in the browser, the logo on each Template and in the Builder and the listing, and a restart of the server that keeps the logo) and the custom-domain specs (the hostname normalizer and the reserved names, the state machine, SQL as the restricted role with the races, the claim lifecycle against test DNS answers, every request by Host against the running server including the forged headers and two businesses, booking through a customer's name, the Domain Manager, and the lines that keep tokens and DNS code out of the browser) and the production-runtime specs (the configuration a deployment must have and the refusal to start without it, the health checks, the certificate-permission endpoint, a forged forwarded header, and the container, proxy, env-file and script files held to their rules). The platform console has its own specs (`platform-admin-*`: the database functions, the command-line tools, the routes for every kind of caller, the console in a browser, a database with nothing in it, and the import boundary). The Docker-side tests (`npm run test:docker`, 41, against a running stack) are separate.
See [docs/production-handoff.md](docs/production-handoff.md#testing-status) for what each group covers.

## Deploying

Nothing is deployed to AWS yet, but the application runs as a production-shaped stack that was built and run for real (Phase 18C1): a reverse proxy
(Caddy), the web app, PostgreSQL and a migration that runs before the app, from `docker-compose.production.yml`. Only the proxy publishes a port; the
app runs read-only as an unprivileged user; configuration is environment variables in one git-ignored file.

```bash
cp .env.production.example .env.production     # replace every placeholder (the comments say how to generate each)
npm run config:check -- .env.production        # fails with a list of what is wrong, before anything is built
deploy/scripts/deploy.sh                       # build, check, migrate, start, verify
deploy/scripts/backup.sh                       # a checksummed database dump (and backup-assets.sh for uploaded logos)
deploy/scripts/restore-drill.sh                # restore it beside the real database and prove the two hold the same data
```

A new deployment has no business in it (nothing seeds data); the first person to sign up creates theirs. `npm run test:docker` runs the Docker-side tests
against a running stack (separate from `npm run test:e2e`, which needs no Docker for the application).
See [docs/deployment-runbook.md](docs/deployment-runbook.md) for the commands, backups, recovery and troubleshooting, and
[docs/saas-architecture.md](docs/saas-architecture.md#35-the-production-container-runtime-phase-18c1) for how it is built and what was proved.

## More

- [docs/saas-architecture.md](docs/saas-architecture.md): authentication, organizations, roles, tenant isolation, deployment, billing, what is deferred.
- [docs/production-handoff.md](docs/production-handoff.md): modules, routes, data model, limits.
- [docs/deployment-runbook.md](docs/deployment-runbook.md): deploying, backing up, restoring and recovering the production stack.
- [docs/final-visual-audit.md](docs/final-visual-audit.md): how the finished product compares with the approved designs.
- [docs/stitch-screen-map.md](docs/stitch-screen-map.md): the design export, screen by screen, and every decision made where it contradicted itself.
