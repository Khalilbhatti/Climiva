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
13. [Core business data: customers, services, team](#13-core-business-data-customers-services-team)
14. [Organization → many Sites](#14-organization--many-sites)
15. [The future Website Builder](#15-the-future-website-builder)
16. [Local development](#16-local-development)
17. [Deployment and the future AWS topology](#17-deployment-and-the-future-aws-topology)
18. [Backups](#18-backups)
19. [SaaS billing vs. business-customer payments](#19-saas-billing-vs-business-customer-payments)
20. [Future domain routing](#20-future-domain-routing)
21. [Deferred domain migrations](#21-deferred-domain-migrations)
22. [Testing](#22-testing)
23. [Known limitations](#23-known-limitations)
24. [Operations: bookings, jobs and the schedule](#24-operations-bookings-jobs-and-the-schedule)

## 1. Status and scope

Before this phase Climvia was a single-business front end: one hard-coded business (Apex Climate Heating & Air), no sign-in, every edit lost on
reload. Now:

| Done | Not done (deliberately) |
| --- | --- |
| Real sign-up, log-in, log-out (Better Auth, sessions in PostgreSQL) | Email verification, password reset, invitations by email (no mail service yet) |
| Organizations, memberships, owner / admin / member roles | A UI to invite or remove members, or to change roles |
| Many people ↔ many businesses; a workspace switcher | Billing for Climvia itself |
| New-business onboarding in one transaction | Quotes, invoices, payments and the other money, growth and website modules (still sample data, see §12) |
| Business information, Business hours, Workspace preferences and the profile name stored in PostgreSQL | Logo / branding / avatar storage (needs object storage) |
| Customers, properties, equipment, Services, the team and its roles stored in PostgreSQL per organization (§13) | A flow to add or edit a customer, email invitations for team members |
| Bookings, Jobs (with work details and photo metadata), the Schedule (derived) and blocked time stored per organization (§24) | Rescheduling a booking, file storage for photos, a public booking page for a business's own domain |
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
| Hosting (later) | A single Ubuntu EC2 instance, see §17 |

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
  `organization_business_hours` rows, a first draft **site** (§14), the six standard team roles and a team record for the creator (§13). If any step fails nothing is kept. It creates no customers, Services, jobs, bookings or financial records.
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
| Add, edit or deactivate a Service; change the team, its roles, availability and assigned Services (§13) | ✓ | ✓ | ✗ |
| Read customers, Services and the team | ✓ | ✓ | ✓ |
| Read bookings, jobs and the schedule | ✓ | ✓ | ✓ |
| Create or change a booking or job: confirm, decline, cancel, assign, create a job, start, complete, edit work details (§24) | ✓ | ✓ | ✗ |
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
| `customers`, `customer_notes`, `customer_properties`, `equipment` | members of the active org | **nobody**: the runtime role has no write privilege (§13) |
| `services`, `team_roles`, `team_members`, `team_activity` | members of the active org | owner/admin of the active org (INSERT, column-limited UPDATE; no DELETE) |
| `team_member_services`, `team_member_availability`, `team_member_unavailable_periods` | members of the active org | owner/admin of the active org |
| `bookings`, `jobs` | members of the active org | owner/admin of the active org: INSERT, and UPDATE of a few columns only (§24); **nobody deletes** |
| `job_files` | members of the active org | owner/admin: UPDATE of `visibility` only; no INSERT until an object store exists |
| `schedule_blocks`, `schedule_block_members`, `organization_sequences` | members of the active org | nobody directly; numbers are taken only through `app_next_number()` (§24) |
| `auth_*` | Better Auth manages these before anyone is signed in | |

**Least privilege.** Column-level grants mean the runtime role cannot set `fixture_set` or rewrite ids; it has no DELETE on organizations, no UPDATE/DELETE on memberships.

The core business tables (`0003_core_data_rls.sql`, §13) and the operational tables (`0005_operations_rls.sql`, §24) use the same helpers; their composite `(organization_id, id)` foreign keys make a cross-organization reference impossible, and triggers guard a team member's login, the protected Owner role, and the status of bookings and jobs.

**Verified by tests** (`e2e/database-isolation.spec.ts`, `e2e/core-data-isolation.spec.ts` for the core tables and `e2e/operations-database.spec.ts` for the operational ones), connecting as `climvia_app` to a freshly migrated database: no context → no rows; user A sees only A's organization; user B only B's; a forged
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

Quotes & Invoices, Payments, Maintenance Plans, Website, Marketplace, Reviews, Marketing, Analytics and the customer-facing previews still run on
the sample dataset in `src/data/*`, held in React state for the visit. (Customers, Services and Team moved to PostgreSQL in §13, and Bookings, the Schedule and Jobs in §24; none of them is gated.)

- That dataset belongs to **one** business. An organization flagged `fixture_set = 'apex-demo'` sees it; **any other organization sees "isn't available for *Name* yet"**. The flag is set by the seed only
  (the runtime role has no column grant to set it).
- Every page and layout of those modules calls `await fixtureGate("Module")` first (`src/server/fixture-gate.tsx`) and returns the replacement if it is not the sample business.
  The public previews use `publicGate()`; metadata uses `hasSampleDataAccess()`. A test fails if a fixture-backed page forgets it.
- Overview shows a plain "Your workspace is ready" state with the real business card for any other workspace; sidebar counts are sample-business only, and global search finds the active business's own customers, jobs, bookings and schedule (§13, §24).
- **No silent fallback.** If sign-in, the database, the organization or the membership fails, the app redirects to Log in, shows an error, or shows the unavailable state. It never falls back to
  showing the Apex sample.
- The remaining sample dataset (money, plans, reviews, marketing, website …) is compiled into the browser JavaScript (it is static, fictional demo data, not tenant data). It is removed module by module as each moves to PostgreSQL (§21). The *foundations* it
  points at (customers, Services, team) and the operations (bookings, jobs, blocked time) are not compiled in: they are read from PostgreSQL and reach the browser only for the business that owns them (§13, "Fixture compatibility bridge", §24).

## 13. Core business data: customers, services, team

Phase 10 moved the foundations of a business, the records every other module points at, from the sample dataset to PostgreSQL. Everything below belongs to exactly one organization.

| Domain | Tables | Written by | Read by |
| --- | --- | --- | --- |
| Customers | `customers`, `customer_notes`, `customer_properties`, `equipment` | the seed only (no flow writes them yet) | every member of the active organization |
| Services | `services` | owner, admin | every member |
| Team | `team_roles`, `team_members`, `team_member_services`, `team_member_availability`, `team_member_unavailable_periods`, `team_activity` | owner, admin | every member |

Migrations: `0002_core_data.sql` (tables, constraints, indexes; generated by drizzle-kit from `src/db/schema/{customers,services,team}.ts`) and `0003_core_data_rls.sql` (policies, grants,
triggers; hand-written, like `0001`, and built from the same context and `SECURITY DEFINER` helpers, not a second pattern).

### Rules every table follows

- `organization_id` is a real, `NOT NULL` column on **every** table, not inherited through a parent.
- A child reaches its parent through a composite foreign key `(organization_id, parent_id)` onto the parent's `UNIQUE (organization_id, id)`. A property cannot belong to another business's customer, equipment cannot sit at another
  business's property, a team member cannot be given another business's role or Service: the database refuses the row, whoever is writing and whatever the application did. (PostgreSQL's referential checks run outside Row Level
  Security, so they hold even for the restricted role.)
- Row Level Security is enabled on each table: a member of the **active** organization may read it; the write policies below add the SaaS role check.
- `id` is an internal uuid. The public reference is a `slug`, unique **within** the organization (`/customers/sarah-mitchell`, `/services/ac-repair-diagnostics`, `/team/marcus-vance`). Lookups are always
  `(organization_id, slug)`, so a slug or uuid that belongs to another business is simply not found, indistinguishable from one that never existed. Two businesses may use the same slug for unrelated rows (the Northstar seed does, on purpose).

### Customers, properties and equipment

```
organization ──< customers ──< customer_properties ──< equipment
                    └──< customer_notes
```

A **property** is a service location, owned by one customer (one is `is_primary`; a partial unique index allows at most one per customer). **Equipment** is installed at a property, never at a customer directly, so it follows the
property if the customer record is ever merged. There are no scores, lifetime-value, health or telemetry fields, and no flow to add a customer, send a message or edit history: the product does not have those yet, so the runtime role has
**no INSERT/UPDATE/DELETE privilege** on these four tables (a write fails with `permission denied` before RLS is even consulted). When an Add Customer flow ships, its migration adds the grant and an owner/admin policy together.

`customers.maintenance_plan`, `last_service` and `upcoming` are small JSONB display summaries, kept only because Maintenance Plans, Jobs and Bookings are not on the database yet; they go when those modules move. Equipment's
`last_serviced` is likewise a small document, not a foreign key to a job that does not exist in PostgreSQL.

### Services

A Service is a row in `services`. The five detail areas of the Service screen are columns where the shape is stable and a document where it is configuration:

| Area | Stored as |
| --- | --- |
| Overview | `name`, `category`, `audience[]`, `description`, `internal_description`, `duration_minutes` |
| Pricing | `pricing_model` (`diagnostic-fee`, `fixed-price`, `free-assessment`), `price_amount numeric(10,2)`, `price_label`; a CHECK ties the three together |
| Booking settings | `booking_method` (`instant`, `request-appointment`, `request-quote`) |
| Customer intake | `intake jsonb`: an array of `{ id, prompt, type: "single-select" \| "photo-upload", required, options?, helper? }`, `checklist text[]` |
| Availability & visibility | `is_active`, `visibility` (`public-booking`, `public-only`, `internal`), `display_order` |

A name is unique per business, case-insensitively. Services are **deactivated, never deleted** (the runtime role has no DELETE), so a booking that named a Service keeps resolving. A Maintenance Plan's coverage labels ("Cooling maintenance") are plan
internals and are not Services; the Apex catalog is exactly the six approved services.

**Save, Discard, Add and Deactivate** go through server actions (`src/server/actions/services.ts`). The screen changes only after the server answers with the row as stored, so what is shown is never ahead of what is saved; Discard never calls
the server; a refresh shows what is in the database. A new business starts with **zero** Services and a proper empty state. There is deliberately no "load starter services" for a real business yet: starter templates are the planned seam
(a server function that inserts a template's Services for the active organization), and the Add Service flow is the way in until then.

### Team is not organization membership

| | `organization_memberships` | `team_members` |
| --- | --- | --- |
| Answers | Who may sign in to this business and what may they do to the *workspace*? | Who works here, and how are they scheduled and assigned? |
| Authority | The only authority; enforced by Row Level Security | None. It is business data |
| Login | Always a Climvia login | `user_id` is **nullable**: most technicians never sign in |
| Roles | `owner`, `admin`, `member` (SaaS) | `team_roles` (Owner, Technician, Bookkeeper …) with a permission matrix: product configuration, **not** the security boundary |

Consequences: not every technician is a Better Auth user; not every organization member is a technician; the owner who signs up gets a team record **and** a membership but the two are not coupled (editing Alex's Team record does not touch Alex's
Profile, and the reverse). `user_id` may link a team member to a login of the **same** organization (a trigger refuses any other), is unique per business, and cannot be changed through the runtime role. **Deactivating** a team member changes their
record only: they leave the assignment pickers, history keeps their name, and their login and membership are untouched. Adding a team member records the person and sends nothing: no email, no sign-in is created.

Availability is a team member's own working pattern (seven rows, `team_member_availability`, plus time off in `team_member_unavailable_periods`). It is distinct from the business hours in §11 and from Schedule events. `team_activity` is a plain
per-member history list; it is not an audit log or an event bus.

### Authorization for the foundations

`src/lib/policy.ts` is the one place the answer lives:

| Capability | Owner | Admin | Member |
| --- | :-: | :-: | :-: |
| Read customers, properties, equipment, Services, team, roles | ✓ | ✓ | ✓ |
| `services:manage` (add, edit, activate, deactivate a Service) | ✓ | ✓ | ✗ |
| `team:manage` (add, edit, deactivate a team member; edit roles, availability, assigned services) | ✓ | ✓ | ✗ |
| `settings:manage` (Phase 9) | ✓ | ✓ | ✗ |

Every mutation runs the same pipeline: **authenticated user → active organization (verified, never taken from the request) → active membership → capability → validation → tenant transaction → safe error**. A hidden or tampered organization id
in a request is never read; the organization is the one the server resolved. The same rule is enforced three times: the control is disabled for a member (`useCan`), the action refuses (`NOT_ALLOWED_*`), and the RLS write policy denies. Column-level
`UPDATE` grants mean ids and `organization_id` cannot be rewritten. The Owner role is protected by a trigger as well as by the code.

### Fixture compatibility bridge

Quotes & Invoices, Payments, Maintenance Plans, Reviews, Marketing, Analytics and the Website still run on the sample dataset (§12), and they reference customers, Services and team members by id (Bookings, Jobs and the Schedule now point at the same records through composite foreign keys, §24). The bridge:

- Those ids are the **slugs**, and the Apex seed writes the same slugs, with deterministic UUIDv5 primary keys (`src/db/stable-id.ts`: `stableId(organization, kind, slug)`), so a booking that names `sarah-mitchell` and `ac-repair-diagnostics`
  resolves to the same people and Services after a re-seed.
- The directory of the active business (customers, properties, equipment, Services, team) is loaded **on the server** and given to the browser by `DirectoryProvider`, which `useDirectory()` reads. The selectors in `src/data/{customers,services,team}.ts`
  take that data as an argument: there is **no module-level registry** to fill, because one server process serves many businesses and a shared registry would be a cross-tenant leak.
- Every business is given **its own** customer book, Services, team and operations: Bookings and Jobs show a customer's name and address, so they need the book. At this scale the whole lists are sent with the page (windowing them by date and page is the next scaling step). Every
  other business starts the not-yet-migrated modules **empty** (`EMPTY_FINANCIALS`, `EMPTY_PLANS_DATA`, …), so a Northstar or a brand-new workspace can never match another business's sample records, and none of the Apex sample is sent to its browser as data.
- The seed data for all of this lives in `scripts/db/seed-data` (seed and test infrastructure); `src/` does not import it.

### A new organization

Onboarding creates, in the same transaction as before, the six system roles and one team member for the owner. It creates no customers, no Services and none of Apex's records. Customers and Services show proper empty states; Team shows the owner;
Bookings, the Schedule and Jobs show proper empty states with no sample records and no counters of another business (§24); the other fixture-backed modules still say "isn't available for *Name* yet" (§12).

### Global search and the public previews

Global search is the active business's: it searches that business's customers, Jobs, Bookings and Schedule in the browser, over the records the server read from PostgreSQL for the verified active organization, so another business's records cannot be found whatever is typed.
(The server-side customer search of Phase 10 was removed: with Bookings and Jobs loaded alongside the book, one search over the same records is the simpler and consistent behaviour.) The Website and Marketplace read the active business's **Services** from PostgreSQL and handle an empty list; their other content is still session data. Booking slot logic is given the business's
Services and hours.

### Tests

`e2e/core-data-isolation.spec.ts` connects as `climvia_app` and proves, per domain, that SELECT sees only the active organization, that the customer tables refuse INSERT/UPDATE/DELETE, that a member cannot write Services or the team, that an
owner cannot write into another business, that ids and `organization_id` cannot be rewritten, that nothing here can be deleted, and that cross-organization references fail (property → customer, equipment → property, team member → Service, role,
availability, author, login). `e2e/{customers,services,team}-db.spec.ts` and `e2e/cross-domain-isolation.spec.ts` drive the real application: persistence after reload, the seeds, empty states, switching business, back/forward, logout and a tampered cookie.

## 14. Organization → many Sites

`sites` belongs to an organization (`ON DELETE RESTRICT`): **one organization, many sites**. Columns: `name`, `slug` (unique within the organization), `status`
(`draft | published | archived`), `selected_template_id` (reserved, plain text for now), `primary_domain` (reserved; unique across all sites once set, lower-case). Onboarding creates one draft site
named after the business.

There is deliberately no pages, sections, templates or domain infrastructure, and no "website" field on the organization.

## 15. The future Website Builder

The ownership chain is fixed so the builder adds tables without changing anything above it:

```
Organization ──< Site ──< Page ──< Section
                  │
                  ├── selected template (a preset the builder will define)
                  └── primary domain + additional domains (§20)
```

The builder will add `site_pages`, `site_sections` (and a template table), each carrying `organization_id` with the same policies and grants as `sites`, so they inherit §9 and §10 unchanged.
The current Website module (page editors, preview, booking journey) is the product design the builder will be built from.

## 16. Local development

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

## 17. Deployment and the future AWS topology

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
> `docker build .` once on a machine with Docker before relying on them. The Phase 10 migrations (`0002_core_data.sql`, `0003_core_data_rls.sql`) were verified the same way, on PostgreSQL directly.
> **Docker verification is still required before AWS deployment.**

## 18. Backups

Not implemented; this is the plan.

- **Nightly logical backup:** `pg_dump --format=custom` of the database, taken by a cron job / systemd timer on the host (or a sidecar container), written to a local directory first.
- **Off-host, encrypted:** the dump is encrypted (for example `age` or `gpg`, or S3 server-side encryption with a KMS key) and copied to a private S3 bucket (block all public access, versioning on,
  lifecycle rule to expire old dumps, bucket policy limited to the backup role).
- **Retention:** daily for 14 days, weekly for 8 weeks, monthly for 12 months.
- **Restore drill:** restore the latest dump into a scratch database (`pg_restore`) on a schedule and run `db:migrate` + a smoke test. A backup that was never restored is not a backup.
- On RDS the same job is replaced by automated snapshots plus point-in-time recovery.

No AWS SDK is in the application; backups are an operations concern, outside the app.

## 19. SaaS billing vs. business-customer payments

Two different money flows. They must never share tables, code or credentials.

| | **SaaS billing** | **Business-customer payments** |
| --- | --- | --- |
| Who pays whom | A business pays **Climvia** for the product (plan, seats, usage) | A business's **customer** pays the **business** (invoices, deposits, maintenance plans) |
| Belongs to | The Climvia platform; attached to an **organization** as the billed account | The business (a tenant); attached to its customers and invoices |
| Where it lives | Future platform tables (`subscriptions`, `plans`, `billing_events`), a Climvia-owned Stripe account | The existing **Payments / Quotes & Invoices** modules, a Stripe Connect account *per business* |
| Today | Not built | Sample data; payments are recorded manually (no processor) |

Billing will hang off the organization (`organizations.id`), never off a user, because the business is the customer. Gating features by plan will be a check beside the role check in §9.

## 20. Future domain routing

Not built. The intended design: a request's host name selects the **site**, and the site selects the organization.

- `sites.primary_domain` is unique across all sites, lower-case, and reserved for this.
- A proxy / edge function resolves `Host` → site → organization and renders the public site read-only. Public site traffic needs no session and must read only through a narrow, published-content path, not the
  tenant policies of §10 (which require a signed-in member).
- A `<slug>.climvia.app`-style subdomain for every site plus customer-owned custom domains (with DNS verification and certificates) is the likely shape.
- The authenticated app stays on its own host so cookies and CSRF origins stay separate from public sites.

## 21. Deferred domain migrations

Each of these moves from sample data to PostgreSQL in its own phase, with `organization_id`, RLS and tests as in §9–§10. When a module moves, its `fixtureGate` call is deleted and it works for every organization.

Done: Services, Customers (+ properties, equipment), Team (staff, roles) (§13); Bookings, Jobs, the Schedule (derived) and blocked time (§24). Suggested order for the rest (dependencies first): **Quotes & Invoices → Payments** (next: they point at jobs and bookings, which now have
stable organization-scoped numbers and composite keys to reference, and need their own price snapshots) → Maintenance Plans (then `bookings.plan_id` / `plan_visit_id` become real foreign keys) → Reviews →
Marketing → Website (then the Builder) → Marketplace → Analytics (derived last: its Bookings 24 / Completed Jobs 18 aggregates are still baselines, not counts of the stored records). Also pending: branding / logo / avatar storage and photo files (an object store), invitations and member management, email, a public booking page.

## 22. Testing

The Playwright suite runs against a **production build** and a **separate database** (`climvia_test`), recreated, migrated and seeded from nothing on each `npm run test:e2e`: which is also the clean-database migration and seed check.

- Each worker signs in over HTTP as the owner of its **own copy of the Apex workspace**, restored to the canonical record before every test (Settings, Services, customers and the team are stored now, so tests cannot share one;
  the reset rewrites the core data only when a fingerprint of it changed, and always on a worker's first test).
- Every test gets its own client address (`X-Forwarded-For`), so login rate limiting does not couple tests together.
- Specs: authentication, onboarding, workspace switching, tenant isolation (HTTP and page level), database isolation (SQL as `climvia_app`), Settings persistence, server boundaries, plus the existing front-end suite.
- Core data (§13): `core-data-isolation.spec.ts` (SQL as `climvia_app`: reads, writes, grants, composite foreign keys, triggers), `core-data-roundtrip.spec.ts` (what the seed wrote is what the application reads, and stable ids),
  `customers-db.spec.ts`, `services-db.spec.ts`, `team-db.spec.ts` (the numbered required tests 1–37) and `cross-domain-isolation.spec.ts` (38–46: switching, back/forward, reload, logout, forged cookies). The canonical Apex records
  that the pure-data specs read live in the seed (`scripts/db/seed-data`, re-exported for tests by `e2e/apex-data.ts`), not in `src/`.
- Operations (§24): `operations-database.spec.ts` (SQL as `climvia_app`: reads, writes, column grants, status transitions, no DELETE, cross-business relations, numbering and concurrency), `bookings-db.spec.ts`, `jobs-db.spec.ts`, `schedule-db.spec.ts` (the real
  application: persistence after reload, the seeds, empty states, forged and stale requests, atomic completion), `operations-cross-module.spec.ts` (Customers, search, Reviews, Maintenance Plans, switching, logout, Back), `business-time.spec.ts`
  (daylight-saving and zone conversions) and the pure rules in `operations.spec.ts`. The test database is rebuilt from the migrations and the seed on every run; `operations-edits.ts` holds the small pure edits the specs of other modules use to ask "what if this job were completed?".

## 23. Known limitations

- Email verification, password reset, invitations and member management have no UI: they need a mail service and are the next SaaS work.
- Branding, logo and avatar are session-only until object storage exists.
- The money, plans, reviews, marketing and website sample dataset ships in the browser bundle (fictional, public, not tenant data) until its modules migrate. Customers, Services, the team, bookings, jobs and blocked time do not.
- A booking's date and time cannot be changed after it is created (there is no rescheduling flow). When one is built it must change the booking and its job in the same transaction. Nothing creates blocked time yet either: the blocks are seeded and read.
- Photos on a job: the database holds their **metadata** (name, size, category, caption, visibility); the file itself has no home until an object store exists, so a file chosen in the browser lasts for the visit and is labelled so. The whole booking, job and customer lists are sent to the browser with the page.
- Customers, properties and equipment can be read but not yet added or edited (no flow exists, so the database grants none). Team members are added without an email or a sign-in; there is no resend and no invitation.
- A business has zero Services until its owner adds them: there are no starter templates yet.
- Docker artifacts are authored but were not executed in the development environment (see §17).
- `AUTH_TRUSTED_PROXIES` must be set correctly in production or login rate limiting degrades to one shared bucket.
- The four `auth_*` identity tables have no Row Level Security: Better Auth must read them before anyone is signed in, they hold no tenant data (a test asserts none of them has an `organization_id`), and only Better Auth
  touches them.
- Every page is rendered on request (nothing under a workspace can be prerendered or cached), so a change of address such as a tab, a filter or an opened record is a server round trip, and the sidebar links are
  not prefetched. Next.js cancels some of its other link prefetches, and the server then logs `The destination stream closed early`; that is the framework's own housekeeping, not a failure.
- There is no UI for inviting people, changing roles or removing members, although the database rules for them exist and are tested.
- A deleted account's sessions end with the account (foreign keys cascade), but there is no "delete my account" screen.

## 24. Operations: bookings, jobs and the schedule

Phase 11 moved the operational core to PostgreSQL. Everything below belongs to exactly one organization, follows the rules of §9 and §13, and is read for the **active** business only.

| Domain | Tables | Written by | Read by |
| --- | --- | --- | --- |
| Bookings | `bookings` | owner, admin (server actions) | every member |
| Jobs | `jobs`, `job_files` (metadata only) | owner, admin | every member |
| Schedule | **no table of its own**: derived from `bookings`, `jobs` and the blocks | | every member |
| Blocked time | `schedule_blocks`, `schedule_block_members` | the seed only (no flow writes a block yet) | every member |
| Numbering | `organization_sequences` | `app_next_number()` only | every member |

Migrations: `0004_operations.sql` (tables, constraints, indexes; generated by drizzle-kit from `src/db/schema/operations.ts`; the two `UNIQUE` constraints the new composite keys need were moved to the top by hand, redo that if it is regenerated) and `0005_operations_rls.sql`
(policies, grants, the numbering function and the status guards; hand-written).

### Schema in one view

```
organization ──< bookings ──(at most one)── jobs ──< job_files
      │             │  └─ customer, property (the customer's own), service, assignee ─┐
      │             └──────────────────────────────────────────────────────────────┘ (composite keys)
      ├──< schedule_blocks ──< schedule_block_members >── team_members
      └──< organization_sequences (kind: booking | job)
```

- **A booking** has: its number, who it is for (a `customer_id`, **or** a `contact_name` with optional phone, email and address: exactly one, by a CHECK), a property (only with a customer, and it must be that customer's own), a service, an assignee, the source,
  the status, the local date and start and end times, a customer note, the intake answers, internal notes, the cancellation reason (present exactly when cancelled), the maintenance-plan visit it schedules (`plan_id`, `plan_visit_id`, plain references until plans move),
  and `received_at` / `confirmed_at` instants. `source` and `received_at` are `NULL` for an older record that never had them (the sample bookings from before the system existed); every booking made through the application has both, and nothing invents a value.
- **A job** has: its number, the booking it came from (`UNIQUE (organization_id, booking_id)`: **at most one job per booking**; a historical visit has none), the same party, property, service and assignee, the equipment worked on, the appointment, and the work details as **explicit columns**
  (`technician_diagnosis`, `work_performed`, `customer_summary`, `internal_notes`, `customer_request`, `safety_note`, `completion_notes`, `completed_at`). Only the diagnostics checklist, a list the technician's record carries, is JSONB.
  A CHECK makes "completed" mean exactly "has its completion notes and time".
- **Job files** are metadata: name, size, category, caption, time taken, visibility, a thumbnail label. `storage_key` is reserved for the object store and is always `NULL`: no file content is ever in PostgreSQL, and no INSERT is granted until there is somewhere to put one.
- **Statuses** are the approved sets and nothing else (CHECK constraints): bookings `pending`, `confirmed`, `completed`, `cancelled`; jobs `scheduled`, `in-progress`, `completed`. "Needs assignment" is simply "no assignee". "En route", "Waiting for parts" and the like do not exist.

### Snapshot or reference

| What | Stored as | Why |
| --- | --- | --- |
| Customer, property, service, team member, equipment | a **reference** (composite foreign key to the business's own row) | A rename or an address correction shows everywhere; history keeps pointing at the same person. Nothing is copied |
| A person with no customer record | a **snapshot** (`contact_name` and optional contact details) | They are not a record anywhere yet; the booking is where they exist |
| The appointment (date, start, end) on a job | a **copy** of the booking's at the moment the job is created | A job is the work; the booking is the request. There is no rescheduling flow yet, so they cannot differ; when there is, it changes both in one transaction |
| Assignee on a booking and its job | stored on both, **kept equal by the server** | Whichever is named, both change in the same transaction, so Bookings, the Schedule and Jobs never disagree |
| Price, tax, totals | not stored here | Money is the next migration and will snapshot the price lines it quotes |
| A service's name | a reference, shown current | History reads "AC Repair & Diagnostics" because that is what the service is called |

### Schedule is derived

There is no `schedule_events` table. `getScheduleEvents()` (`src/data/operations.ts`) lays out, for a day or a week: each **job**, each **confirmed or completed booking that has no job**, and the blocks. Pending and cancelled bookings never appear. A mutation on the Schedule
(assigning) calls the same server action as on a booking or a job and changes the same rows, so the three screens agree by construction. Day and Week views, the technician and service filters, the unassigned list and the details panel all read the data
the server sent for the active business. There is no drag and drop, no routing, GPS or dispatch.

### Dates, times and time zones

An **appointment** is a local `date` plus local `start_time` and `end_time`, read in the organization's IANA time zone (`organizations.timezone`) and **never converted**: it cannot move when a server, a browser or the time-zone database changes, a Daylight-Saving
change cannot shift it, and the historical demo dates (Oct 2024) are what they are. Only the system's own events (received, confirmed, completed) are instants (`timestamptz`); `src/lib/business-time.ts` turns them back into the business's local `YYYY-MM-DDTHH:mm` **on
the server**, before anything reaches a browser, using `Intl` with the named zone. The browser never parses a date: `src/lib/dates.ts` formats the strings by hand, so every browser time zone shows the same text (a test opens the pages in Auckland, Los Angeles and
Kiritimati and compares).

"Today" is also the business's: `WorkspaceSnapshot.clock` is computed on the server for the request (`useClock()` in the browser). The **sample business** lives at the product's fixed moment (Friday, October 25, 2024, 10:45), because its records are dated around it; every
other business uses the real time in its own zone. Booking slots, "Today" labels, the unavailable-past rule and the Schedule's current week all read that clock. A wall-clock time that does not exist (spring forward) is read as the same wall-clock after the gap; one that happens twice
(fall back) as its first occurrence.

### Human identifiers are the business's own

"BK-1042" and "JB-204" are an integer `number` unique **within the organization** (`UNIQUE (organization_id, number)`), shown with a prefix. Two businesses may both have BK-1001 and do (Northstar's seed and every new workspace). The UI uses the display number as
the record's id and the database uses a uuid, which never leaves the server.

Numbers are **allocated, never computed** with `MAX(number) + 1`. `app_next_number(kind)` is a `SECURITY DEFINER` function that takes the organization **from the verified context**, requires owner or admin of it, creates the counter at 1001 if the business has none, and increments it
under a row lock, so concurrent requests are serialized (sixteen at once get sixteen different numbers), a rolled-back transaction gives its number back, and one business can neither read nor move another's counter (the runtime role has no UPDATE on the table). A business starts
at 1001; a seeded one starts above its largest seeded number. `BK-1048` is **held** for Sarah Mitchell's included cooling visit (`RESERVED_BOOKING_NUMBERS`): in the sample business, other bookings walk past it and that visit takes it whenever it is scheduled. Any other business holds no number back.

### Status transitions

Checked in three places so a forged request cannot do what a screen would never offer: the pure rules in `src/lib/operations-rules.ts` (run by the server action first, with a message for the person), the action's checks against the locked rows, and PostgreSQL triggers
(`bookings_guard_transition`, `jobs_guard_transition`):

- booking: `pending → confirmed | cancelled`; `confirmed → completed | cancelled`; `completed` and `cancelled` are **final** (nothing about them changes again). A booking that has a job cannot be cancelled. A decline or cancel needs a reason. Assigning is only for a confirmed booking.
- job: `scheduled → in-progress → completed`. A completed job never returns to scheduled and its record is not rewritten.
- **Complete Job is one transaction**: the job is completed with its resolution notes and time, any work details the technician had not saved are kept with it, and the booking it came from is completed. If any step fails, none happens. It creates no quote, invoice or payment.
- A job is created from a confirmed booking that has none; nothing creates a job by itself (confirming a request does not).

### Authorization

`operations:manage` (`src/lib/policy.ts`) is owner and admin. A **member reads** bookings, jobs and the schedule and changes nothing. The pipeline is the one of §13: **authenticated user → active organization (verified, never taken from the request) → active membership → capability →
validation → tenant transaction → safe error**. In `src/server/actions/operations.ts` every action hands everything it does to one helper, `mutate()`, whose first step is `authorize("operations:manage")`; nothing is read from the arguments, parsed or looked up before it. Every id a request names
(a customer, property, service, team member, booking, job, file) is resolved **inside the transaction, within the verified organization**: one that belongs to another business is indistinguishable from one that never existed. The assignee must be active and field-assignable (a
deactivated member still shows on past records and gets nothing new). Errors are values with a message for the person; a database error is never shown (the detail is logged on the server).

The same rule is enforced again by PostgreSQL (`0005_operations_rls.sql`): members of the **active** organization read; owner or admin of it INSERT and UPDATE; **no one DELETEs** (history is kept: a booking is cancelled, a job completed). `UPDATE` is granted per column: a booking may
have its status, assignee, confirmation time and cancellation reason changed, a job its assignee, status, the four editable work details and its completion; ids, numbers, `organization_id`, the party, the service, the date and time and the booking link are never rewritten. Composite
`(organization_id, id)` foreign keys make a cross-business reference impossible rather than merely checked (an Apex booking cannot name a Northstar customer, a Northstar job an Apex service, an Apex job a Northstar team member).

### Seeds

Apex: 13 bookings (BK-1006 … BK-1042), 11 jobs (JB-142, JB-178 … JB-204), 4 photo records on JB-204 and 2 blocks, with deterministic uuids. JB-204 is Sarah Mitchell's completed AC Repair & Diagnostics job at 1402 Kinney Ave, Austin, TX 78704, linked to BK-1042. The Overview
aggregates (Bookings 24, Completed Jobs 18) are **baselines**, not counts of these rows, and are deliberately not backed by invented records. Northstar: BK-1001 (confirmed, with JB-1001, assigned to Jordan Pike) and BK-1002 (a pending request), for Northstar's own customers
and services. A new workspace has none, and its counters start at 1001.

### Maintenance Plan bridge (BK-1048)

Plans are not on the database yet. Scheduling an included visit creates a **real booking** through the same action (source "Maintenance plan", confirmed, no job, no financial record) that carries `plan_id` and `plan_visit_id`. The plan screens **derive the visit's state from the stored
booking** (`getVisitBooking()`: the non-cancelled booking whose `planVisit` points at the visit): Scheduled after a reload, open again once the booking is cancelled. The plan holds no pointer of its own that could disagree. A plan created in the browser for the visit is not stored
(plans migrate later), so a booking made for it outlives it as an ordinary booking.

### Reviews compatibility

Reviews are still sample data and name a related job (Sarah Mitchell's review → JB-204). They resolve it against the **active business's stored jobs**, so the chip, the job page and the Request Review list (completed jobs only, JB-204 and JB-142 for Sarah) come from the
database; in a business that has no JB-204 the link simply is not shown.

### Website booking preview

The Website booking journey is a preview **inside the signed-in workspace**. It creates a real booking in the signed-in business, as that signed-in owner or admin, through the same authorized action: no organization comes from the page and nothing is trusted from it (the server
decides the status from the Service's booking method and refuses a Service that is not offered online). A real public booking page (a visitor on the business's own domain, with no session) is **deferred**: it needs a verified Host → site → organization mapping (§20), rate limiting,
spam protection and a narrow public write path that does not use the tenant policies. No unauthenticated endpoint accepts a booking today.

### Not in this phase

Quotes, invoices, payments, plan records, review records, marketing, the Website model, file storage, rescheduling, drag and drop, routing, notifications by email or SMS, and the Analytics aggregate facts. No Docker image was built or run for this phase: the Dockerfile and compose
file are unchanged and compatible with the new migrations, and **Docker verification is required before AWS deployment** (§17).
