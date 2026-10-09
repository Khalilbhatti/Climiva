# Climvia SaaS architecture

How Climvia became a multi-tenant product: who signs in, which business they are working in, what each person may do there, and how the
database keeps one business's data away from every other. Written for the next developer. It describes what **exists**; what is only planned
says so.

Read [production-handoff.md](production-handoff.md) for the front end, which this phase left intact.

## Contents

1. [Status and scope](#1-status-and-scope)
2. [Stack](#2-stack)
3. [Authentication model](#3-authentication-model)
4. [Profile model](#4-profile-model)
5. [Organization model](#5-organization-model)
6. [Memberships](#6-memberships)
7. [Authorization roles](#7-authorization-roles)
8. [Active-organization resolution](#8-active-organization-resolution)
9. [Tenant query rules](#9-tenant-query-rules)
10. [Database isolation (Row Level Security)](#10-database-isolation-row-level-security)
11. [Settings migration](#11-settings-migration)
12. [Transitional fixtures](#12-transitional-fixtures)
13. [Organization → many Sites](#13-organization--many-sites)
14. [The future Website Builder](#14-the-future-website-builder)
15. [Local development](#15-local-development)
16. [Deployment and the future AWS topology](#16-deployment-and-the-future-aws-topology)
17. [Backups](#17-backups)
18. [SaaS billing vs. business-customer payments](#18-saas-billing-vs-business-customer-payments)
19. [Future domain routing](#19-future-domain-routing)
20. [Deferred domain migrations](#20-deferred-domain-migrations)
21. [Testing](#21-testing)
22. [Known limitations](#22-known-limitations)

## 1. Status and scope

Before this phase Climvia was a single-business front end: one hard-coded business (Apex Climate Heating & Air), no sign-in, every edit lost on
reload. Now:

| Done | Not done (deliberately) |
| --- | --- |
| Real sign-up, log-in, log-out (Better Auth, sessions in PostgreSQL) | Email verification, password reset, invitations by email (no mail service yet) |
| Organizations, memberships, owner / admin / member roles | A UI to invite or remove members, or to change roles |
| Many people ↔ many businesses; a workspace switcher | Billing for Climvia itself |
| New-business onboarding in one transaction | Customers, services, jobs, bookings, payments, quotes, invoices, team (still sample data, see §12) |
| Business information, Business hours, Workspace preferences and the profile name stored in PostgreSQL | Logo / branding / avatar storage (needs object storage) |
| Strict tenant isolation: server authorization **and** PostgreSQL Row Level Security | The visual Website Builder, templates, domains |
| `sites` table: one organization owns many sites | Deployment to AWS |

## 2. Stack

| | |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript strict |
| Database | PostgreSQL 17 |
| ORM and migrations | Drizzle ORM + drizzle-kit (SQL migrations in `drizzle/`), `pg` driver |
| Auth | Better Auth (email + password), Drizzle adapter |
| Local services | Docker Compose, PostgreSQL only; the app runs on the host |
| Hosting (later) | A single Ubuntu EC2 instance, see §16 |

Not used, on purpose: Supabase, Firebase, Clerk, Auth0 or any other backend-as-a-service; any AWS SDK; Redis; a queue.

## 3. Authentication model

Better Auth does the hashing, tokens and cookies. Climvia configures it in `src/lib/auth.ts` and mounts it at `/api/auth/*`
(`src/app/api/auth/[...all]/route.ts`).

- **Identity** is the Better Auth `auth_user` / `auth_account` / `auth_session` / `auth_verification` tables. Passwords are hashed by Better Auth
  (never by Climvia code). Length 8–128.
- **Sessions** are rows in `auth_session`; the browser holds a signed, `httpOnly`, `SameSite=Lax` cookie (`Secure` when served over https). Lifetime
  7 days, refreshed daily. The cookie cache is **off**: every request looks the session up in PostgreSQL, so signing out, or deleting the row,
  takes effect on the next request even if the browser keeps the cookie.
- **A session says who someone is, not which business they may enter.** That is a membership (§6), checked on every request.
- **Protections kept on:** Better Auth's origin / fetch-metadata (CSRF) checks, and rate limiting (3 sign-ins or sign-ups per 10 s per address, in production).
  Telemetry is off. Server actions are protected by Next.js' own origin check.
- **Rate limiting needs the client address.** Behind a reverse proxy set `AUTH_TRUSTED_PROXIES` (IPs or CIDR ranges) so the real client is read from
  `X-Forwarded-For`; without it a multi-hop header cannot be trusted and all clients share one bucket. Bind the app to loopback / a private network
  so only the proxy can reach it.
- **No email yet**, so addresses are not verified (`requireEmailVerification: false`) and there is no password reset. Both arrive with a mail
  service; until then a forgotten password needs an operator.
- **Log-out** (`signOutAction`) deletes the session row, clears the cookie and forgets the active-workspace cookie, then the browser does a full page load.
- **Early redirect, not the boundary.** `src/proxy.ts` (Next's renamed middleware) sends a visitor with no session *cookie* to Log in before anything renders. It does
  not touch the database and is not security: the real checks are in §9.

Flow of a protected request: `proxy.ts` (cookie present?) → root layout and page call `resolveWorkspace()` (session valid in the database? active membership?)
→ queries run inside a tenant transaction (§10) → PostgreSQL checks membership again.

## 4. Profile model

Two separate things, on purpose:

- `auth_user`: **identity**. Sign-in email, password (in `auth_account`), Better Auth's own fields. Climvia does not copy the email anywhere.
- `profiles` (one row per user): what Climvia *shows* about a person: `full_name` and a reserved `avatar_url`. Created when the account is created (a Better Auth hook), and on demand if
  that ever failed.

A profile has **no role and no email**. Authority is per business (§6, §7), so the same person can be an owner in one workspace and a member in another. The
label shown beside someone's name ("Operations Lead") is `organization_memberships.job_title`: display only, it grants nothing.

Anyone signed in can change their own name (Settings → My profile). The sign-in email is shown (read-only) in the account menu. A chosen photo is displayed for the
session only until file storage exists.

## 5. Organization model

An **organization** is a business workspace (`organizations`). Everything a business owns carries `organization_id` and is reached through a verified membership.

- Columns: name, a unique URL-safe `slug`, contact details, address, `timezone` (required, IANA), `currency` (`USD`; the only option today), `date_format`, `time_format`, `onboarding_completed_at`, and
  the transitional `fixture_set` (§12). Constraints enforce the formats.
- Nothing in the schema or code knows a business by name. Apex Climate Heating & Air is a row the **development seed** inserts, exactly like a production sign-up would.
- **Creating one** (`createOrganizationForUser`, `src/server/organizations.ts`), in **one transaction**: the organization, the creator's `owner` membership, seven
  `organization_business_hours` rows and a first draft **site** (§13). If any step fails nothing is kept. It creates no customers, services, jobs, bookings or financial records.
  The slug is derived from the name and made unique with a random suffix on collision (a savepoint per attempt).
- **Onboarding** (`/onboarding`, `OnboardingFlow`): Business → Contact & location → Preferences (time zone, currency) → Hours → Review & create. Reachable at `/onboarding?new=1` to add another business.
- Organizations are never deleted through the app.

## 6. Memberships

`organization_memberships` links one user to one organization (unique pair), with a `role` (`owner`, `admin`, `member`), a `status` (`active`, `invited`) and an optional `job_title`.

- One person can belong to many organizations; an organization has many people.
- Only **active** memberships grant access. `invited` is reserved for the invitation flow.
- The runtime database role cannot UPDATE or DELETE membership rows. Accepting an invitation, changing a role and removing a member are SQL functions
  (`app_accept_invitation`, `app_set_member_role`, `app_remove_member`) that **cannot remove or demote the last owner**, and only an owner can change roles.
- Deleting a user or an organization removes the membership rows (access ends); nothing else cascades from them.

## 7. Authorization roles

These roles are **SaaS authorization**: what a person may do to the *workspace*. They are separate from the Team module's staff roles and permission matrix, which describe the
business's own employees and stay product data.

| | Owner | Admin | Member |
| --- | :-: | :-: | :-: |
| Enter and use the workspace | ✓ | ✓ | ✓ |
| Read Business information, hours, preferences | ✓ | ✓ | ✓ |
| Change Business information, hours, preferences | ✓ | ✓ | ✗ |
| Change their own profile name | ✓ | ✓ | ✓ |
| Invite admins / members (database-level; no UI yet) | ✓ | ✓ | ✗ |
| Change a member's role (database-level; no UI yet) | ✓ | ✗ | ✗ |
| Be the last person left | cannot be removed or demoted | | |

The same rule is enforced **three times**: the form is disabled for a member (`WorkspaceSnapshot.canEditSettings`), the server action refuses (`NOT_ALLOWED`), and the RLS
policy denies the write.

## 8. Active-organization resolution

A person may belong to several workspaces, so every request needs *the one in use*. `resolveWorkspace()` (`src/server/workspace.ts`) decides it once per request:

1. Read the session from the database. None → anonymous.
2. List the person's **active** memberships. None → "no organization" (sent to onboarding).
3. Look at the `climvia_org` cookie (an `httpOnly`, `SameSite=Lax` cookie holding an organization id). If it names one of those memberships, that is the active
   organization; if it is missing, stale or **someone else's**, fall back to the person's first membership.
4. Load that organization's settings, the person's profile and role, and build the `WorkspaceSnapshot` handed to the browser.

The cookie is only a **preference, never authority**: it is re-checked against the memberships on every request, so editing it can only select a workspace the person already belongs to.

**Switching** (`switchOrganizationAction`) verifies the membership, sets the cookie, and the browser does a **full page load**. Signing in, signing out, finishing onboarding and
switching are all full loads on purpose: the settings, demo stores and router cache of the previous workspace cannot survive into the next one. Pages are `force-dynamic` and never cached
between requests or people.

## 9. Tenant query rules

Follow these for every table and query you add.

1. **Every organization-owned table has `organization_id uuid not null references organizations(id)`**, `ENABLE ROW LEVEL SECURITY`, policies (§10) and an
   explicit `GRANT` to `climvia_app`. A new table has *no* access for the runtime role until a migration grants it.
2. **The organization comes from `resolveWorkspace()`, never from the request.** No server action or route takes an `organizationId` from the client and trusts it. (`switchOrganizationAction` takes
   one, and *verifies* it against the caller's memberships.)
3. **Run queries through `withTenant({ userId, organizationId }, tx => …)`** (or `withUser` for a person's own data). Never query a tenant table on the bare `getDb()`: with no context
   the policies are false and you get nothing, by design.
4. **Check the role** (`canManage`) in the action *and* write the policy.
5. **Validate input on the server** (`src/lib/validation.ts`) even though the form validated it. Return an `ActionResult` (errors are values) rather than throwing text.
6. **Never cache tenant data across requests**: no `unstable_cache`, no `fetch` cache, no module-level variables holding rows, no `generateStaticParams` over tenant data. React's `cache()` is fine (per request).
7. **Modules still on sample data call a gate first** (§12).
8. **Keep server code out of the browser**: nothing in `src/db`, `src/server` or `src/lib/auth.ts` may be imported by a `"use client"` file (a test fails if one is).

Why each page checks for itself: in Next.js a layout is not re-rendered when you move between pages beneath it, and it cannot stop the pages from running. The layout is a first check; the page
(next to its data) is the real one.

## 10. Database isolation (Row Level Security)

Server checks can have bugs. So PostgreSQL enforces isolation too (`drizzle/0001_rls_policies_and_grants.sql`).

**Two roles.** `climvia_owner` owns the tables and runs migrations and seeds. `climvia_app` is what the running app connects as (`DATABASE_URL`): `LOGIN`, **not** superuser, **not**
`BYPASSRLS`, **not** the table owner, so every policy applies to it. The app never receives the owner's credentials (`DATABASE_ADMIN_URL`).

**Transaction-scoped context.** Each tenant query opens a transaction that starts with:

```sql
select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)
```

`true` makes the settings local to the transaction: they vanish at COMMIT/ROLLBACK and can never leak to the next request on a pooled connection. The values come from server code that has just
verified the session and membership, as bound parameters.

**The policies do not trust the context blindly.** They call `SECURITY DEFINER` helpers (`app_is_member`, `app_has_role`, `app_org_has_members`) that look the user up in
`organization_memberships` *again*, so a server bug that supplies the wrong organization id still returns no rows.

**Fail closed.** With no context set, `app_current_user_id()` is `NULL` and every policy is false.

| Table | Read | Write |
| --- | --- | --- |
| `organizations` | any member | any signed-in user may create one; owner/admin of the **active** org may update; nobody deletes |
| `organization_memberships` | your own rows and your co-members | creator becomes first owner; owner/admin may invite; **changes only via the `app_*` functions** |
| `organization_business_hours`, `sites` | members of the active org | owner/admin of the active org |
| `profiles` | only your own row | only your own row |
| `auth_*` | Better Auth manages these before anyone is signed in | |

**Least privilege.** Column-level grants mean the runtime role cannot set `fixture_set` or rewrite ids; it has no DELETE on organizations, no UPDATE/DELETE on memberships.

**Verified by tests** (`e2e/database-isolation.spec.ts`), connecting as `climvia_app` to a freshly migrated database: no context → no rows; user A sees only A's organization; user B only B's; a forged
`app.org_id` for an organization the user is not in → no rows; cross-tenant INSERT / UPDATE / DELETE blocked; the last owner cannot be removed; the runtime role cannot change `fixture_set`.

What RLS does **not** protect against: a database superuser or the owner role (keep their credentials out of the app and the browser), and a mistake that grants a new table to `climvia_app` without a policy.

## 11. Settings migration

Only four things moved to PostgreSQL. The screens and fields are unchanged.

| Settings section | Stored in | Who may write |
| --- | --- | --- |
| Business information (name, phone, email, address) | `organizations` | owner, admin |
| Business hours | `organization_business_hours` (seven rows, replaced together) | owner, admin |
| Workspace preferences (time zone, date style, time style; currency `USD`) | `organizations` | owner, admin |
| My profile (name) | `profiles` | the person |
| Branding (logo, accent) | **not stored**: lasts for the session, needs file storage | any member (session only) |

Saved hours drive the booking slots: the Website booking journey, the Schedule and Team availability read the stored hours. The saved time zone and styles drive every date and time. The Apex seed keeps
`America/Chicago`, `USD`, `MMM D, YYYY`, 12-hour time. A form commits to the screen only after the server accepted the save, so what is shown is never ahead of what is stored.

Date/time formatting reads a small module-level style (`src/lib/display-preferences.ts`). The server never writes it (it serves many workspaces at once); a workspace with a non-default style applies it
after hydration, which remounts the tree once. The first render is always the default style, so hydration matches.

## 12. Transitional fixtures

Customers, Services, Team, Bookings, Schedule, Jobs, Quotes & Invoices, Payments, Maintenance Plans, Website, Marketplace, Reviews, Marketing, Analytics and the customer-facing previews still run on
the sample dataset in `src/data/*`, held in React state for the visit.

- That dataset belongs to **one** business. An organization flagged `fixture_set = 'apex-demo'` sees it; **any other organization sees "isn't available for *Name* yet"**. The flag is set by the seed only
  (the runtime role has no column grant to set it).
- Every page and layout of those modules calls `await fixtureGate("Module")` first (`src/server/fixture-gate.tsx`) and returns the replacement if it is not the sample business.
  The public previews use `publicGate()`; metadata uses `hasSampleDataAccess()`. A test fails if a fixture-backed page forgets it.
- Overview shows a plain "Your workspace is ready" state with the real business card for any other workspace; sidebar counts and global search are sample-business only.
- **No silent fallback.** If sign-in, the database, the organization or the membership fails, the app redirects to Log in, shows an error, or shows the unavailable state. It never falls back to
  showing the Apex sample.
- The sample dataset is compiled into the browser JavaScript (it is static, fictional demo data, not tenant data). It is removed module by module as each moves to PostgreSQL (§20).

## 13. Organization → many Sites

`sites` belongs to an organization (`ON DELETE RESTRICT`): **one organization, many sites**. Columns: `name`, `slug` (unique within the organization), `status`
(`draft | published | archived`), `selected_template_id` (reserved, plain text for now), `primary_domain` (reserved; unique across all sites once set, lower-case). Onboarding creates one draft site
named after the business.

There is deliberately no pages, sections, templates or domain infrastructure, and no "website" field on the organization.

## 14. The future Website Builder

The ownership chain is fixed so the builder adds tables without changing anything above it:

```
Organization ──< Site ──< Page ──< Section
                  │
                  ├── selected template (a preset the builder will define)
                  └── primary domain + additional domains (§19)
```

The builder will add `site_pages`, `site_sections` (and a template table), each carrying `organization_id` with the same policies and grants as `sites`, so they inherit §9 and §10 unchanged.
The current Website module (page editors, preview, booking journey) is the product design the builder will be built from.

## 15. Local development

```bash
cp .env.example .env            # then replace every placeholder (openssl rand -base64 32 for secrets)
docker compose up -d postgres   # PostgreSQL 17 on 127.0.0.1:5432, data in a named volume
npm install
npm run db:migrate              # creates the runtime role, applies every migration
npm run db:seed                 # development data (refuses to run when NODE_ENV=production)
npm run dev
```

| Script | Does |
| --- | --- |
| `db:generate` | drizzle-kit: new SQL migration from schema changes |
| `db:migrate` | creates the `climvia_app` role if missing, applies pending migrations (safe to repeat) |
| `db:seed` | the development data below (idempotent) |
| `db:reset` | drops, recreates, migrates and seeds the **development** database |
| `db:studio` | drizzle-kit Studio |
| `db:test:prepare` | recreates `climvia_test` from nothing and migrates + seeds it (run automatically by `npm run test:e2e`) |

Seed data: two businesses that differ in every setting the app shows, so any leak is visible.

| Business | Notes |
| --- | --- |
| Apex Climate Heating & Air | the approved sample record; Austin, `America/Chicago`, USD, `MMM D, YYYY`, 12-hour; flagged with the sample dataset |
| Northstar Heating & Cooling | invented; Denver, `America/Denver`, ISO dates, 24-hour; **no** sample dataset |

| User | Password | Workspaces |
| --- | --- | --- |
| `alex.morgan@apex.test` | `SEED_PASSWORD` | Apex (owner) |
| `jamie.rivera@apex.test` | `SEED_PASSWORD` | Apex (member, cannot edit settings) |
| `taylor.brooks@northstar.test` | `SEED_PASSWORD` | Northstar (owner) |
| `casey.nguyen@climvia.test` | `SEED_PASSWORD` | Apex (admin) **and** Northstar (admin) |

`.test` is a reserved domain that can never receive mail. Seed data is development tooling: nothing in `src/` imports it and the app never falls back to it.

## 16. Deployment and the future AWS topology

Nothing is deployed in this phase. The app is built so that one Ubuntu EC2 instance can run it later.

**Container.** `Dockerfile` (multi-stage) builds the Next.js standalone server and runs it as an unprivileged user; a second target (`tools`) runs the database scripts.

```bash
docker build -t climvia-web .                              # the app
docker build --target tools -t climvia-tools .             # one-off database commands

docker run --rm --env-file .env.production climvia-tools   # apply migrations (npm run db:migrate)
docker run -d --name climvia --restart unless-stopped \
  --env-file .env.production -p 127.0.0.1:3000:3000 climvia-web
```

Secrets are never baked into an image (`.dockerignore` excludes every `.env*` except the example). Production environment, all required:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | the app's connection, as **`climvia_app`** |
| `DATABASE_ADMIN_URL` | the owner's connection: used only by the `tools` container for migrations; never given to the app container |
| `POSTGRES_APP_PASSWORD` | password `db:migrate` sets for `climvia_app` (≥ 12 chars) |
| `BETTER_AUTH_SECRET` | ≥ 32 random characters |
| `BETTER_AUTH_URL` | the public origin, e.g. `https://app.example.com` |
| `AUTH_TRUSTED_PROXIES` | the reverse proxy's address / CIDR (see §3) |
| `AUTH_TRUSTED_ORIGINS` | optional extra allowed origins |

Do not run `db:seed` in production.

**Single-EC2 target** (design only):

```
Internet ── 443 ──> Caddy or nginx (TLS, sets X-Forwarded-For)
                       └─> 127.0.0.1:3000  Next.js container (climvia-web)
                                   └─> PostgreSQL  (container with a persistent EBS volume, or RDS later)
```

- Security group: 80/443 from anywhere, 22 from the operator only; PostgreSQL never public.
- The app container and PostgreSQL share a private Docker network; the app holds only the `climvia_app` credentials.
- Logs to stdout (collected by Docker / CloudWatch agent later). Health check: `GET /login` returns 200.
- Later, as needed and not before: S3 for logos / avatars / site assets, SES for mail (verification, reset, invitations), RDS for the database, CloudFront for static assets.

> **Verification note.** Docker was not available in the environment this phase was developed in, so `docker-compose.yml`, the `Dockerfile` and `.dockerignore` were written to the documented behaviour of
> Docker and Next.js but **not executed there**. PostgreSQL behaviour (migrations, roles, RLS) was verified on a real PostgreSQL 17 server, not through Docker. Run `docker compose up -d postgres` and
> `docker build .` once on a machine with Docker before relying on them.

## 17. Backups

Not implemented; this is the plan.

- **Nightly logical backup:** `pg_dump --format=custom` of the database, taken by a cron job / systemd timer on the host (or a sidecar container), written to a local directory first.
- **Off-host, encrypted:** the dump is encrypted (for example `age` or `gpg`, or S3 server-side encryption with a KMS key) and copied to a private S3 bucket (block all public access, versioning on,
  lifecycle rule to expire old dumps, bucket policy limited to the backup role).
- **Retention:** daily for 14 days, weekly for 8 weeks, monthly for 12 months.
- **Restore drill:** restore the latest dump into a scratch database (`pg_restore`) on a schedule and run `db:migrate` + a smoke test. A backup that was never restored is not a backup.
- On RDS the same job is replaced by automated snapshots plus point-in-time recovery.

No AWS SDK is in the application; backups are an operations concern, outside the app.

## 18. SaaS billing vs. business-customer payments

Two different money flows. They must never share tables, code or credentials.

| | **SaaS billing** | **Business-customer payments** |
| --- | --- | --- |
| Who pays whom | A business pays **Climvia** for the product (plan, seats, usage) | A business's **customer** pays the **business** (invoices, deposits, maintenance plans) |
| Belongs to | The Climvia platform; attached to an **organization** as the billed account | The business (a tenant); attached to its customers and invoices |
| Where it lives | Future platform tables (`subscriptions`, `plans`, `billing_events`), a Climvia-owned Stripe account | The existing **Payments / Quotes & Invoices** modules, a Stripe Connect account *per business* |
| Today | Not built | Sample data; payments are recorded manually (no processor) |

Billing will hang off the organization (`organizations.id`), never off a user, because the business is the customer. Gating features by plan will be a check beside the role check in §9.

## 19. Future domain routing

Not built. The intended design: a request's host name selects the **site**, and the site selects the organization.

- `sites.primary_domain` is unique across all sites, lower-case, and reserved for this.
- A proxy / edge function resolves `Host` → site → organization and renders the public site read-only. Public site traffic needs no session and must read only through a narrow, published-content path, not the
  tenant policies of §10 (which require a signed-in member).
- A `<slug>.climvia.app`-style subdomain for every site plus customer-owned custom domains (with DNS verification and certificates) is the likely shape.
- The authenticated app stays on its own host so cookies and CSRF origins stay separate from public sites.

## 20. Deferred domain migrations

Each of these moves from sample data to PostgreSQL in its own phase, with `organization_id`, RLS and tests as in §9–§10. When a module moves, its `fixtureGate` call is deleted and it works for every organization.

Suggested order (dependencies first): Services → Customers (+ properties, equipment) → Team (staff, roles) → Bookings → Schedule → Jobs → Quotes & Invoices → Payments → Maintenance Plans → Reviews →
Marketing → Website (then the Builder) → Marketplace → Analytics (derived last). Also pending: branding / logo / avatar storage, invitations and member management, email.

## 21. Testing

The Playwright suite runs against a **production build** and a **separate database** (`climvia_test`), recreated, migrated and seeded from nothing on each `npm run test:e2e`: which is also the clean-database migration and seed check.

- Each worker signs in over HTTP as the owner of its **own copy of the Apex workspace**, restored to the canonical record before every test (Settings is stored now, so tests cannot share one).
- Every test gets its own client address (`X-Forwarded-For`), so login rate limiting does not couple tests together.
- Specs: authentication, onboarding, workspace switching, tenant isolation (HTTP and page level), database isolation (SQL as `climvia_app`), Settings persistence, server boundaries, plus the existing front-end suite.

## 22. Known limitations

- Email verification, password reset, invitations and member management have no UI: they need a mail service and are the next SaaS work.
- Branding, logo and avatar are session-only until object storage exists.
- The sample dataset ships in the browser bundle (fictional, public, not tenant data) until its modules migrate.
- Docker artifacts are authored but were not executed in the development environment (see §16).
- `AUTH_TRUSTED_PROXIES` must be set correctly in production or login rate limiting degrades to one shared bucket.
- The four `auth_*` identity tables have no Row Level Security: Better Auth must read them before anyone is signed in, they hold no tenant data (a test asserts none of them has an `organization_id`), and only Better Auth
  touches them.
- Every page is rendered on request (nothing under a workspace can be prerendered or cached), so a change of address such as a tab, a filter or an opened record is a server round trip, and the sidebar links are
  not prefetched. Next.js cancels some of its other link prefetches, and the server then logs `The destination stream closed early`; that is the framework's own housekeeping, not a failure.
- There is no UI for inviting people, changing roles or removing members, although the database rules for them exist and are tested.
- A deleted account's sessions end with the account (foreign keys cascade), but there is no "delete my account" screen.
