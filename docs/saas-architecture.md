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
15. [The Website Builder](#15-the-website-builder)
16. [Local development](#16-local-development)
17. [Deployment and the future AWS topology](#17-deployment-and-the-future-aws-topology)
18. [Backups](#18-backups)
19. [SaaS billing vs. business-customer payments](#19-saas-billing-vs-business-customer-payments)
20. [Domain routing](#20-domain-routing)
21. [Deferred domain migrations](#21-deferred-domain-migrations)
22. [Testing](#22-testing)
23. [Known limitations](#23-known-limitations)
24. [Operations: bookings, jobs and the schedule](#24-operations-bookings-jobs-and-the-schedule)
25. [Financials: quotes, invoices and payments](#25-financials-quotes-invoices-and-payments)
26. [Maintenance plans and reviews](#26-maintenance-plans-and-reviews)
27. [Marketing and Analytics](#27-marketing-and-analytics)
28. [Websites, Site Versions and the Marketplace](#28-websites-site-versions-and-the-marketplace)
29. [The visual Website Builder](#29-the-visual-website-builder)
30. [Route groups and the provider boundary](#30-route-groups-and-the-provider-boundary)
31. [Website Templates](#31-website-templates)
32. [Where a business's sample data may live](#32-where-a-businesss-sample-data-may-live)
33. [Durable assets and Organization Branding](#33-durable-assets-and-organization-branding-phase-18a)
34. [Custom domains](#34-custom-domains-phase-18b)
35. [The production container runtime](#35-the-production-container-runtime-phase-18c1)
36. [Platform administration](#36-platform-administration-phase-19a)

## 1. Status and scope

Before this phase Climvia was a single-business front end: one hard-coded business (Apex Climate Heating & Air), no sign-in, every edit lost on
reload. Now:

| Done | Not done (deliberately) |
| --- | --- |
| Real sign-up, log-in, log-out (Better Auth, sessions in PostgreSQL) | Email verification, password reset, invitations by email (no mail service yet) |
| Organizations, memberships, owner / admin / member roles | A UI to invite or remove members, or to change roles |
| Many people ↔ many businesses; a workspace switcher | Billing for Climvia itself |
| New-business onboarding in one transaction (the organization, its owner, its hours, a private primary Site with its Draft) | Delivering the Website's contact-form messages (no mail service) |
| Business information, Business hours, Workspace preferences, the profile name and the **Branding (logo and accent, §33)** stored | Avatar / profile photo storage, a media library, private files |
| Customers, properties, equipment, Services, the team and its roles stored in PostgreSQL per organization (§13) | A flow to add or edit a customer, email invitations for team members |
| Bookings, Jobs (with work details and photo metadata), the Schedule (derived) and blocked time stored per organization (§24) | Rescheduling a booking, file storage for photos, a public booking page for a business's own domain |
| Quotes, invoices (with line items) and payments stored per organization, money in integer cents, balances derived, payments voided rather than deleted (§25) | A payment processor, bank or accounting connection, Climvia's own subscription billing |
| Maintenance plans (with coverage and included visits) and reviews (with replies and review requests) stored per organization; a visit is scheduled as a real booking (§26) | Pausing or ending a plan from a screen, sending a review request (email or SMS), a public way to submit a review, automatic billing from a plan |
| Marketing campaigns (email and text, with Draft / Scheduled / Sent state, recipient snapshots and business-time scheduling) and Analytics as PostgreSQL reporting queries, with the sample business's approved history kept as explicit imported adjustments (§27) | Sending any email or text (no provider), templates and a rich email builder, A/B tests, open and click analytics |
| Strict tenant isolation: server authorization **and** PostgreSQL Row Level Security; custom domains claimed, verified by DNS and served by Host (§34) | Internet DNS routing, TLS certificates and the proxy in front of customer domains (Phase 18C) |
| Websites: one organization owns many Sites (one primary); a Site has one mutable Draft and immutable Published versions of Pages and Sections, a code-level section registry with server-side validation, theme tokens and an application-owned template; published pages are served to anyone through a narrow public read path, the Draft only to people signed in; a visitor can book (§28); the visual Website Builder edits the Draft (pages, sections, theme) and saves it whole against a revision, so a tab that is behind cannot overwrite a newer one (§29) | A Sites screen, a template gallery and choosing a template, uploaded images (object storage) |
| Marketplace listing stored per organization (at most one, published or hidden, with its selected Services) and served publicly by its own address (§28) | Deployment to AWS |

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

Flow of a protected request: `proxy.ts` (cookie present?) → the workspace layout (through `WorkspaceProviders`, §30) and the page call `resolveWorkspace()` (session valid in the database? active membership?)
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
| Read quotes, invoices and payments | ✓ | ✓ | ✓ |
| Record or void a payment; create an invoice from an approved quote; create or move a quote (§25) | ✓ | ✓ | ✗ |
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
7. **Public pages never use the tenant policies.** A visitor reads and books only through the three `SECURITY DEFINER` functions of §28, which take a public identity (never an organization), return a projection, and are the only door; no module runs on the sample dataset any more (§12).
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
| `quotes`, `quote_line_items`, `invoices`, `invoice_line_items`, `payments` | members of the active org | owner/admin of the active org: INSERT (a quote only as a draft, a payment only as recorded, lines only into a document created in the same transaction), UPDATE of a quote's status and step date and of a payment's void columns only (§25); **nobody deletes** |
| `schedule_blocks`, `schedule_block_members`, `organization_sequences` | members of the active org | nobody directly; numbers are taken only through `app_next_number()` (§24) |
| `auth_*` | Better Auth manages these before anyone is signed in | |

**Least privilege.** Column-level grants mean the runtime role cannot set `fixture_set` or rewrite ids; it has no DELETE on organizations, no UPDATE/DELETE on memberships.

The core business tables (`0003_core_data_rls.sql`, §13), the operational tables (`0005_operations_rls.sql`, §24) and the financial tables (`0007_financials_rls.sql`, §25) use the same helpers; their composite `(organization_id, id)` foreign keys make a cross-organization reference impossible, and triggers guard a team member's login, the protected Owner role, and the status of bookings and jobs.

**Verified by tests** (`e2e/database-isolation.spec.ts`, `e2e/core-data-isolation.spec.ts` for the core tables, `e2e/operations-database.spec.ts` for the operational ones and `e2e/financials-database.spec.ts` for the financial ones), connecting as `climvia_app` to a freshly migrated database: no context → no rows; user A sees only A's organization; user B only B's; a forged
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

**There are none left.** Phase 15 moved the last two modules, the Website and the Marketplace, to PostgreSQL (§28), so every module works for every organization with that organization's own rows, and the
sample-data gate (`fixtureGate`, `publicGate`, `hasSampleDataAccess`, the "isn't available for *Name* yet" screen) was deleted; a test fails if any of them comes back. (Customers, Services and Team moved in §13, Bookings, the Schedule and Jobs in §24,
Quotes & Invoices and Payments in §25, Maintenance Plans and Reviews in §26, Marketing and Analytics in §27.)

- The Apex Climate Heating & Air sample business is **seed data** (`scripts/db/seed-data`), written to PostgreSQL by the seed through the application's own functions. Its `fixture_set = 'apex-demo'` flag, set by the seed only (the runtime role has no column grant to set
  it), now means one thing: **the business lives on the product's fixed day** (Friday, October 25, 2024) instead of the real clock, so its dated records stay put (§24). Every other organization uses the real clock.
- Overview shows a plain "Your workspace is ready" state with the real business card for a business with no records; sidebar counts are the business's own; global search finds the active business's own customers, jobs, bookings and schedule (§13, §24).
- **No silent fallback.** If sign-in, the database, the organization or the membership fails, the app redirects to Log in or shows an error. It never falls back to showing the Apex sample.
- Nothing of any business, sample or not, is compiled into the browser JavaScript: customers, Services, the team, the operations, the financials, the plans, the reviews, the campaigns, the Analytics figures, and now the websites and the listings are read from PostgreSQL and
  reach the browser only for the business that owns them (a built-bundle test searches for every business's website and listing copy).

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
property if the customer record is ever merged. There are no scores, lifetime-value, health or telemetry fields, and no flow to send a message or edit history: the product does not have those yet. Since Phase 19E an owner or admin can **add a customer** (§40), so the runtime role has
`INSERT` (and only `INSERT`) on `customers`, behind an owner/admin policy added in the same migration; it still has **no UPDATE/DELETE on customers and no write privilege at all** on the notes, properties and equipment tables (a write fails with `permission denied` before RLS is even consulted).

`customers.maintenance_plan`, `last_service` and `upcoming` are small JSONB display summaries. The plan one is only a fallback now: a customer with a plan record shows that record (§26), and the summary is read only for a customer who has none. Equipment's
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

The slugs of customers, Services and team members are the references everything else uses (Bookings, Jobs, the Schedule, the financial documents, the maintenance plans, the reviews, the marketing recipients and, since Phase 15, a website's Service lists and a listing's selected Services point at the same records through composite foreign keys or by slug, §24 to §28). The bridge:

- Those ids are the **slugs**, and the Apex seed writes the same slugs, with deterministic UUIDv5 primary keys (`src/db/stable-id.ts`: `stableId(organization, kind, slug)`), so a booking that names `sarah-mitchell` and `ac-repair-diagnostics`
  resolves to the same people and Services after a re-seed.
- The directory of the active business (customers, properties, equipment, Services, team) is loaded **on the server** and given to the browser by `DirectoryProvider`, which `useDirectory()` reads. The selectors in `src/data/{customers,services,team}.ts`
  take that data as an argument: there is **no module-level registry** to fill, because one server process serves many businesses and a shared registry would be a cross-tenant leak.
- Every business is given **its own** customer book, Services, team and operations: Bookings and Jobs show a customer's name and address, so they need the book. At this scale the whole lists are sent with the page (windowing them by date and page is the next scaling step). Every
  other business starts empty, so a Northstar or a brand-new workspace can never match another business's sample records, and none of the Apex sample is sent to its browser as data.
- The seed data for all of this lives in `scripts/db/seed-data` (seed and test infrastructure); `src/` does not import it.

### A new organization

Onboarding creates, in the same transaction as before, the six system roles and one team member for the owner. It creates no customers, no Services and none of Apex's records. Customers and Services show proper empty states; Team shows the owner;
Bookings, the Schedule and Jobs show proper empty states with no sample records and no counters of another business (§24); so do Quotes & Invoices and Payments, with zero totals and nothing to record against (§25), Marketing, with no campaigns and audiences of zero customers, and Analytics, with zeros (§27). It also gets a **private primary Site with a Draft** made from the default template in neutral words (the pages speak of the business only through its own record), no published version, no Marketplace listing ("not set up") and a public address of its own (§28).

### Global search and the public previews

Global search is the active business's: it searches that business's customers, Jobs, Bookings and Schedule in the browser, over the records the server read from PostgreSQL for the verified active organization, so another business's records cannot be found whatever is typed.
(The server-side customer search of Phase 10 was removed: with Bookings and Jobs loaded alongside the book, one search over the same records is the simpler and consistent behaviour.) The Website and Marketplace are stored per business (§28) and read the active business's **Services** from PostgreSQL, handling an empty list. Booking slot logic is given the business's
Services and hours. The customer-facing pages are of two kinds that never mix: the Draft previews (signed-in only) and the published Site and listing (public, §28).

### Tests

`e2e/core-data-isolation.spec.ts` connects as `climvia_app` and proves, per domain, that SELECT sees only the active organization, that the customer tables refuse INSERT/UPDATE/DELETE, that a member cannot write Services or the team, that an
owner cannot write into another business, that ids and `organization_id` cannot be rewritten, that nothing here can be deleted, and that cross-organization references fail (property → customer, equipment → property, team member → Service, role,
availability, author, login). `e2e/{customers,services,team}-db.spec.ts` and `e2e/cross-domain-isolation.spec.ts` drive the real application: persistence after reload, the seeds, empty states, switching business, back/forward, logout and a tampered cookie.

## 14. Organization → many Sites

`sites` belongs to an organization (`ON DELETE RESTRICT`): **one organization, many Sites**, exactly one of them **primary** (`is_primary`, a partial unique index). A Site has a `name`, a `slug` (unique within the organization), a public identity `platform_slug` (unique everywhere), a `status` (`draft | published | archived`), the
template it started from (`selected_template_id`, a real foreign key to `site_templates`), the published version it points at (`published_version_id`) and, separately, its custom domains (`site_domains`, §34). Its content lives in versions, pages and sections (§28). Onboarding creates the first Site, private,
with a Draft from the default template. There is no "website" field on the organization. The whole model, the primary-Site strategy and the multi-Site rules are in §28.

## 15. The Website Builder

The ownership chain was built in Phase 15 so the Builder (Phase 16, §29) adds screens and section types, not tables above it:

```
Organization ──< Site ──< Site Version ──< Page ──< Section
                  │            └─ theme tokens and settings
                  ├── selected template (site_templates: application-owned, validated JSON)
                  ├── the Published version visitors see
                  └── platform address + custom domains (§34)
```

`site_pages` and `site_sections` carry `organization_id` with the same policies, grants and composite foreign keys as `sites`, so they inherit §9 and §10 unchanged. The visual Website Builder (Phase 16) edits exactly this model: it holds a working copy of the Draft's content in the browser and stores it back through one server function that matches rows by key (§29). Its only schema change is a revision counter on `site_versions` (migrations `0014` and `0015`). What it does not add, by design, is listed in §29: a template gallery and more templates, a Sites screen, an image library (which needs object storage).

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

Nothing is deployed to AWS yet. The application runs as a production-shaped stack of four containers (reverse proxy, web app, PostgreSQL and the migration that runs before the app), built and **verified against real containers in Phase 18C1**: see §35 for the topology, the Host trust model, the on-demand certificate permission, health checks, backups and the restore drill, and `docs/deployment-runbook.md` for the commands. One Ubuntu EC2 instance can run it later.

**Container.** `Dockerfile` (multi-stage) builds the Next.js standalone server and runs it as an unprivileged user (uid 10001, read-only filesystem, no capabilities); a second target (`tools`) runs the database scripts. The stack is `docker-compose.production.yml`, started with `deploy/scripts/deploy.sh`.

```bash
# The two images by hand (deploy.sh does this through compose):
docker build -t climvia-web --build-arg APP_VERSION=$(git rev-parse --short HEAD) .
docker build --target tools -t climvia-tools .

cp .env.production.example .env.production                   # then replace every placeholder
npm run config:check -- .env.production                      # fails with a list of what is wrong, before anything is built
deploy/scripts/deploy.sh                                     # build, check, migrate, start, verify
```

Secrets are never baked into an image (`.dockerignore` excludes every `.env*`, and the build copies none). The settings live in one git-ignored `.env.production` (`.env.production.example` lists them with what each is for); the compose file hands each container only the names it needs, so the app never receives the owner's credential (§35). The application's own required settings, which it also refuses to start without:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | the app's connection, as **`climvia_app`** |
| `DATABASE_ADMIN_URL`, `POSTGRES_OWNER_PASSWORD`, `POSTGRES_APP_PASSWORD` | the owner's connection and the two database passwords: used only by the migration and the database container; never given to the app container (the app refuses to start if it holds them) |
| `BETTER_AUTH_SECRET` | ≥ 32 random characters |
| `BETTER_AUTH_URL` | the public origin, `https://…` |
| `AUTH_TRUSTED_PROXIES` | the reverse proxy's network (in the compose stack, the fixed `edge` subnet) (see §3) |
| `AUTH_TRUSTED_ORIGINS` | optional extra allowed origins |
| `TLS_ASK_TOKEN` | the secret the proxy sends when it asks whether a certificate may be requested for a name (§35) |
| `CUSTOM_DOMAIN_TARGET`, `ASSET_STORAGE_DRIVER`, … | §33 and §34 |

Never run `db:seed` in production: it, `db:reset` and `db:test:prepare` refuse under the deployment marker `CLIMVIA_ENV=production` (set by the image), and the seed's data is not in the images at all.

**Single-EC2 target** (design only):

```
Internet ── 80/443 ──> Caddy container (TLS, sets X-Forwarded-For, keeps Host)         [edge network]
                          └─> app:3000  Next.js container (climvia-web, read-only, uid 10001)   [edge + data]
                                      └─> db:5432  PostgreSQL container, named volume on EBS   [data network, no way out]
```

- Security group: 80/443 from anywhere, 22 from the operator only; PostgreSQL never public.
- The app container and PostgreSQL share a private Docker network; the app holds only the `climvia_app` credentials.
- Logs to stdout, rotated by Docker (collected by a CloudWatch agent later). Health checks: `GET /health/live` (the process runs) and `GET /health/ready` (configuration, database and file storage are fit); §35.
- Later, as needed and not before: S3 for logos / avatars / site assets, SES for mail (verification, reset, invitations), RDS for the database, CloudFront for static assets.

> **Verification.** Through Phase 18B no Docker image had been built or run; the files were written to the documented behaviour of Docker and Next.js. Phase 18C1 built both images and ran the whole stack for real (Docker 29, Compose 5, Caddy 2, PostgreSQL 17): see §35 for what was proved and what was not. The single-EC2 target above is the design for Phase 18C2; nothing in AWS exists yet.

**Uploaded files (Phase 18A).** `ASSET_STORAGE_DRIVER` (`local` or `s3`, required in production), `ASSET_LOCAL_DIR`, `AWS_REGION` and `AWS_S3_BUCKET`; credentials come from the AWS default provider chain, an IAM role on the instance, never from configuration. The image mounts `/data/assets` for the local fallback. The bucket is private and is provisioned outside the application. Back the local directory up like the database. Details in §33; **Docker verification was required before AWS deployment (done in Phase 18C1, §35).**

## 18. Backups

**Implemented in Phase 18C1 (the commands, and a restore proved on real containers): `deploy/scripts/backup.sh`, `deploy/scripts/restore.sh`, `deploy/scripts/restore-drill.sh`, `deploy/scripts/backup-assets.sh`, `deploy/scripts/restore-assets.sh`; see §35 and `docs/deployment-runbook.md`.** What is *not* implemented is the schedule, the encryption, the off-host copy and the retention below: those are decisions for whoever runs the host and are Phase 18C2. The plan:

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
| Where it lives | Future platform tables (`subscriptions`, `plans`, `billing_events`), a Climvia-owned Stripe account | The **Payments / Quotes & Invoices** modules: the `quotes`, `invoices`, `payments` and line tables of §25, a Stripe Connect account *per business* later |
| Today | Not built | Built and stored per business (§25): payments are **recorded** by hand as money the business received; no processor, bank or accounting connection exists |

Billing will hang off the organization (`organizations.id`), never off a user, because the business is the customer. Gating features by plan will be a check beside the role check in §9. The financial tables of §25 share nothing with it: no table, column, function or credential is common to both, and a test asserts no table in the database is named for subscriptions or a payment processor.

## 20. Domain routing

**The application layer is built (Phase 18B, §34).** A business can claim a custom domain for a Site, prove it owns it with a DNS TXT record, and have the application serve the Site for requests whose `Host` is that name. A request's host name selects the **site**, and the site selects the organization: the proxy classifies the `Host`, a customer's name is rewritten to one internal route that asks the public function `app_public_domain`, and the page is the same renderer as `/sites/<platform_slug>`. Public traffic needs no session and does not use the tenant policies of §10.

**Still not built (Phase 18C):** the Internet DNS target and routing, the reverse proxy or load balancer, certificate issuance and renewal, a trusted-proxy setting for forwarded headers, and treating `<platform_slug>.climvia.com` as a routed hostname. The authenticated app stays on its own host so cookies and CSRF origins stay separate from customers' sites. No Route 53, DNS writes or certificate automation exists.

## 21. Deferred domain migrations

Each of these moved from sample data to PostgreSQL in its own phase, with `organization_id`, RLS and tests as in §9–§10. When a module moved, its `fixtureGate` call was deleted and it works for every organization.

Done: Services, Customers (+ properties, equipment), Team (staff, roles) (§13); Bookings, Jobs, the Schedule (derived) and blocked time (§24); Quotes, Invoices and Payments (§25); Maintenance Plans (with coverage and visits) and Reviews (with replies and requests) (§26); Marketing (campaigns, recipient snapshots, scheduling and sent state) and Analytics (reporting queries over those tables, with the sample business's approved history as explicit imported adjustments) (§27). The Website (Sites, Site Versions, Pages, Sections, the template, the public read path and a visitor's booking) and the Marketplace listing (§28). **No module remains on sample data.** The visual Website Builder (Phase 16, §29) edits the Draft. What is pending: the Host → Site mapping of §20, template choice (Phase 17), branding / logo / avatar storage and photo files and website images (an object store), invitations and member management, email and SMS (including the Website's contact-form messages).

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

- Financials (§25): `financials-database.spec.ts` (SQL as `climvia_app`: reads, writes, column grants, the overpayment and void triggers, quote transitions, no DELETE, cross-business relations, numbering, and the concurrency tests: simultaneous payments on one invoice by raw SQL and through the application, simultaneous invoice numbering, one invoice per quote, one void per payment),
  `financials-flows.spec.ts` (the real application: the canonical Record Payment flow, partial and void payments, Create Invoice, persistence after a reload and in a fresh session, member read-only, replayed and forged requests, customer financial history, tenant isolation, empty states for a new business), `financials-roundtrip.spec.ts` (what the seed wrote is what is read, stable ids, a second seed changes nothing),
  `payments.spec.ts` and `quotes-invoices.spec.ts` (the screens), and the pure `money.spec.ts`, `financial-rules.spec.ts` and `financials.spec.ts`. `financial-edits.ts` holds the small pure builders other specs use to ask the selectors "what if this payment were recorded?".

- Maintenance plans and reviews (§26): `maintenance-reviews-database.spec.ts` (SQL as `climvia_app`: what the seed holds, the structure, reads and writes per business, grants, composite foreign keys, the visit and booking triggers, reply and request guards, no DELETE, and the concurrency tests: simultaneous replies, simultaneous requests for one job, simultaneous edits), `maintenance-reviews-flows.spec.ts` (the real application: Sarah's Comfort Care, scheduling BK-1048 once, cancel and rebook, six simultaneous schedules, Create plan, reply, edit and request persistence after a reload and in a fresh session, member read-only, replayed and forged requests, tenant isolation, empty states for a new business, completing a job creating no review or request), `maintenance-reviews-roundtrip.spec.ts` (what the seed wrote is what is read, stable ids, a second seed changes nothing), `maintenance-reviews-rules.spec.ts` (the pure rules and totals), plus `maintenance-plans.spec.ts` and `reviews.spec.ts` (the screens). `review-edits.ts` and `replay.ts` hold the pure builders and the Server Action replay helpers the specs share.

- Marketing and Analytics (§27): `marketing-database.spec.ts` and `reporting-database.spec.ts` (SQL as `climvia_app`: what the seed holds, the structure, reads and writes per business, column grants, the transition and delivery triggers, recipient snapshot rules, composite foreign keys, no DELETE, the imported adjustments, and the concurrency tests: six schedules of one Draft, schedule against send, four cancels, a reschedule against a cancel, six duplicates, and Analytics unchanged by every kind of write except the ones that should move it), `marketing-flows.spec.ts` (the real application: Save draft, Schedule, Send, Cancel schedule and Duplicate persisting through a reload, business-time storage from any browser zone, stale and forged requests, recipients read only for the caller's business, Northstar, a member, a new business), `analytics-flows.spec.ts` (the canonical default view, every figure changing with a booking, job, quote, invoice, payment, plan, review or campaign, URL-backed tabs and ranges, CSV and PDF exports from the same report, tenant isolation, empty states), `marketing-analytics-roundtrip.spec.ts` (what the seed wrote is what is read, stable ids, a second seed changes nothing), and the pure `marketing-rules.spec.ts` and `analytics-rules.spec.ts` (transitions, content and timing validation, ranges, buckets, the baseline-plus-delta composition with hand-built facts, rating math). The old static `analytics-data.spec.ts` was removed with the fixtures it tested; `marketing.spec.ts`, `analytics.spec.ts` and the other regression specs were updated only where a static source became the database.

- The visual Website Builder (§29): `website-builder-rules.spec.ts` (the editing core as pure functions), `website-builder-db.spec.ts` (saving a Draft on PostgreSQL: the revision and its triggers, stale refusal, concurrency, forged identities, limits), `website-builder.spec.ts`, `website-builder-pages.spec.ts` and `website-builder-safety.spec.ts` (the Builder in the browser: selection, editing, sections, pages, theme, history, Publish, preview sizes, stale tabs, leaving with unsaved work, the inert canvas, accessibility); `e2e/draft-edits.ts` and `e2e/website-builder-ui.ts` are their small shared helpers.
- Websites and the Marketplace (§28): `site-rules.spec.ts` (the pure rules: the section registry and props validation, the theme tokens, the template definition and whole-site validation, the canonical address, the public booking request and its checks, the listing configuration), `website-database.spec.ts` (SQL as `climvia_app` and the owner: template read-only, RLS and grants per business and role, the Published-snapshot immutability, composite foreign keys, the Site identity guards, the Marketplace guards, the three public functions called with no session, a visitor's booking at the database), `website-lifecycle.spec.ts` (publish, atomicity, concurrency, make private, more than one Site, template application and explicit replacement, a Site's domain claims), `website-actions.spec.ts` (the Server Actions replayed as a member, with no session, as another business's owner, with forged arguments, and six at once), `website-public.spec.ts` (the public pages and what they never show, live bindings, the Draft preview, a visitor's booking and its refusals and rate limit, a new business, the client bundle), `website-roundtrip.spec.ts` (what the seed wrote is what is read, a second seed changes nothing, a test copy is restored, the Marketplace operations) and `website-edits.ts` (the small pure builders the data specs use). `website.spec.ts`, `marketplace.spec.ts`, `plans-website-data.spec.ts`, `server-boundaries.spec.ts` and the other regression specs were adapted only where a fixture became the database.

## 23. Known limitations

- Email verification, password reset, invitations and member management have no UI: they need a mail service and are the next SaaS work.
- The business logo and accent are stored (§33). The profile photo is still session-only (a picture chosen for the visit), and there is no media library, no private Asset, no image variant and no collector for unreferenced files. Real S3 has not been exercised from the development machine.
- Websites and the Marketplace (§28): the Website Builder (§29) edits pages, sections and the theme of the Draft, but there is no template gallery or choice of template (Phase 17), no Sites screen, no image or media library, and no way to roll back to an earlier version from a screen (the versions are kept; a rollback is a pointer change not yet exposed). The Website's contact form confirms and **delivers nothing** (no mail service). A custom domain is claimed, verified by DNS and, once activated, resolved to its Site by the application (§34); the platform address `<slug>.climvia.com` is displayed but is not a routed hostname, DNS routing and TLS are Phase 18C, and the platform pages are served at `/sites/<slug>` and `/listings/<slug>` on the application's host. The visitor-booking rate limiter is held in one server process (§28). The Draft preview's booking journey makes a real booking as the signed-in owner or admin. A business's uploaded logo is not shown on its Site or listing.
- Maintenance plans and reviews (§26): no screen pauses, ends, renews or edits a plan (no flow was approved, so the application has no UPDATE on plans), a visit is rescheduled only by cancelling its booking and booking it again, a review request is a record and nothing is sent, and a customer has no public way to submit a review yet (the sample reviews are seeded). The Website and the Marketplace show no reviews.
- Money (§25): there is no screen to write a quote or to edit, void or reissue an invoice (an invoice is made from an approved quote and is then fixed; a mistake in it is a new invoice for the quote's replacement), no refund or credit note, no tax model (an invoice shows Tax $0.00), no deposit or overpayment, no PDF, email or print, and no payment processor. The Overview's Total Invoiced and the Analytics quote and invoice-count aggregates cover more history than the stored records; the difference is held as explicit imported adjustments (§25, §27).
- Marketing and Analytics (§27): nothing is sent or delivered (no email or SMS provider; "Sent" is a recorded state, and only the sample business's seeded history carries a delivery result). A Scheduled campaign is not sent by anything when its time comes, and there are no templates, rich email builder, A/B tests or open and click figures. The imported history is part of an Analytics figure only when the date range covers all of its period (it is never prorated), the as-of totals (plans, reviews, campaigns) ignore the range, the screen has no Reviews or Marketing panel (those totals are on their own modules and in the exports' report data), and the sidebar counts beside Bookings and Jobs refresh on the next page load, not within the visit. The sample business's campaigns can report more recipients than they list (the extra are imported contacts, counted and not listed). A development database made before this phase needs `npm run db:reset`.
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
  the status, the local date and start and end times, a customer note, the intake answers, internal notes, the cancellation reason (present exactly when cancelled), the maintenance-plan visit it schedules (found from the plan's side: the visit points at the booking, §26),
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
at 1001; a seeded one starts above its largest seeded number, or where its dataset says (the sample business's booking counter starts at 1043, the approved Create booking number). A number already in use is skipped and never handed out again: Sarah Mitchell's scheduled maintenance visit is the stored booking `BK-1048` (§26), so the sample business's bookings go 1043 … 1047, then 1049.

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

Apex: 14 bookings (BK-1006 … BK-1042, and BK-1048, Sarah Mitchell's scheduled maintenance visit, §26), 11 jobs (JB-142, JB-178 … JB-204), 4 photo records on JB-204 and 2 blocks, with deterministic uuids. JB-204 is Sarah Mitchell's completed AC Repair & Diagnostics job at 1402 Kinney Ave, Austin, TX 78704, linked to BK-1042. The Overview
aggregates (Bookings 24, Completed Jobs 18) are **baselines**, not counts of these rows, and are deliberately not backed by invented records; since Phase 14 the difference is stored as imported adjustments (§27). Northstar: BK-1001 (confirmed, with JB-1001, assigned to Jordan Pike) and BK-1002 (a pending request), for Northstar's own customers
and services. A new workspace has none, and its counters start at 1001.

### Maintenance Plan bridge (BK-1048)

Since Phase 13 plans are on the database (§26). Scheduling an included visit still creates a **real booking** through the same shared code (source "Maintenance plan", confirmed, no job, no financial record), and the **visit** now points at it with a real foreign key (the plain `bookings.plan_id` / `plan_visit_id` columns of this phase were dropped). The plan screens **derive the visit's state from the stored booking** (`getVisitBooking()`): Scheduled after a reload, open again once the booking is cancelled. The booking learns its plan from the visit, so nothing could disagree.

### Reviews and jobs

Since Phase 13 reviews are on the database (§26). A review names the real job it is about (Sarah Mitchell's review → JB-204, which stays Completed) through a composite key, so the chip, the job page and the Request Review list (completed jobs only, JB-204 and JB-142 for Sarah) come from the stored jobs; a review cannot name another business's job, or another customer's.

### Website booking preview

The Website booking journey in the **Draft preview** (`/website/preview/booking/…`) is inside the signed-in workspace. It creates a real booking in the signed-in business, as that signed-in owner or admin, through the same authorized action: no organization comes from the page and nothing is trusted from it (the server
decides the status from the Service's booking method and refuses a Service that is not offered online).

Since Phase 15 the **published Site has a real public booking page** for a visitor with no session (`/sites/<slug>/booking/<service>`), through one narrow public write path that finds the business from the Site, validates the Service and the time with the same rules, deduplicates, and is rate limited (§28). The booking has source `Website`. (Until Phase 19E its `customer_id` stayed NULL; since then the booking is for a customer of the business, the one the visitor's email and phone identify, or one made from the booking: §40.)

### Not in this phase

Quotes, invoices, payments, plan records, review records, marketing, the Website model, file storage, rescheduling, drag and drop, routing, notifications by email or SMS, and the Analytics aggregate facts. No Docker image was built or run for this phase: the Dockerfile and compose
file are unchanged and compatible with the new migrations, and **Docker verification was required before AWS deployment (done in Phase 18C1, §35)** (§17).

## 25. Financials: quotes, invoices and payments

Phase 12 moved the business's money to PostgreSQL. It is the money **a business's customers owe and pay the business**; it is not Climvia's own billing (§19), shares no table with it, and involves no payment processor, bank connection or accounting package. Everything below belongs to exactly one organization, follows the rules of §9 and §13, and is read for the **active** business only.

| Domain | Tables | Written by | Read by |
| --- | --- | --- | --- |
| Quotes | `quotes`, `quote_line_items` | owner, admin (server actions) | every member |
| Invoices | `invoices`, `invoice_line_items` | owner, admin | every member |
| Payments | `payments` | owner, admin | every member |
| Numbering | `organization_sequences` (kinds `quote`, `invoice`, `payment` added to `booking`, `job`) | `app_next_number()` only | every member |

Migrations: `0006_financials.sql` (tables, constraints, indexes; generated by drizzle-kit from `src/db/schema/financials.ts`, with the sequence-kind CHECK widened in `schema/operations.ts`) and `0007_financials_rls.sql` (policies, grants and the guard triggers; hand-written). The code is `src/db/fin-queries.ts` (every read and write), `src/db/fin-mappers.ts` (rows ↔ the shapes the screens use), `src/lib/financial-rules.ts` (what a request may ask, pure), `src/lib/money.ts` and `src/server/actions/financials.ts`.

### Money is whole cents

Every stored amount is an **integer number of cents** (`unit_price_cents`, `line_total_cents`, `amount_cents`, `previously_paid_cents`): $89.50 is `8950`. There is no `money`, `real` or `double precision` column (a test lists every `*_cents` column and asserts they are all `integer`, and that no float column exists). A quantity is `numeric(10,2)` (1.5 hours is `1.50`) and a
line total is `round(quantity × unit_price_cents)` half up, which a CHECK constraint repeats so a row cannot carry another total; a test compares the application's rounding with PostgreSQL's for a spread of quantities and prices. The screens still hold dollars (89.5) because that is what a person reads, but such a number is only a **display value** derived from cents: every sum, difference and product goes
through `src/lib/money.ts`, which converts to cents first and calculates in integers, and what a person types ("$1,234.56") is read digit by digit, never with floating point (a test rejects `.toFixed(2)` and `Math.round(x * 100)` in the financial source outside that module). There is no tax model: an invoice shows Tax $0.00.

### What is stored and what is derived

An **invoice has no status, paid amount, balance or total of its own**. They are derived, by one set of selectors (`src/data/financials.ts`) that every screen and the server use:

- total = the sum of the invoice's line totals; received = the sum of its *recorded* payments; **paid = carried-forward money + received**; balance = max(0, total − paid); status = Paid when the balance is $0, Partially paid when something has been paid, otherwise Unpaid.
- A **quote's** total is its lines; its status (draft, sent, approved, declined, expired) is stored with the **date each step happened on** (`created_on`, `sent_on`, `approved_on`, …), and its activity list is read off those dates. There is no second log to keep in step.
- The Payments totals (payments recorded, amount received, outstanding invoices, outstanding balance) and the Overview's money are the same selectors over the same rows. **Voided payments are excluded** from every count and total; they stay in history, visibly voided.

Because nothing derived is stored, a screen cannot disagree with the payments behind it and the totals cannot drift. A wrong balance is a release blocker, so PostgreSQL also holds the one rule that matters most (below).

### Payments: recorded once, never edited, voided never deleted

`payments` has the invoice, the customer, the amount, the method (the five that existed: check, card, cash, bank transfer, other), the day the money was received, an optional check number and note, who recorded it, and, once voided, when, why (a reason from a fixed list), an optional note and by whom.

- **Partial payments** are simply several payments against one invoice. The status moves Unpaid → Partially paid → Paid by derivation; nothing is "updated".
- **A payment is never edited.** The runtime role cannot change its invoice, customer, amount, method, date, number or organization (column-level grants). The correction for a mistake is a **void**: the payment turns `voided` with its reason, time and person, stays in history, stops counting, and reopens the invoice's balance. A voided payment is final (`payments_guard_update`: recorded → voided only, once). It is never deleted; no table here has a DELETE grant.
- **Overpayment is impossible**, in three places: the screen (the amount range), the server (it locks the invoice, recomputes the balance from the rows and refuses an amount that is zero, negative, above the balance, or for an invoice with nothing owed), and the database (`payments_guard_insert`, below). A payment of exactly the balance is accepted; a cent more is not.
- **The customer on a payment is its invoice's**, set by the database from the invoice and held to it by a composite foreign key, so a client cannot name a different one (or another business's).
- **Atomicity and concurrency.** Recording takes an advisory lock on the invoice (`pg_advisory_xact_lock(hashtextextended('invoice-payments:' || invoice_id, 0))`), recomputes the balance, takes the next number and inserts: one transaction. The database trigger takes the **same** lock and re-checks the balance, so even a request that skipped the application cannot overspend: two payments racing for one balance are serialized, the second sees the first, and the later one is refused (a test races five $100 payments against a $300 invoice in raw SQL and six through the application: exactly three are recorded, with consecutive numbers, and a refused one gives its number back). `FOR UPDATE` on the invoice is not used: invoices have no UPDATE privilege at all. A void takes the same lock, so a void and a new payment racing on one invoice can never leave it over-paid, and three voids of one payment at once void it once.

### Invoices and Quotes

- An **invoice** is created **from an approved quote** (the flow that existed); it copies the quote's customer, property, Service, job, booking and lines, takes the next `INV-` number and the business's today, and is unpaid. It is created with its lines in one transaction (RLS lets lines join a document **only** in the transaction that created it, so a quote or an invoice can never gain or lose a line later and its total is its lines). `UNIQUE (organization_id, quote_id)` makes it one invoice per quote even under a race, and an invoice never changes afterwards (it has no UPDATE grant). Creating an invoice records no payment and does not change the quote.
- A **quote** is created as a draft with its lines and moves forward only: draft → sent → approved | declined | expired; the last three are final (`quotes_guard_transition`, repeated by the pure rules in `financial-rules.ts`). Approving a quote does **not** create an invoice. The server has `createQuoteAction` and `updateQuoteStatusAction` with all their rules and numbering, but **no screen calls them**: there is no new Quote wizard in this phase (it was not asked for), so the Apex quotes are seeded and move only through the database rules.
- **Jobs.** Completing a job creates no quote, invoice or payment (a test counts the three before and after). A quote and an invoice may *reference* the job and booking they came from (composite keys); nothing creates a document from a job by itself.

### Numbers are the business's own

"QT-884", "INV-1044" and "PAY-1008" are an integer `number` unique **within the organization** for each table (`UNIQUE (organization_id, number)`), allocated by the same `app_next_number(kind)` as bookings and jobs (§24), never `MAX(number) + 1`: a row lock on the counter serializes concurrent requests (twelve invoice and twelve payment numbers requested at once in one business come back as twelve distinct consecutive numbers each, while another business takes its own), a rolled-back transaction gives its number back, a new business starts every kind at 1001, and a seeded one starts above its largest seeded number (Apex: QT-894, INV-1052, PAY-1009). The application also checks the number it was given is free (a counter that fell behind its rows cannot repeat one). Two businesses may both have PAY-1001, and do: Apex's is a voided payment, Northstar's a recorded one.
A duplicate number inside a business is a release blocker; a test asserts none exists and the database refuses one.

### Dates and times

A document's dates (created, sent, approved, issued, the day a payment was received) are the business's **calendar dates** (`date` columns) and are never converted. The due date is **generated by PostgreSQL** from the issue date and the terms (due on receipt, net 7/15/30), so it cannot disagree with them. Only the system's own events (a payment recorded, a payment voided) are instants (`timestamptz`), turned back into the business's local date on the server (§24, "Dates, times and time zones"); the clock the server uses for "today" is the business's (the sample business's is October 25, 2024).

### The canonical Apex records, and the money that predates them

Apex's baseline is **seven recorded payments, $2,130.00 received, two outstanding invoices, $680.00 outstanding**; voided payments are excluded. The seed (`scripts/db/seed-data/financials.ts`) writes four quotes, nine invoices (INV-1043 … INV-1051) and eight payments through the same functions the application uses, with deterministic ids:

- **INV-1050** (Arthur Pendleton) is $500.00 with $200.00 already paid and a $300.00 balance. No payment record backs that $200, and the approved received total is exactly the seven recorded payments, so adding a $200 payment would make the baseline 8 payments and $2,330. The $200 is therefore carried **on the invoice** (`previously_paid_cents = 20000`, money received before payment records were kept): it counts toward the balance and is shown as "Previously paid", but it is not a payment and appears in no payments list or total. Only an `imported` invoice can carry it; the runtime role can create neither (RLS and a CHECK).
- **INV-1051** (Maya Lin) is $380.00, unpaid. **INV-1044** (Sarah Mitchell, $285.00) is fully paid by PAY-1008, has a $0 balance, is **not** linked to QT-884 (the source contradicted itself and the link was not restored), and is never offered for payment. **PAY-1001** is the historical payment recorded by mistake and voided: visible, excluded from every count and total. QT-884 is approved with no invoice.
- Recording $300 on INV-1050 makes **PAY-1009**: 8 payments, $2,430.00, one outstanding invoice, $380.00. After the payment, INV-1050 is Paid, INV-1051 Unpaid, and all of it is still true after a reload and in a new session.
- Northstar has its own small set (two quotes, two invoices with a partial payment and a voided one, numbered 1001 and 1002) and a brand-new business has none: Payments and Quotes & Invoices show real empty states with $0.00 totals, not "isn't available".

### Reporting totals that are baselines, not counts

The Overview's **Total Invoiced ($6,240)** and the Analytics quote and invoice-count aggregates describe more invoicing history than the nine stored invoices, exactly as Bookings 24 and Completed Jobs 18 describe more than the stored bookings (§24). They are **not backed by invented rows**. Since Phase 14 the difference is stored as **signed imported adjustments** (`analytics_imported_baselines`, §27): a report is the stored invoices in the range plus the adjustments, so Total Invoiced is $6,240 while only the seeded invoices exist, a new invoice moves it by exactly its own total ($6,525 after INV-1052), and a seeded invoice is never counted twice. Payments recorded, amount received and the outstanding figures are derived directly from the stored rows and need no adjustment, and the Overview and Analytics read the same reporting query.

### Authorization and tenant isolation

`financials:manage` (`src/lib/policy.ts`) is owner and admin; a member reads and changes nothing. In `src/server/actions/financials.ts` every action hands everything it does to one helper, `mutate()`, whose first step is `authorize("financials:manage")`; nothing is read from the arguments, parsed or looked up before it. The pipeline is the one of §13: **authenticated user → verified active organization (never taken from the request) → active membership → capability → validation → tenant transaction (`withTenant`, which sets the context that RLS reads) → validated references → locked rows → write → safe error.** No action takes an organization id and none of the arguments can name one: a request that does
is ignored, and a test replays a captured request with another business's id in it to show the payment lands in the *caller's* workspace only. Every reference a request names (an invoice, a payment, a quote, a customer, a Service, a job) is resolved **inside the transaction, within the verified organization**: one that belongs to another business is indistinguishable from one that never existed. A refused request rolls the whole change back; a database error is never shown (the detail is logged on the server).
PostgreSQL enforces the same: members of the **active** organization read; owner or admin insert and update only what the grants allow; composite `(organization_id, id)` foreign keys make a cross-business reference **impossible** rather than checked (an Apex quote cannot name a Northstar customer, Service, job or booking; an Apex invoice cannot name a Northstar customer, job, Service or quote; a line cannot name another business's Service; an Apex payment cannot name a Northstar invoice or team member). **Cross-tenant financial access is a release blocker** and is tested at the database, through replayed requests, and in the pages.

### Where the data meets the screens

The server loads the active business's financials with the rest of its core data (`getCoreSnapshot`) and `FinancialProvider` holds them for the whole workspace, so Payments, Quotes & Invoices, the customer pages and the Overview agree. Each change goes to the server, which answers with the financials **as stored**; only then does the working copy change, so a screen is never ahead of the database, and a refusal (an overpayment, a payment dated in the future, an already-voided payment, an already-invoiced quote) is shown in the dialog. The customer page lists that customer's quotes, invoices (with their balance) and payments, voided ones marked. The canonical Apex fixtures are not part of the application: nothing under `src/` imports the seed, and a test searches the built JavaScript for the seed's names and descriptions.

### Not in this phase

A payment processor, bank or accounting connection, Climvia's own billing, a Quote builder, invoice editing, refunds and credit notes, tax, PDFs and email, Maintenance Plans, Reviews records, Marketing, the Analytics aggregate facts, the Website model and Marketplace configuration (Maintenance Plans and Reviews followed in §26, Marketing and Analytics in §27). No Docker image was built or run for this phase: the Dockerfile and compose file are unchanged and compatible with the new migrations, and **Docker verification was required before AWS deployment (done in Phase 18C1, §35)** (§17).

## 26. Maintenance plans and reviews

Phase 13 moved Maintenance Plans (with their coverage and included visits) and Reviews (with replies and review requests) to PostgreSQL. A plan is the agreement a business makes with **its own customer**; it is not Climvia's own billing (§19) and shares nothing with it. Everything below belongs to exactly one organization, follows the rules of §9 and §13, and is read for the **active** business only.

| Domain | Tables | Written by | Read by |
| --- | --- | --- | --- |
| Plans | `maintenance_plans`, `maintenance_plan_coverage`, `maintenance_plan_visits` | owner, admin (server actions) | every member |
| Reviews | `reviews` | nobody through the application (customers write reviews; the seed carries the sample history in) | every member |
| Replies | `review_replies` | owner, admin | every member |
| Requests | `review_requests` | owner, admin | every member |

Migrations: `0008_maintenance_reviews.sql` (tables, constraints, indexes; generated by drizzle-kit from `src/db/schema/maintenance.ts` and `reviews.ts`, hand-ordered where a new key must exist before the foreign keys that use it) and `0009_maintenance_reviews_rls.sql` (policies, grants and the guard triggers; hand-written). `0008` also **drops** `bookings.plan_id`, `bookings.plan_visit_id` and the `bookings_plan_visit` check: they were plain text references written before plans existed, and the link is now a real foreign key held on the other side (below). The code is `src/db/maint-queries.ts` and `maint-mappers.ts`, `src/db/review-queries.ts`, `src/db/booking-create.ts` (the booking insert shared with the Bookings screens), `src/lib/maintenance-rules.ts` and `review-rules.ts` (what a request may ask, pure), and `src/server/actions/maintenance.ts` and `reviews.ts`.

### The Maintenance Plan model

A **plan** has its customer (a `customer_id`, **or** a `contact_name` with an address snapshot for someone without a Customers record: exactly one, by a CHECK, the pattern bookings, jobs and invoices use), the property it covers (only with a customer, and it must be **that customer's own**), a name, a status, the price per cadence, the start and the renewal / end date, the visits per year and a note. Statuses are the four the screens already had: `active`, `pending`, `paused`, `ended`; nothing else exists (CHECK). A plan **starts** Active or Pending; the application has no screen that pauses, ends or renews one (none was approved), so it has no UPDATE privilege on `maintenance_plans` at all. A paused or ended plan exists only as carried-in history, and ending a plan could never delete its visits or bookings: no table here has a DELETE grant.

**The price** is information about the agreement, stored as whole cents (`price_cents`, integer; the same rule as §25). It bills no one: creating a plan creates no quote, invoice or payment, scheduling a visit creates none, and the plan's $189 is not money received (a test counts all of them before and after, and that no financial table has a column that could name a plan).

### Coverage is not a Service

A plan covers kinds of visit: **Cooling maintenance** and **Heating maintenance**, and nothing else. They are rows of `maintenance_plan_coverage` (`coverage_key` `cooling` | `heating`, a label, how many visits) and **do not reference `services`**: no Service is added to the catalog (the Apex catalog stays exactly the six approved services), and nothing in the public Service list changes. Which Service a visit is *booked as* is configuration in the application (`COVERAGE` in `src/data/maintenance-plans.ts`; a cooling visit is booked as the Annual Cooling Tune-Up & Maintenance Service when the business has it), checked by the server when a visit is scheduled.

### Visits

A **visit** ("Visit 2 of 2, Cooling maintenance") is an entitlement, not an appointment. It has a position, a label, the coverage it belongs to, an optional target window, a status (`due`, `scheduled`, `completed`), the **booking** that schedules it and the day it was completed. It carries no date, time, technician or Service of its own: the appointment is the booking and only the booking. The coverage reference is a composite key through the plan, so a visit cannot cover something another plan includes.

PostgreSQL keeps the visit and its booking in step (`plan_visits_guard_update` and `bookings_sync_plan_visit`, in `0009`): a visit is born `due` with no booking; `due` → `scheduled` happens only by attaching a booking **for the plan's own customer** (a booking of another customer, or another business, is refused); `scheduled` → `completed` happens when its booking is completed, on the day of the service; **cancelling the booking reopens the visit** (`due`) and keeps pointing at the cancelled booking as history until the visit is booked again; a completed visit is final; one booking schedules at most one visit (`UNIQUE (organization_id, booking_id)`); and the runtime role can change a visit's status, booking and completion day and nothing else (column grants).

### Booking integration (BK-1048)

Scheduling an included visit makes a **real booking** through the code the Bookings screens use (`insertBookingTx`: the same validation, hours, team and numbering), source "Maintenance plan", confirmed, with **no job**, and links it to the visit **in the same transaction**: if either fails neither happens. The visit must be the plan's next uncompleted one, the plan must be active, the date must fall in the visit's window and not be in the past, and the Service must be the one the coverage maps to. The visit rows are locked in order (`FOR UPDATE`) so two requests for one plan wait for each other; a test fires six at once and exactly one booking results.

The Bookings screens know which booking belongs to a plan from the **visit's side**: `loadOperations` joins `maintenance_plan_visits` and `maintenance_plans` to give a booking its `planVisit` (the "Comfort Care · Visit 2 of 2" label). A booking carries no plan column that could disagree.

**BK-1048 is part of the approved baseline, so a clean seed already stores it.** Sarah Mitchell's second visit (Cooling maintenance) is `scheduled` and points at the one real booking BK-1048: Sarah Mitchell, 1402 Kinney Ave, Austin, TX 78704, Comfort Care, Nov 19 2024, 10:00 AM to 12:00 PM, Marcus Vance, confirmed, source "Maintenance plan", no Job. The Bookings, Schedule, plan and Customer pages show it immediately, and the plan offers no second "Schedule visit" for it. There is exactly one: seeding again changes nothing, the visit's booking is unique (`UNIQUE (organization_id, booking_id)`, so no other visit can take it), the visit's booking cannot be swapped while it is scheduled (`plan_visits_guard_update`), and the scheduling action refuses a visit that already has a booking ("That visit already has a booking"), also when six requests race for the same visit. The number is not reserved any more because it is simply stored: the booking counter is untouched architecture (`app_next_number`, never `MAX + 1`), it starts at 1043 for the sample business as approved, and an allocated number that already exists is skipped, so no later booking can be BK-1048. If BK-1048 is cancelled the visit is open again, and booking it a second time makes a **new** booking number (BK-1043 in the sample business); the cancelled one stays in history. Every other due visit is scheduled through the same transactional path as before.

### The canonical Apex records

The seed (`scripts/db/seed-data/maintenance.ts`, `reviews.ts`) writes them through the same functions the application uses, with deterministic ids. **Sarah Mitchell's Comfort Care** is $189 a year (`18900` cents), two visits a year, May 14 2024 to May 14 2025, Active, for her own property: visit 1 (Heating maintenance) fulfilled May 22 2024 with no booking or job, visit 2 (Cooling maintenance) scheduled as BK-1048 (above). Apex has six plans (Sarah's, David Chen's Seasonal Maintenance, and four for people without a Customers record: an active one, a renewing one, a paused one and an ended one); Northstar has one of its own, different in every value, whose first visit is Northstar's own BK-1001.

The workspace totals the screens report (14 active plans, 5 visits due, 3 renewals, 1 paused, 1 ended; and 12 reviews, a 4.7 average, 3 awaiting a reply, 5 requests) are **reporting baselines, not counts of rows**, exactly as Bookings 24 and Total Invoiced are (§24, §25): the seed does not invent dozens of rows to match them. Since Phase 14 the gap between the approved figures and the stored rows is held as signed **imported adjustments** (`analytics_imported_baselines`, §27: the `plans.*` counts, `reviews.count`, `reviews.rating_sum`, `reviews.awaiting` and `reviews.requests`), and every total is the stored rows plus the adjustment: a plan created moves Active 14 → 15, and a reply moves Awaiting 3 → 2 and Responded 9 → 10. A business with no history has no adjustment and counts exactly what it has, which is nothing. A plan, review or reply carried in with the sample history is still marked `imported` (informational only); the runtime role can write neither an `imported` row (RLS) nor an adjustment.

### The Reviews model

A **review** has its author (a Customers record, or a name), the rating (1 to 5), the source (**Climvia** is the only one; nothing is published to or read from any outside review site), the customer's words, the day it was left and, optionally, the **job** it is about. A review naming both a customer and a job must name that customer's **own** job (composite key). The application cannot create or change a review: the runtime role has SELECT only, so the customer's words, rating and author are never rewritten. **Sarah Mitchell's review** is 5 stars, "The technician explained the repair clearly and completed the work as scheduled.", about the real **JB-204**, which stays Completed; it awaits a reply, and the Reply dialog opens with the approved answer ("Thank you, Sarah. We appreciate your feedback and are glad the repair process was clear and completed as scheduled.").

### Replies

A review has **one** reply (`UNIQUE (organization_id, review_id)`); editing changes the same row. The server stores who signed it (`author_name`, the person's profile name at the time, and `replied_by`, their Team record when they have one) and when (an instant, shown in the business's time zone). The runtime role can change only `body`; the database sets `edited_at` when the words change (not when the same words are saved again) and nothing can rewrite who replied or when. Two people replying at once leave one reply: the second is told the review already has one. A reply is 1 to 500 characters.

### Review requests

A request is a **record** that the business asked a customer for a review. **Nothing is sent**: there is no email or SMS delivery, no Marketing campaign is created, and `status` is only `recorded`. It names a customer of the business and, optionally, one of that customer's **completed jobs**: the database refuses a job that is not completed (`review_requests_guard_insert`) or is another customer's (composite key), and **one active request per job** is a partial unique index, so a double click or a second person cannot ask twice for the same work. The Request review dialog offers only the customer's completed jobs without a request. **Completing a job creates no review and no request** (a test counts both before and after); a request is always a choice a person makes.

### Customers, jobs and the other modules

The Customer page reads the customer's plan, coverage and next visit (with its booking) from `maintenance_plans` and shows the booking as a link; the plan list and the Overview read the same plans; Jobs are untouched except that a completed job is what a request can name. A review's job chip and the job page resolve against the **active business's stored jobs**. Marketing and Analytics moved in Phase 14 (§27), and Analytics reads the plan and review figures through the same selectors with the same imported adjustment. The Website and the Marketplace were **not** migrated. The Website and the Marketplace show **no customer reviews** today (nothing in them reads the Reviews module), so there is nothing to wire; a public read of reviews needs the Website phase's public path (§15, §20) and a decision on which reviews a business publishes.

### Authorization and tenant isolation

`maintenance:manage` and `reviews:manage` (`src/lib/policy.ts`) are owner and admin; a member reads and changes nothing, and the screens do not offer them the buttons. Every action in `src/server/actions/maintenance.ts` and `reviews.ts` hands everything it does to one helper, `mutate()`, whose first step is `authorize(...)`: **authenticated user → verified active organization (never taken from the request) → active membership → capability → validation → tenant transaction → validated references → locked rows → write → safe error**. No action takes an organization id and none of the arguments can name one; a request that does is ignored, and a test replays a captured request with another business's id in it to show the plan lands in the *caller's* workspace only. Every reference (a customer, a property, a plan, a visit, a review, a job) is resolved **inside the transaction, within the verified organization**: one that belongs to another business is indistinguishable from one that never existed. A refused request rolls the whole change back and a database error is never shown.

PostgreSQL enforces the same: members of the **active** organization read; owner or admin write only what the grants allow; composite `(organization_id, id)` foreign keys make a cross-business reference **impossible** rather than checked (an Apex plan cannot name a Northstar customer or property, an Apex visit cannot name a Northstar plan, coverage or booking, a review cannot name another business's customer or job, a reply cannot belong to another business's review, a request cannot name another business's customer or job). Coverage and visits can join a plan **only in the transaction that created it** (RLS), so a plan never gains or loses either later. No table has a DELETE grant; ids, numbers, the customer, the property and the customer's words are never rewritten. **A cross-tenant read or write is a release blocker** and is tested at the database as the restricted role, through replayed and forged requests, and in the pages.

### New organizations

A new business has no plans and no reviews. Maintenance Plans and Reviews show real empty states with zero totals (not "isn't available"); with no customers there is nothing to put on a plan or to ask for a review, and the dialogs say so.

### Where the data meets the screens

The server loads the active business's plans and reviews with the rest of its core data (`getCoreSnapshot`) and `MaintenancePlansProvider` and `ReviewsProvider` hold them for the whole workspace, so the plan pages, the Bookings, the Customer page, the Overview and Analytics agree. Each change goes to the server, which answers with the data **as stored**; only then does the working copy change (a scheduled visit also updates the operations), so a screen is never ahead of the database, and a refusal is shown in the dialog. The canonical Apex fixtures are not part of the application: nothing under `src/` imports the seed, and a test searches the built JavaScript for the seed's names, addresses, reviews and replies.

### Not in this phase

Pausing, ending or renewing a plan from a screen, editing a plan or its visits, rescheduling a visit other than by cancelling its booking and booking it again, automatic billing from a plan, sending a review request (email or SMS), a public way for a customer to submit a review, reviews on the Website or the Marketplace, Marketing, the Analytics aggregate facts, the Website model and Marketplace configuration. No Docker image was built or run for this phase: the Dockerfile and compose file are unchanged and compatible with the new migrations, and **Docker verification was required before AWS deployment (done in Phase 18C1, §35)** (§17).

## 27. Marketing and Analytics

Phase 14 moved Marketing and Analytics to PostgreSQL. Marketing is campaign **management** (email and text-message campaigns to a business's existing customers; nothing is delivered); Analytics is a **reporting layer** over the other modules' rows, with the sample business's approved history kept as an explicit, separate, read-only source. Everything below belongs to exactly one organization, follows the rules of §9, §10 and §13, and is read for the **active** business only. Neither module is gated any more: a new business gets a real, empty Marketing and zeros in Analytics.

### The Marketing campaign model

Three tables (`src/db/schema/marketing.ts`, migrations `0010_marketing_analytics.sql` and `0011_marketing_analytics_rls.sql`), each with its own `organization_id` and composite `(organization_id, id)` foreign keys, like every table since §13:

| Table | What it holds |
| --- | --- |
| `marketing_campaigns` | The campaign: `slug` (its reference, `cmp-fall-maintenance-reminder`, unique per business), `name`, `summary`, `channel` (`email` or `sms`), `audience_id`, `subject` (email only), `message`, `status`, `scheduled_for`, `sent_at` and `sent_on`, `cancelled_at`, `recipient_count`, `delivered_count` / `not_delivered_count`, `created_by` (a Team member of the same business), `position` (the order campaigns are listed in), `created_at`, `updated_at`. |
| `marketing_campaign_selected_customers` | The customers a "Selected customers" campaign chose one by one: a **configuration**, not a snapshot. |
| `marketing_campaign_recipients` | The **recipient snapshot** of a Scheduled or Sent campaign (below). |

Only what the screens use is stored: a name, a channel, an audience, a subject (email), a message (at most 5,000 characters for an email, 160 for a text message), a status. There is no rich email builder, no template, no sequence, no A/B test. Statuses are `draft`, `scheduled` and `sent` and nothing else (a cancelled campaign is a Draft with `cancelled_at` set; there is no `paused` or `failed`). The audiences are the five the product has: all customers, customers due for maintenance, maintenance customers, customers with active plans, and selected customers. CHECK constraints keep a campaign honest (`campaigns_scheduled`: a campaign is Scheduled exactly when it has its time; `campaigns_sent`: Sent exactly when it has its day; `campaigns_delivery`: delivered + not delivered = the recipient count, both or neither, only on a Sent campaign; a text message is at most 160 characters and has no subject).

### Status transitions

```
draft ──▶ scheduled ──▶ sent        (a Draft can also be sent at once)
  ▲           │
  └───────────┘  cancel the schedule: back to Draft, cancelled_at stamped, never deleted
```

A Draft can be saved, scheduled or sent; a Scheduled campaign can be rescheduled, taken back to Draft (the schedule is cancelled) or sent; a Sent campaign is final. The one table of moves is `CAMPAIGN_TRANSITIONS` in `src/lib/marketing-rules.ts`; it is enforced four times:

1. **The action.** Every change names the campaign **and the status the screen saw it in** (`expectedStatus`). The server locks the row (`SELECT … FOR UPDATE`) and refuses if the status is no longer that one ("This campaign has changed since you opened it"), so a stale screen, a double click or a second person changes nothing twice. A request that does not say what it saw cannot be told from a stale one and is not understood.
2. **The guard trigger** `marketing_campaigns_guard_update`: a Sent campaign cannot be changed by anyone, through any column, even the owner role (`campaigns_final`); `cancelled_at` is stamped only when a schedule is cancelled (`campaigns_cancelled_at`); a Draft carries no recipient snapshot (`campaigns_draft_snapshot`).
3. **Row Level Security and column grants.** A campaign is created only as a plain Draft (no schedule, sent day, delivery result or cancellation can be written on the way in). `delivered_count`, `not_delivered_count`, `slug`, `created_by`, `position` and the ids have no UPDATE privilege at all. There is no DELETE privilege on campaigns.
4. **The CHECK constraints** above.

### The recipient snapshot

A Draft stores only its audience **configuration** (the audience and, for "Selected customers", the chosen customers). When a campaign is **scheduled or sent**, one transaction resolves the audience from the business's own customers, writes a snapshot row per person (`recipient_name`, `recipient_email`, `recipient_phone` as they are at that moment, `status` `pending`, `customer_id` linking the person to the Customers record where there is one) and stores the count on the campaign. A later edit of a customer **never rewrites** a snapshot: the contact details are copied, not referenced, and a test edits a customer after scheduling and shows the dialog still reads the old details. `customer_id` is a composite foreign key, so an Apex campaign cannot list a Northstar customer, and a Northstar recipient cannot belong to an Apex campaign, whoever writes the row.

- **When it is written.** A recipient can be inserted only for a campaign that is Scheduled or Sent **and was changed in the same transaction** (`updated_at = now()` in the policy), so the transition that earns a snapshot is the only moment it is written; a Sent campaign cannot be updated again, so no later transaction can satisfy the policy for it. A new row is always `pending` with no result.
- **When it goes.** A pending snapshot is deleted only while its campaign is still Scheduled (a reschedule, a cancel and a send each replace it). A Sent campaign's recipients are a permanent record that nobody deletes; no recipient row is ever updated.
- **What it can be smaller than.** The sample business's audience sizes (146, 38, 42, 18) describe a customer base its detailed Customers records do not hold, so a campaign's `recipient_count` can exceed the rows of its snapshot ("Showing 5 sample records of 146 recipients"). Those extra contacts are **imported** (see the baseline below): counted, not listed.
- **Privacy.** The recipients are not part of the workspace snapshot that goes to the browser with every page. The detail page of a Sent campaign whose delivery result was recorded reads its recipients on the server for that page only; everything else (the "View recipients" dialog, the builder's audience preview) asks one of two read actions in `src/server/actions/marketing-reads.ts` (`campaignRecipientsAction`, `previewRecipientsAction`) when the dialog opens. They are open to any member (who can read the customers anyway), change nothing, take no organization from the request, and answer "no longer exists" for a campaign of another business. A test replays them as another business and with no session.

### Audiences

Worked out from the business's own customers (`resolveAudience` in `src/db/marketing-queries.ts`): **all customers** (everyone with an email address for an email campaign, a phone number for a text), **due for maintenance** (the latest completed Maintenance-category job is more than six months before the business's today), **maintenance customers** (a completed Maintenance-category job, or any maintenance plan), **active plans** (an active plan), **selected** (exactly the chosen customers, each of which must be the business's own). A customer with no destination for the channel is left out, and a campaign that would reach no one is refused ("No customers match this audience, so there is no one to send to"). The sizes the builder shows come from the same function. For the sample business each audience also carries imported contacts (an adjustment per channel and audience, `marketing.audience_extra`), so its builder still reads 146 / 38 / 42 / 18; any other business counts only its own customers.

### Scheduling, the business's clock and time zones

A campaign's time is chosen as the **business's local date and time** and means the same instant everywhere. The server parses it against the business's own clock (`snapshot.clock`: the sample business's fixed Oct 25, 2024, every other business's real time in its time zone), refusing a past date, an earlier time today, a malformed value and a date more than two years ahead. It converts it with the organization's IANA time zone (`localToInstant`, §24) and stores a `timestamptz`: **Oct 30, 2024 9:00 AM in America/Chicago is `2024-10-30T14:00:00Z`** (CDT) and Nov 4, 2024 9:00 AM is `15:00:00Z` (CST: the clocks went back on Nov 3), whatever the browser's or the server's zone is. It is turned back with `instantToLocal` before it reaches a browser, which never parses a date. `sent_at` is the instant a campaign was recorded as sent and `sent_on` the business's calendar day; campaigns sent before the product kept a time of day have only `sent_on`. `cancelled_at` is an instant too.

### Provider delivery integration deferred

**Nothing is delivered anywhere.** There is no email or SMS provider (no SES, Twilio, SendGrid or marketing-automation service), no queue and no webhook. "Sent" is a *recorded state*: Climvia records that the business sent the campaign on that day to those people. A campaign recorded from the application has **no delivery result** (its `delivered_count` / `not_delivered_count` are null, its recipients stay `pending`, and its detail page says “Delivery records aren’t kept for this campaign.”). The delivery results the sample business's earlier campaigns show (Cooling tune-up reminder: 42 recipients, 40 delivered, 2 not delivered, with six recipients listed) are **seeded history**: the runtime role cannot write a result. When a provider is integrated it will write results through its own server-side path, never through a screen. **Provider delivery integration deferred.**

### Marketing actions, concurrency and authorization

`marketing:manage` (`src/lib/policy.ts`) is owner and admin; a member reads the campaigns and their recipients and changes nothing (the screens hide what a member cannot do, the server and PostgreSQL still decide). In `src/server/actions/marketing.ts` the five actions (`saveDraftAction`, `scheduleCampaignAction`, `sendCampaignAction`, `cancelScheduleAction`, `duplicateCampaignAction`) each hand everything to one helper, `mutate()`, whose first step is `authorize("marketing:manage")`; the pipeline is the one of §13. **Duplicate** copies the channel, audience, chosen customers, subject and message into a **new Draft** ("<name> (copy)") with no schedule, no sent time, no delivery result and no snapshot, whatever the original's status; the original is untouched.

Concurrency: the campaign row is locked for the whole change; the expected status is checked under the lock; a campaign's snapshot is replaced in the same transaction as its status; references (`cmp-…`) are allocated under a transaction advisory lock, so six simultaneous duplicates are six independent Drafts (`…-copy`, `…-copy-2` … `…-copy-6`) and never a unique-violation. Tests race six schedules of one Draft (one transition, one snapshot of N rows, never two), a schedule against a send, four cancels, a reschedule against a cancel and six duplicates, and replay a request made for a campaign as it was before it was cancelled elsewhere (refused, with the reason).

### Analytics: a reporting layer over the domain tables

Analytics owns **no records**. Its figures are computed when a page is asked for, by PostgreSQL, from the other modules' rows, in the active business:

| Piece | Where |
| --- | --- |
| The pure rules: date ranges, chart columns, imported adjustments, how rows and adjustments combine, the typed `AnalyticsReport` | `src/lib/analytics-rules.ts` |
| The queries: `getOperationsAnalytics`, `getFinancialAnalytics`, `getMaintenanceAnalytics`, `getReviewAnalytics`, `getMarketingAnalytics`, `getPeriodReport`, `getAnalyticsReport` | `src/db/reporting-queries.ts` |
| The imported adjustments (read only) | `src/db/adjustments.ts`, table `analytics_imported_baselines` |
| The request-scoped readers (workspace resolved from the session, `cache()` per request) | `src/server/reporting.ts` |

The Analytics page is a **server component**: it resolves the workspace, reads the range from the URL (`range`, `from`, `to`; anything that is not one of the three presets or a valid custom range of at most two years is "this month"), asks `getAnalytics`, and hands the typed report to the client view, which only shows it and changes the URL. There is no materialized view, no warehouse, no generic SQL endpoint, and no client-supplied SQL or organization. The queries are grouped aggregates over rows the existing indexes already serve: Bookings and Jobs by `service_date` (grouped by day, status and Service), Quotes by `created_on`, Invoices by `issue_date` (an invoice's status and balance are derived exactly as the Payments module derives them: paid when nothing is owed, partially paid when something has been received, otherwise unpaid; the balance counts every recorded payment, whenever it was made), Payments by `paid_on` (recorded and voided apart). Maintenance plans, reviews and campaigns are **as-of-today** totals, counted from the business's rows with the same selectors the Plans, Reviews and Marketing screens use, so a total on Analytics is the number the owning module shows; they do not depend on the date range.

### The imported historical baseline

The sample business's approved figures (October 2024: Bookings 24, Completed Jobs 18, quotes $4,820, invoices $6,240 …) were written independently of its detailed sample records, so they cannot be reproduced from rows, and the seed does not invent hundreds of rows to match them. They are kept in an **explicit, separate, organization-scoped table**, `analytics_imported_baselines`:

| Column | Meaning |
| --- | --- |
| `metric_key`, `dimension` | What the adjustment belongs to and how it is split: `bookings.by_status` / `confirmed`, `bookings.by_week` / `2024-10-21`, `bookings.by_service` / `ac-repair-diagnostics`, `quotes.value`, `invoices.count_by_status` / `paid`, `plans.active`, `reviews.rating_sum`, `marketing.audience_extra` / `email:all-customers`, … The keys are defined once, in `KEY` in `src/lib/analytics-rules.ts`. |
| `period_start`, `period_end` | The business's calendar days the adjustment describes (both or neither). |
| `integer_value` / `money_cents` | Exactly one, **signed**. |
| `metadata` | The approved figure and what the rows contributed when it was written: documentation only. |

The table is unique per business, metric, split and period (NULLs count as equal), has RLS for members of the active business to **read** and **no write privilege or policy at all**: the seed, running as the owner, is the only author.

### Baseline + live delta: no double counting

A baseline row is an **adjustment**, not a total: *the approved figure minus what the detailed rows contribute to it*, computed once at seed time with the same reporting functions the application reports with, over the detailed rows alone (`scripts/db/reporting-seed.ts`). A report is then

> the detailed rows the date range selects **+** the adjustments whose whole period the range covers.

So while the rows are as seeded the report is exactly the approved figure; a new booking, quote, invoice or payment, or a seeded row changing status, moves a figure by exactly its own contribution (a booking moving from confirmed to cancelled changes two status counts and not the total); and nothing is counted twice, because the adjustment never changes and already excludes what the rows hold. Tests assert it explicitly (`reporting-database.spec.ts`: the full report minus the rows-only report is exactly the stored adjustments, before and after a payment and a booking; `analytics-rules.spec.ts`: the same with hand-built facts). An adjustment is **negative** where the approved figure is smaller than the sample records beside it: the approved weekly and per-Service tables hold fewer bookings than the sample's records do in some places (21 to 27 October holds 11 sample bookings against an approved 4, a −7 adjustment; the sample's four quotes add up to $6,570 against an approved $4,820, −$1,750). The reconciliation is documented rather than hidden; the approved numbers themselves are unchanged. A **new organization has no adjustment rows**, so it reports only what its rows say (zeros); Northstar has a few small adjustments of its own (bookings and jobs by status, week and Service) so that tenant separation is visible.

Money received needs no adjustment (the approved $2,130 is exactly the seven recorded payments), nor does the outstanding balance ($680, from the rows).

### Average rating

The Reviews and Analytics average is **always (sum of all ratings) / (number of all reviews)**, rounded to one decimal, never a stored average. The sample business's 12 reviews are 4 stored reviews plus adjustments for the count (8) and the **rating sum** (37), so the approved 56 / 12 = 4.7 holds, and a review added later weighs exactly its rating (61 / 13 = 4.69 → 4.7; a single 1-star review would make it 57 / 13 = 4.4). Another business's reviews never enter the calculation (each report is one business's), a reply moves a review from awaiting to responded and changes neither the count nor the average, and a cancelled or voided anything else is irrelevant. The same shape holds for plans (`plans.active`, `plans.visits_due`, …) and requests.

### Date ranges

The presets (This month, Last month, This quarter) are worked out from the **business's own today**: the sample business's is the product's fixed Oct 25, 2024, so its default view is October 2024; any other business's current month is the real one (so Northstar's seeded October 2024 data is asked for by date). A custom range is two valid dates, in order, at most two years apart. The URL carries the tab and the range, so a view survives a reload and a link, and a business switch (a full page load) lands on the Overview.

- Dated facts are filtered by the range; a range with no records shows the approved empty state and a disabled Export.
- Imported adjustments are included **only when the range covers their whole period** (October 2024 for the sample business), never prorated and never spread over days. October 10 to 20 therefore shows only the records inside it (one quote, $195, and no invoices) with a note that the imported history is part of the figures only when the range covers all of it; **this quarter** (Oct 1 – Dec 31) covers it and also holds November's booking BK-1048, so it shows 25 bookings (the approved 24 plus BK-1048).
- The chart is Monday-to-Sunday weeks clipped to the range (up to ten weeks), then months. **No daily distribution is fabricated**: a one-day range is one column with exactly what happened that day.
- Limitations: the imported history cannot be shown for a part of its period (its week and Service tables are independent marginals of the approved figures); the as-of totals ignore the range; Reviews and Marketing totals are exposed by the reporting layer and shown on their own modules' screens, and the Analytics screen keeps the four panels the approved design has (Overview, Bookings & Jobs, Financial Records, Maintenance Plans & Services) — no Reviews or Marketing panel was invented.

### Exports

The CSV and PDF are built in the browser **from the same typed report object the screen shows** (`src/lib/report-export.ts`), so the screen, the CSV and the PDF cannot disagree: whole dollars and cents from integer cents, the business's name, the range and the business's own "prepared on" day. A business can only export its own report (the page resolves the workspace server-side), a range with nothing in it cannot be exported, and the file name carries the range (`climvia-analytics-2024-10-01-to-2024-10-31.csv`).

### The Overview and the sidebar

The Overview's Bookings, Completed Jobs, Total Invoiced and Payments Received are the current month's headline totals of the **same report** (`getMonthTotals` in the Overview page; `core.reporting.month` for the sidebar), so Analytics and the Overview can never disagree, and `getTotalInvoiced` is now a plain sum of the stored invoices (the approved $6,240 is reconciled by the reporting layer, not written in the page). The sidebar's counts beside Bookings and Jobs are those totals when the page loads (nothing is shown for a business with none); they are read with the layout, so after a booking is created or a job completed in the same visit they refresh on the next page load, switch or reload while the Overview and Analytics read fresh.

### Seeds

Apex has eleven campaigns written by the seed through the application's own function (`scripts/db/seed-data/marketing.ts`): the five approved ones in the order the screens list them (Fall maintenance reminder, scheduled for Oct 30, 2024 9:00 AM America/Chicago, 38 recipients; Cooling tune-up reminder, sent Oct 18, 42 recipients, 40 delivered, 2 not delivered, with its six listed recipients; the Seasonal service reminder draft; Winter heating prep notice; Filter replacement reminder) plus one more Draft and five plain, older Sent campaigns (all sent more than 60 days before the sample day), so the workspace totals (**2 Drafts, 1 Scheduled, 8 Sent, 146 recent recipients**) are *counts of stored campaigns*: recent recipients are those of campaigns sent in the last 60 days plus those still scheduled (42 + 48 + 18 + 38). Northstar has one Draft and one Sent campaign of its own (its recipient is Priya Raman). The approved aggregates are in `scripts/db/seed-data/reporting.ts`, turned into adjustments after everything else is seeded; `resetTestTenant` restores campaigns, recipients and adjustments with the rest. An existing development database must be rebuilt (`npm run db:reset`) to pick the new tables and rows up: the seed only fills a business that has no core data yet. Seeding twice changes nothing (a test compares counts, timestamps and sums).

### Authorization and tenant isolation

Members of the **active** organization read; owner or admin write what the grants allow (§10 conventions: transaction-local context, SECURITY DEFINER membership checks, composite foreign keys, no DELETE on campaigns). **Cross-tenant Marketing or Analytics leakage, campaign recipient leakage and Analytics double counting are release blockers**: they are tested at the database (as `climvia_app`), through replayed Server Actions (forged organization, forged campaign references, forged customers, another person, no session), in the pages (Northstar sees none of Apex's campaigns, recipients or figures, and the other way round), and in the built JavaScript (no campaign name, message, recipient or contact detail of either business is in the browser's bundle, and none of the removed baseline constants is in `src/`).

### Where the data meets the screens

The server reads the active business's campaigns with the rest of its core data (`getCoreSnapshot`; the recipients are not part of it), `MarketingProvider` holds them, and each change goes to the server, which answers with the campaigns **as stored**; only then does the working copy change. The Plans and Reviews screens add the imported adjustments (`core.reporting.adjustments`, per business, read from the database) to what their rows say. Analytics and the Overview are server-rendered from the reporting layer.

### Not in this phase / what is left

Sending any email or text message, any provider (SES, Twilio, SendGrid), external marketing automation, templates and a rich email builder, A/B tests and open or click analytics, Website pages and Marketplace configuration in PostgreSQL, SaaS billing, custom domains and S3. The migration roadmap that remains is the **Website** (pages, the booking page configuration and the public preview paths) and the **Marketplace** listing, then the object store for photos and branding. **Docker verification was required before AWS deployment (done in Phase 18C1, §35)** (§17): the new migrations were applied and tested on the PostgreSQL stand-in used for development, the Dockerfile and compose file are unchanged, and no image was built or run.

## 28. Websites, Site Versions and the Marketplace

Phase 15 moved the Website and the Marketplace to PostgreSQL and built the architecture the visual Website Builder (Phase 16, §29) sits on. Nothing in this section is a fixture any more: a new business gets its own private Site with a Draft, and the approved Apex Climate Heating & Air website is **seed data** (`scripts/db/seed-data/website.ts`) written through the application's own functions. The Builder (§29) is the editor for the Draft; the last subsection of this section says what Phase 16 changed and what is still not built.

### The model in one view

```
Organization ──< Site ──< Site Version ──< Page ──< Section
      │             │          └─ theme and settings (JSON, validated)
      │             ├── selected template  ──>  site_templates   (application-owned, read-only to tenants)
      │             ├── published_version_id ─>  exactly one Published Version of this Site (or none: the Site is private)
      │             └── platform_slug (its public identity); custom domains are claims of their own (§34)
      └──< marketplace_listings (at most one) ──< marketplace_listing_services >── services
```

Seven tables, in `src/db/schema/sites.ts` and `src/db/schema/marketplace.ts`, migrations `0012_website_marketplace.sql` (tables, constraints, indexes; generated by drizzle-kit and then edited by hand: the backfill of `platform_slug`, the move of the new composite `UNIQUE` keys ahead of the foreign keys that need them) and `0013_website_marketplace_rls.sql` (policies, column grants, triggers, the public functions and the default template row; hand-written, built from the same pieces as `0001`, `0003`, `0005`, `0007`, `0009` and `0011`).

| Table | What it holds | Who writes it |
| --- | --- | --- |
| `site_templates` | An application-owned, reusable site definition: `key`, `name`, `category`, `schema_version`, `definition` (JSONB), `is_active`. | **A migration only.** The runtime role has `SELECT` on the active rows and nothing else. |
| `sites` | A Site: `organization_id`, `name`, `slug` (unique in the business), `platform_slug` (unique everywhere), `is_primary`, `status` (`draft`, `published`, `archived`), `selected_template_id`, `published_version_id`. Custom domains are not columns of a Site (§34). | Owner and admin: the name, status, template and published pointer. The identity (`slug`, `platform_slug`, `is_primary`, `organization_id`) has no `UPDATE` privilege at all. |
| `site_versions` | One state of a Site's content: `status` (`draft` or `published`), `version_number`, `theme`, `settings`, `template_id`, `published_at`, `published_by_user_id`. | Owner and admin create the Draft and change a **Draft's** theme, settings and template. A Published version is created only by Publish and never changes. |
| `site_pages` | A page of one version: `page_key`, `title`, `slug`, `page_type`, `sort_order`, `is_visible`. | Owner and admin, while the version is the Draft (and Publish, for the snapshot). |
| `site_sections` | A section of one page: `section_key`, `label`, `type`, `variant`, `props` (JSONB), `sort_order`, `is_visible`. | The same. |
| `marketplace_listings` | A business's listing (below). | Owner and admin. |
| `marketplace_listing_services` | The Services a listing shows, in order. | Owner and admin. |

Every table carries `organization_id` itself and reaches its parent through a **composite foreign key that includes it** (`(organization_id, site_id)`, `(organization_id, site_id, site_version_id)`, `(organization_id, site_id, site_version_id, page_id)`, and for the published pointer `(organization_id, id, published_version_id)` against `(organization_id, site_id, id)`), so a Page cannot belong to another business's Site or Version, a Section cannot sit on another business's Page, a Site cannot be published from another Site's Version, and a listing cannot select another business's Service, **whoever writes the row** (PostgreSQL checks a foreign key outside Row Level Security). No table cascades from a Site: a Site holds pages people wrote, so it is removed deliberately, never as a side effect, and the runtime role has no `DELETE` on `sites`, `site_versions` or `marketplace_listings` at all.

### Site ownership and the primary-Site strategy

An organization owns **many** Sites (`organization_id`, `ON DELETE RESTRICT`); there is no `organization.website` field and no rule that a business has one Site. Exactly one is its **primary** Site (`is_primary`, a partial unique index: at most one per organization): the one the Website module edits, the one the Marketplace "View website" and "Book service" actions lead to, and the one the preview shows. Nothing in the Website's Server Actions accepts a Site id: each action finds the primary Site from the **verified** organization inside its own tenant transaction (`findPrimarySite`), locks it, and changes it. A Sites screen (choose, add, archive) is later work and needs no schema change (§29). The standing sample data proves the many-Sites rule with real rows: Apex has a published `main` Site and a private `commercial` one, each with its own Draft, pages, sections, theme and history; the tests create more.

Onboarding creates the first Site in the same transaction as the organization: `slug = "main"`, `is_primary`, **private**, with a Draft made from the default template (below) in neutral words that speak of the business only through its own record. Nothing of Apex or Northstar is copied.

### Public identity: the platform address

A Site's public identity is `platform_slug`: globally unique, lower-case words joined by hyphens, at most 63 characters, never a name the platform keeps for itself (`www`, `app`, `api`, `admin`, `login`, `sites`, `listings`, `climvia` … : `RESERVED_PLATFORM_SLUGS`), checked by the database. It is the last part of the Site's address on the platform, `<origin>/sites/<platform_slug>`, where the origin is the deployment's own (from `BETTER_AUTH_URL`; §39): that is where the Site is served and what the workspace shows as its address. It is **collision-safe and not taken from the business's name as typed**: the first Site of a new business starts from the organization's own address (itself unique and numbered when two businesses share a name), a second business that already has it (or a reserved name) gets `-2`, `-3` …, and a Site made without one gets the organization's address plus six random characters from a database trigger. Two businesses with the same name get two different public addresses (tested).

### The Template model

A template is **data, not code**: a row of `site_templates` whose `definition` is validated JSON (`validateTemplateDefinition` in `src/lib/site-template.ts`) that selects registered section types and variants and gives them text. It holds no component, markup, style, script or hook. It is owned by the application: the runtime role cannot insert, update or delete a template, and `0013` writes the first, **`climvia-starter`** ("Climvia Starter", category `hvac`; Phase 17 added three more beside it, written by `0016`, §31): a five-page HVAC website (Home, Services, About, Contact, Booking) that reproduces the approved Apex website word for word, with `{{business.name}}` / `{{business.location}}` where the business is named. `src/db/default-template.ts` is the same definition in code (the migration cannot import it): a test keeps the stored row and the code equal, and `scripts/db/template-sql.ts` prints the `INSERT` for the migration, so they cannot drift.

The definition is `{ schema, theme, settings, pages: [ { key, title, slug, type, visible, sections: [ { key, label, type, variant, visible, props } ] } ] }`. **Schema/version strategy:** `schema_version` (a column) and `definition.schema` (inside) are the version of this *shape* and a `CHECK` keeps them equal; the code lists the shapes it reads (`SUPPORTED_SCHEMAS`, today `[1]`). A new shape means: raise `TEMPLATE_SCHEMA`, keep a reader for the old one (or migrate the stored definitions in a migration), never edit a stored definition in place. Bounds: at most 12 pages, 40 sections per page, 200 Service references; unknown keys are refused, never carried along.

**Applying a template is a server-side act.** `createDraftFromTemplate` copies a template's theme, settings, pages and sections into a new Draft (refused when the Site already has one) and records `selected_template_id`. `replaceDraftWithTemplate` puts a template over an existing Draft: it **destroys that Draft's pages and sections**, so it refuses unless the caller passes `confirmReplace: true`, keeps the Draft's identity, and never touches a Published version. Both validate the template again before using it. There is no template gallery in the interface (Phase 17); onboarding and the "create website" action use the default.

### The Site Version model

A Site has **at most one Draft** (the mutable version: `status = 'draft'`, no number; a partial unique index) and any number of **Published versions** (immutable snapshots: `status = 'published'`, a number 1, 2, 3 … unique per Site, stamped with when and by whom). The version carries the **theme** and the **settings** (which Services the Site shows and in what order), so a Published version keeps the look and the list it was published with. `sites.published_version_id` is the version visitors see; a CHECK keeps `status = 'published'` exactly when that pointer is set, a trigger lets it point only at a *published version of this very Site*, and the composite foreign key makes it a version of this Site of this business. **Published versions are kept** (no cleanup): they are the history a rollback (a pointer change) would read.

**Published authoring rows are immutable, not merely unwritten by the application.** A trigger (`site_versions_guard_update`, `site_content_guard_update`) refuses any `UPDATE` of a Published version, or of a page or section of one, through any column, for anyone, **the owner role included** (`site_published_final`). Row Level Security lets the runtime role create a Published version, page or section **only in the transaction that has just changed the Site it belongs to** (`sites.updated_at = now()` is the transaction's own start time), as the person publishing (`published_by_user_id` = the caller), and only if that person is an owner or admin; and it lets the runtime role update or delete only the rows of a **Draft**. So no other path, a forged request included, can write a snapshot or change one.

### The Draft / Published lifecycle

```
create website ─▶ Draft ──Save (Builder)──▶ Draft ──Publish──▶ Published vN (new, immutable) ◀── site points at it
                    ▲        │                              │
                    │        └─ Discard (the screen drops its unsaved edits) ─────────────────────┘
                    └── Unpublish: the Site becomes private; pointer cleared; every version kept
```

- **Save** (`saveDraftAction`, §29) takes the Website Builder's whole working copy and the revision it opened at, validates **all** of it again on the server (every section against its registered type and variant, plain text only; the page and address rules) and stores it in one transaction, to the **Draft only**: a Published page is not selectable. Nothing is stored when anything is invalid, or when the stored Draft has moved on since that revision. The Builder keeps its Unsaved changes state, its Discard confirmation and its leave-the-page protection; **Discard** restores the stored Draft (the unsaved edit only ever existed in the browser).
- **Publish** (`publishSite`) is one transaction: it authenticates the caller, verifies the active organization and the `website:manage` capability, **locks the Site row** (`SELECT … FOR UPDATE`), refuses a Draft whose revision is not the one the Builder named (when it names one), validates the **whole** Draft (`validateContent`: theme, settings, every page and section; an invalid Draft is refused with every problem named), returns without a new version when the Site is already live with exactly the Draft's content, takes the next version number under the lock, touches the Site row, inserts the Published version with fresh copies of the Draft's pages and sections, and points `published_version_id` at it. A failure anywhere rolls all of it back; a test throws after the work and finds no version, no page, no pointer change. **Two publishes at once** queue on the lock: the second finds the Site already live with that content and answers with the first's number (six simultaneous publishes make one version), and a publish racing a save sees the Draft whole, as it was before or after the save; version numbers are contiguous and unique (the database also enforces `UNIQUE (site_id, version_number)`).
- **Unpublish** sets the Site private and clears the pointer. Pages, sections and versions are kept; publishing again makes the next version.
- Custom domains (§34) are independent of all of it: claiming, verifying, activating, removing or choosing the main address never changes content or publication, and none of those changes a claim.

### Pages and Sections

A page is `page_key` (its stable identity: `home`, `services`, `about`, `contact`, `booking`), `title`, `slug` (its address segment; **`''` for Home, and only Home**, a CHECK), `page_type` (`home | services | content | contact | booking`), `sort_order`, `is_visible`; keys and slugs are unique within a version. A section is `section_key` (unique within its page), `label`, `type`, `variant`, `props`, `sort_order`, `is_visible`. The Apex baseline is exactly the five pages above, all visible and published, with the approved copy preserved word for word.

### The section registry and props validation

The set of section types is **code** (`src/lib/site-sections.ts`, `SECTION_REGISTRY`), not data: the database stores a type and a variant as lower-case identifiers and the application decides which are real. Ten types:

| Type | Variants | Text fields it owns | Connected to |
| --- | --- | --- | --- |
| `hero` | `default` | headline, supporting text, primary and secondary button labels, alignment | |
| `page_intro` | `default` | heading, supporting text, alignment | |
| `service_list` | `cards`, `catalog`, `booking` | `cards`: heading and supporting text | the business's Services (`booking`: the Booking page's grid) |
| `feature_list` | `icons`, `plain` | heading, three titled points (`plain` also supporting text) | |
| `rich_text` | `default` | heading, description | |
| `business_hours` | `card`, `page` | none | the business's hours |
| `contact_details` | `card`, `page`, `callout` | `callout`: heading and supporting text | the business's contact details |
| `business_details` | `default` | none | the business's contact details |
| `contact_form` | `default` | heading, supporting text | (a message form that is **not delivered**, below) |
| `call_to_action` | `default` | heading, supporting text, button label | |

`validateProps(type, variant, props)` runs **on the server, on every save and again on every publish**, and refuses: an unknown type or variant (a fixed, safe message), any key the variant does not declare, a missing, empty or over-long field, a non-string, an alignment other than left/center, and text that is not **plain** (`<` or `>`, control characters, `javascript:` / `data:` / `vbscript:` schemes, `on…=` handlers, or a `{{ … }}` other than the two tokens). There is no field called html, script, iframe, style or class anywhere, and no section type that could carry one: nothing a person types can become markup, a frame, a handler or a style. The renderer is defensive too: a section whose type this application does not know is not drawn, and `readProps` drops any stored value that would not validate (a row written by something that skipped the checks), so a page is still drawn, with whatever is safe, and never with a refused value. The database adds only structural limits (identifier format, props is a JSON object of at most 20 KB).

### The Theme model

The theme belongs to the version and is **design tokens, never CSS** (`src/lib/site-theme.ts`): `accent` (`null` for the Climvia teal, or `#RRGGBB`), `radius` (`small | medium | large`), `density` (`compact | comfortable`), `headingFont` and `bodyFont` (an identifier from a closed list: `inter`, `system-sans`, `serif`: the self-hosted Inter and the visitor's own system stacks, nothing downloaded). Unknown keys are refused; every token is applied (as CSS custom properties and `data-site-density` built by the application from the validated values) and is edited in the Builder's Theme inspector (§29). A stored theme that does not validate is replaced by the default when drawn. A `CHECK` requires the theme to be an object with `schema = 1`.

### Dynamic bindings: what is snapshot and what is live

This is deliberate, documented and tested:

- **The published *structure* is snapshot-versioned.** Which pages, which sections, their order, their visibility, their text, the theme and the list of Services the Site shows are the Published version's. Editing the Draft never changes them; only Publish does.
- **The business's own record is always live.** Name, phone, email, address, business hours and time zone are read from `organizations` and `organization_business_hours` **when a page is drawn**, never copied into a section; the two text tokens (`{{business.name}}`, `{{business.location}}`) are filled at render. A rename, a new phone number or new hours show on the published Site at once, with no new version (tested: the version number stays 1).
- **Services are always live.** The Services come from `services`: a new price, a retired (inactive) Service and a Service made internal show at once, with no republish. The version's settings hold **references by slug** (`order`, `hidden`), resolved against the business's own Services when drawn, and no section holds a Service's name, price or description (a test searches every stored section for them). A retired Service is simply not drawn; its booking address says "Service not found".
- The public projection only ever contains what a visitor may see: the organization's public contact fields and hours, and **active, non-internal** Services.

### Public read security

A visitor has no session and no organization, so the public pages do **not** go through the tenant policies. They go through **three `SECURITY DEFINER` functions** (`0013`), the only way a request without a membership reads or writes tenant rows:

| Function | Does |
| --- | --- |
| `app_public_site(platform_slug, page_slug)` | Resolves the Site → its organization **inside the function**, and returns a *projection*: the Site's name and slug, the organization's public fields, the hours, the published version's theme and settings, the visible pages (navigation), the requested page with its visible sections, and the public Services. `NULL` unless the Site is published. |
| `app_public_listing(public_slug)` | The same for a published Marketplace listing, with a contact detail the listing switched off absent from the answer altogether. |
| `app_public_create_booking(…)` | One booking of source `Website` (below). |

Each has a fixed `search_path`, is revoked from `PUBLIC` and granted to the runtime role alone, **never takes an organization id**, builds its answer field by field (never a row, never `*`), and reads only the **published** version, only its visible pages and sections, and only active public Services. Customers, jobs, money, team permissions, analytics, notes, internal Service descriptions and unpublished Drafts are not reachable from them. The unrestricted number allocator the booking function uses (`app_take_number`) is not executable by the runtime role at all (a test calls it as that role and is refused). The browser's request handlers use the restricted `climvia_app` connection only; **the owner credential (`DATABASE_ADMIN_URL`) is never in a request path** (a source scan holds `src/db/public-queries.ts` to exactly these three calls).

The routes (all in the `(public)` group, which is `force-dynamic`, has no shell and mounts no provider and reads no session, §30):

| Route | Serves |
| --- | --- |
| `/sites/[siteSlug]`, `/sites/[siteSlug]/[...slug]` | A published Site's pages; the booking journey of one Service is `/sites/<slug>/booking/<service-slug>`. |
| `/listings/[listingSlug]` | A published Marketplace listing. |

A Site that is private, unpublished, unknown or misspelt, a page that does not exist or is hidden, and a path that names nothing are **one and the same "not found"** (a test compares the bodies), so nothing reveals whether a private Site exists. No organization comes from the browser: an `organizationId` in the query string, a header or a cookie changes nothing (tested). **No shared cache:** pages are rendered on request with `Cache-Control: private, no-cache, no-store`; the only memoisation is React's `cache()` *within one request*; nothing in `src` uses `unstable_cache`, `revalidate` or static generation (a source scan). Because nothing is cached across requests, a cache key never needs the Site or version identity, a Draft can never be in a shared cache, and Publish "invalidates" by construction: the next request reads the new pointer. `src/proxy.ts` lets `/api/auth`, `/sites` and `/listings` through without a session; every other route still requires one.

### Draft preview security

The Draft is for people signed in to the business. `/website/preview` and `/website/preview/[...slug]` (and `/marketplace-listing/preview`) call `requireWorkspaceContext()` first (the layout does, and the shared preview route does), read the **signed-in person's own** primary Site's Draft from the workspace snapshot, and draw it with the same renderer as the published Site. A visitor is redirected to Log in; a person from another business sees their own Draft, never another's; an address that names no visible Draft page is "not found". Compatibility: the old `?view=live` links redirect to the published Site at `/sites/<slug>`. The preview's booking journey makes a real booking **as the signed-in owner or admin** through the workspace's authorized action (the preview is inside the workspace); the published Site uses the public path below.

### A visitor's booking: tenant resolution

`submitPublicBookingAction` is the one anonymous Server Action. A request names a **Site (by its public address)**, a **Service (by its slug)**, a time and the visitor's details; it never names an organization, and anything extra in it is dropped when it is parsed. The server: (1) parses and bounds every field (plain text only, a valid email and phone, a key of 8–64 safe characters), (2) **rate limits** by Site and the visitor's address, (3) reads the Site as a visitor would (published only) to get the business's hours, clock and Services, (4) checks the Service is one the business offers for online booking, the time is one of that Service's slots on a day the business is open and not in the past, and the answers are among the Service's options, with the **same rules the workspace uses** (`checkPublicBooking`), and (5) calls `app_public_create_booking`, which **finds the organization from the Site again**, checks the Service belongs to it and is active and bookable online, allocates the business's next number, and writes one booking: `source = 'Website'`, status from the Service's booking method (instant → confirmed, otherwise pending), the booking's **customer**, found or made in the same transaction (§40; the visitor's name, phone and email are the customer's, and the booking keeps the address the visit was requested at). The answer is a reference, a status and whether it was a repeat: **a visitor can read no booking record.** A database error is never shown.

- **Duplicate protection.** A random key per journey (`submission_key`, unique per business) makes a double click or a retry one booking; the same person asking for the same Service at the same time again finds the first booking. Six identical submissions at once make one booking (tested).
- **Rate limit.** 12 requests per 10 minutes per (Site, address), held in this server process (`src/server/rate-limit.ts`). The address is the **right-most** entry of `X-Forwarded-For` (the one the nearest proxy appended); a forged left-hand address evades nothing. One process, no storage outside memory: a second instance has its own windows, which only loosens the limit. It is a blunt instrument against a script, not a fraud system; a shared limiter belongs with the AWS deployment.
- **Refused without a booking:** another business's Service, an unknown, retired, internal or listed-only Service, a private or unknown Site, a closed day, a past date, a time that is not a slot, bad contact details, markup anywhere. Each has a safe message.
- The sample business keeps its fixed day (`fixedClock`), so its bookings are dated around the product's fixed "today", as every other module's are.

### The Marketplace listing

`marketplace_listings` holds **only listing-specific configuration**: `public_slug` (its public identity, unique everywhere), `status` (`draft`, `published`, `hidden`), `description` (1–300 characters), `cover` (one of three CSS treatments, or none: there is no image upload), the five contact-detail switches, the three action switches and `published_at`. `marketplace_listing_services` holds the Services it shows (`sort_order`); **a row exists exactly for a selected Service**. The listing owns no copy of the business's name, phone, email, address or hours, nor of a Service's name, price or duration: they are read when the page is drawn. A listing's "Website" row is the primary Site's platform address; a recorded custom domain does not replace it, and the public listing links to the Site only while it is published.

- **A business has at most one listing, and no listing is the "not set up" state.** Nothing is created until the owner sets one up (`setUpListingAction` creates and publishes it at an address derived from the organization's own, numbered if taken); a new business has none, and `/listings/<its address>` is "not found".
- **Apex's approved listing is Published and shows exactly five of its six Services; Emergency No-Heat / No-Cool Service is not selected** (and a business can select it later: it is public and active). Northstar's listing shows its own two. A selection must be an **active, public** Service of the same business (a trigger and a composite foreign key); a Service retired or made internal later stops being shown without being deleted from the selection.
- **A listing is published once and is then published or hidden, never a draft again** (a trigger); hiding keeps the configuration and the first publication time. Nobody deletes a listing.
- The editor persists (Save, Save & publish, Hide, Publish) through `src/server/actions/marketplace.ts`, validated again on the server (`parseListingConfig`); the editor adopts the configuration the server stored.

### Authorization and tenant isolation

`website:manage` and `marketplace:manage` (`src/lib/policy.ts`) are owner and admin; a member reads and changes nothing (the screens hide what a member cannot do, the server and PostgreSQL still decide). Every Website write goes through one helper whose first step is `authorize("website:manage")`; every Marketplace write through one that authorizes `marketplace:manage`; neither accepts an organization or a Site from the request (source scans hold both). **Row Level Security** is on all seven tables: members of the **active** organization read, owners and admins write what the policies and column grants allow, and every `UPDATE` is by column. **Cross-tenant Site, Version, Page, Section or Marketplace leakage, a Draft reaching a visitor, a Published snapshot changed by a Draft edit, a broken Publish atomicity, an organization chosen by the browser in a public booking, and a Service of another business bookable from a Site are release blockers**; each is tested at the database (as `climvia_app`), through replayed Server Actions and in the pages.

### Custom domains

A Site's custom domains are `site_domains` rows, no longer columns of `sites`: claims with a state machine, a verification token and DNS proof of ownership, activated to be served by Host. See §34.

### Assets and uploaded files

**Done in Phase 18A (§33).** A business's logo is an Asset (a row in `assets`, its bytes in object storage: a local directory in development, a private S3 bucket in production) and its Branding is stored in `organization_branding`. The Site's mark is the logo when the business has one and its initials when it does not, read when the page is drawn, so it needs no Publish and a Template change does not reset it. There is still no image library, no image in a section, no binary column anywhere, and a cover is still one of three CSS treatments.

### What the tests prove

`site-rules.spec.ts` (the pure rules), `website-database.spec.ts` (SQL as `climvia_app` and the owner: templates, reads and writes per business and role, column grants, immutability of a Published version, composite foreign keys, Site identity guards, version/page/section structure, the Marketplace guards, the three public functions called with no session, a visitor's booking at the database), `website-lifecycle.spec.ts` (the operations as the application runs them on a test copy: publish, atomicity, concurrency, make private, more than one Site, template application, a Site's domain claims, the stored website is the approved one), `website-actions.spec.ts` (the Server Actions replayed as a member, as nobody, as another business's owner and with forged arguments, six publishes at once), `website-public.spec.ts` (the public pages, live bindings, the Draft preview, a visitor's booking, a new business, the client bundle), `website-roundtrip.spec.ts` (what the seed wrote is what is read, stable ids, a second seed changes nothing, a test copy restored, the Marketplace operations), plus `website.spec.ts` and `marketplace.spec.ts` (the screens) and the existing server-boundary scans. The Builder's own specs are in §29.

### Where the data meets the screens

The server reads the active business's primary Site (its Draft, and the Published snapshot while it is published) and its listing with the rest of its core data (`getCoreSnapshot`), `WebsiteProvider` and `MarketplaceProvider` hold them, and each change goes to a Server Action which answers with the website **as stored**; only then does the working copy change. The published pages are drawn on the server from the public projection and send the browser only the markup and the booking form.

### What Phase 16 changed, and what is still not built

Phase 16 added the visual Website Builder (§29) on this model and **kept** all of it: the model above, the registry and server-side validation, the Draft/Published lifecycle and its guarantees, the policies and grants, the public functions, the preview's authentication, the rule that text is plain and styling is tokens. It changed three things here: `savePageAction` became `saveDraftAction` (the whole Draft, by key, against a revision), `site_versions` gained `revision` (maintained by triggers, migrations `0014`/`0015`), and `validateContent` gained the page rules the Builder shares with the server (reserved addresses, the Home and Booking pages, the Booking page's list of Services). **Not built, and needing no change to the schema above except where noted:** a Sites screen (choose, add, archive), an image/asset library (**needs object storage and a new assets table**), per-page SEO, a rollback screen, Host → Site routing and custom-domain verification (§20), a delivered contact-form message, email and SMS. A new section type is a new entry in the registry (code) and appears in the Builder with no other change; a richer template is a new migration row. Phase 17 did exactly that: three more Templates, fifteen more variants, the Template Gallery and a confirmed, revision-checked way to put a Template on a Draft (§31).

No Docker image was built or run for Phase 15: the Dockerfile and compose file are unchanged and compatible with its migrations (`0012`, `0013`), which were applied and tested on the PostgreSQL stand-in used for development. **Docker verification was required before AWS deployment (done in Phase 18C1, §35)** (§17). An existing development database needs `npm run db:reset` to pick up the new tables and the seeded websites and listings.

## 29. The visual Website Builder

Phase 16 builds the editor for a Site's Draft: `/website/builder`. It is an editor, not a new architecture. **It edits the Phase 15 model and adds no table, no second copy of a website and no per-person draft.** Its one schema change is a counter on the Draft (`site_versions.revision`, migrations `0014` and `0015`) that makes a stale tab's save impossible. Everything else is browser state, pure functions over the content shape the server already validates, and one new server function that stores that content.

### What a person gets

| Area | What it does |
| --- | --- |
| Pages | Create, rename, change the address, duplicate, reorder, hide and delete pages. The Home page is special (it cannot be deleted, hidden, moved or given another address); the Booking page cannot be deleted or hidden. |
| Sections | Add from the Section library (every registered type and style, by group), duplicate, remove, hide and show, reorder by drag and by keyboard (Move up / Move down), change a section's style (what would be lost is named first), edit its text in the inspector. |
| Theme | Accent colour, corner style, spacing, heading font and body font, shown on the canvas as they change. |
| Preview sizes | Desktop (1024), Tablet (768), Mobile (390): one renderer at three widths, never stored. |
| Save / Discard / Undo / Redo | Edits are local until **Save changes**; **Discard** puts the stored Draft back without a reload; Undo and Redo cover the unsaved work (100 steps). |
| Publish | The same Phase 15 transaction, offered only for a saved Draft, and only for the revision the Builder is showing. |
| Draft preview, View published site | The authenticated, shell-free Draft preview (saved changes only) and, once published, the real public address of the page being edited. |

### The rule: one model

The Builder's working copy is `SiteContent` (`src/lib/site-template.ts`): the theme, the settings (which Services the site shows and in what order) and the pages with their sections, in order. That is the shape of a template (§28), of a Draft read from the database (`contentOf`) and of a Draft being saved. **One validator, `validateContent`, checks it everywhere**: the Builder runs it on every edit to mark fields and keep Save off, the server runs it again on every Save and every Publish, and the migration of a template runs the same code. A page is identified by its `page_key` and a section by its `section_key` within its page; keys are made by the Builder (`page-1`, `hero-copy`, `rich_text-2`), are unique where the database needs them to be, and never change when something is moved, hidden or edited. **No identity from the browser is ever read by the server** (below).

### Route and layout

- `/website/builder?page=<key>`, inside the workspace shell (sidebar and top bar stay; only the page area is full width, `ShellMain`). The page being edited is in the address (`history.replaceState`, no request); an unknown page key is the shell's "not found", a business with no website is sent to `/website`, and the old `/website/pages/<key>` address redirects to the Builder on the same page. The old page editor (`PageEditor`) no longer exists.
- Top bar: back to Website, "Website Builder" and the Site's name, the status badge (**Saving…**, **Unsaved changes**, **Draft saved**, **Published**, **Draft newer than published**), Discard, Save changes, Preview, View published site and Publish. A second row has Undo and Redo, the preview sizes, the panel toggles and the page's address.
- Three regions. Left: the **Pages** panel (with Site theme) and the **Sections** panel (with Add section). Centre: the **canvas**. Right: the **inspector** (a Page, a Section or the Theme, depending on the selection). From 1280px the three sit in a grid (17rem, flexible, 20rem) and the side panels can be hidden to give the canvas more room; below that the same regions stack in the same order. The responsive spec crawls the route at the five audited sizes: no page scrolls sideways.

### State: one working copy, the stored Draft is authoritative

`src/lib/site-builder.ts` is the editing core and knows nothing about React, the database or the screen. Every edit is one pure function over `SiteContent` (`setSectionProp`, `moveSection`, `addSection`, `duplicateSection`, `removeSection`, `changeSectionVariant`, `addPage`, `duplicatePage`, `removePage`, `updatePage`, `movePage`, `setTheme`, `setServiceDisplay`) that returns the next content, or a refusal with a sentence. `builderReducer` holds:

| Field | Meaning |
| --- | --- |
| `saved` | The Draft as last stored. What Discard returns to and what "unsaved" is measured against (`sameContent`). |
| `present` | The working copy the canvas draws and Save sends. |
| `past` / `future` | The undo history (below). |
| `page` / `selection` | The page being edited and what is selected: `none`, `theme`, `page` (by key) or `section` (by page key and section key). A selection is **never a DOM position or a piece of text**; after any edit it is reconciled to something that still exists. |
| `coalesce` / `notice` | Typing in one field is one history step; the last refusal, for the screen to say. |

`BuilderProvider` (`src/components/website/builder/`) wraps the reducer and is the **only** thing the panels talk to (`useBuilder()`): the working copy, the selection, the preview size, which panels are open and the three server calls. There is no second source of truth: the canvas, the section list, the page list and the inspector all read the same `present`, so a selection or an edit made in one is the same in the others.

**Nothing is stored on a keystroke.** Save sends the whole working copy and the revision the Builder opened at; the server answers with the Draft **as stored**, and only then does that become the new baseline (`saved` action: if the person kept typing while the save ran, their newer edits and history are kept). Tested: after typing and a pause, the database holds the old text.

### The Save / Discard lifecycle

| Step | What happens |
| --- | --- |
| Edit | Local only. The status says **Unsaved changes**; Save and Discard turn on; **Preview** and **Publish** turn off (they would show or publish a different state from the screen). |
| Save | `saveDraftAction` → `saveSiteDraft`. Refused on the screen first if `validateContent` finds a problem (the field is marked, Save stays off). History restarts from the stored Draft. |
| Discard | Asks first; puts `saved` back as `present` (no reload, the page and selection fall back to ones that exist), forgets the history. |
| Publish | Needs a saved Draft and a current revision; sends `{ expectedRevision }`. The Website page's own Publish button (no revision) still works. |
| Leave | A link out of the Builder, the business switcher and Log out ask first (`UnsavedGuard`, `components/workspace/unsaved-work`); closing or reloading the tab uses the browser's own prompt. Moving between pages, sections, the theme and the preview sizes never asks: it is the same working copy. |

### `saveSiteDraft`: one transaction, no identities from the browser

`saveSiteDraft(ctx, siteId, { expectedRevision, content })` (`src/db/site-queries.ts`) runs in the caller's tenant transaction, so Row Level Security checks it a second time. It **locks the Site row first** (two saves, or a save and a publish, queue and never interleave), finds the Draft, checks the revision, runs `validateContent`, and then applies the content by **key**:

1. refuses what cannot change (deleting the Home or Booking page, a page changing kind);
2. deletes the pages the content no longer has, with their sections, and the sections a kept page no longer has (a section whose **type** changed is another section: the old row goes, a new one is made);
3. parks the pages whose address changes under temporary addresses, so two pages may swap addresses in one save;
4. updates the columns that changed on kept pages (title, address, visibility, order);
5. inserts new pages with their sections, then updates and inserts the sections of kept pages (only the columns that changed);
6. updates the theme and settings, and answers with the new revision.

Rows are matched by `page_key` and `section_key`, never by an id from the request, and every row it writes carries the **verified** organization and Site: forged ids, organizations and sites inside the content are ignored (tested: the rows made are this business's own, with ids of their own, and Northstar's fingerprint does not move). Saving what is already stored writes nothing and does not move the revision. Any failure rolls the whole save back: no partial saves. `saveDraftAction` finds the Site itself (`findPrimarySite`), authorizes `website:manage` first and accepts no organization or Site (the source scans still hold it).

### Optimistic concurrency

`site_versions.revision` (integer, at least 1) goes up on **every** change to a Draft. It is kept **by triggers, not by the write paths**, so no path, present or future (a template replaced onto a Draft, an import, a plain `UPDATE`) can change a Draft without moving it: a `BEFORE UPDATE` trigger on `site_versions` for the theme, settings and template, and a `SECURITY DEFINER` function run by row triggers on `site_pages` and `site_sections`. The runtime role has no `UPDATE` privilege on the column (tested: `42501`); a Published version never changes, so its counter stays where it was created. The Builder opens at a revision and sends it back:

- **Save** from a copy that is behind is refused whole with one sentence (`STALE_DRAFT`): *This website was changed somewhere else after you opened it, so your changes were not saved. Reload to see the latest version.* Nothing is overwritten. The Builder keeps the person's work on screen (to copy), turns Save and Publish off, shows the sentence in an alert and offers **Reload latest version** (which reloads without the browser's own prompt, because the person chose to give the edits up).
- **Publish** from the Builder names the revision it is showing, so it can never publish a state the person did not look at. Publishing does not change the Draft, so the revision is the same afterwards and the Builder stays current.
- Tested with two tabs, a change made behind the Builder's back, a stale publish, two saves at the same moment (exactly one is stored, every time) and a save racing a publish (the published version is the Draft whole, as it was before or after the save).

### The registry drives the inspector

Nothing about a particular section type is written in a component. `src/lib/site-sections.ts` carries, beside the Phase 15 registry, what the Builder needs: `SECTION_CATEGORIES` and `SECTION_LIBRARY` (the groups and the entries the Section library offers: every registered type and style, and nothing else), a label and description per style, the starter text a new section gets (`defaultPropsFor`, valid by construction and tested for every style), `fieldsOf` / `fieldLabel` (the text a style declares, and what it is called), `connectedOf` (where a connected section's data comes from) and `switchVariantProps` (what a style change keeps, starts and drops). The inspector chooses a control from a field's kind (`FieldControl`: a line, a few lines, an alignment). **A section type or style added to the registry appears in the library and gets its inspector with no other change.**

- **Connected content is read, never retyped.** Business name, phone, email, address and hours are managed in Settings, Services in the Services module; the inspector says so and links there. The Builder has **no field for business information**, and the Services section edits only which Services are shown and in what order, as references by slug (for the whole site, §28), never a name, price or booking method.
- **Plain text only.** The two tokens (`{{business.name}}`, `{{business.location}}`) are stored as typed and filled when a page is drawn. There is no contentEditable anywhere and no HTML or Markdown: text is typed into labelled fields.
- **Starter text is not the template's copy.** A new section's text is generic and is part of the client JavaScript (adding is instant, in the browser); the website's own copy still ships only as data, and a test holds the two apart (a starter text that equalled the template's would fail it).
- **A style change never loses text silently.** Text both styles have is kept; fields only the new style has start with its starter text; fields only the old style had are named in a confirmation before they are dropped, and Undo brings them back before Save.
- The contact form's inspector says plainly that messages sent from it are **not delivered** yet.

### The canvas is the one renderer

The canvas draws the selected page of the working copy with **the renderer the published site and the Draft preview use** (`SiteRenderer`: `SiteHeader`, `SiteSection`, `SiteFooter` and `useSiteView`), fed by `versionOfContent(present)`; there is no second preview renderer. Each piece sits in a themed wrapper (`themeAttributes` + `themeStyle`) so the canvas wears the working theme, and **the site is `inert`**: its links, buttons and the contact form cannot be clicked, focused or submitted, so nothing in it can navigate away, send a message or make a booking (tested: no request, no booking or customer row). The Builder's own marks (the selection ring, a name chip, the toolbar of quick actions) sit over each section and **outside the site's theme**, so they never take the site's accent. The frame has the width of the chosen preview size, scaled down to fit when the area is narrower (marks are counter-scaled to stay readable); the widths live in one place (`preview-modes.ts`) used by the Builder and by the Draft preview's own size switch, and the renderer's layout follows the width of its frame through container queries, so Tablet and Mobile show a real narrower layout. A hidden section shows as a bar saying so; the page's first title section is its only `h1`, wherever it is moved.

### Sections: add, copy, remove, hide, reorder

- A new section is `<type>-<n>` after the selected one, with the style's starter text; a copy is `<key>-copy` (then `-copy-2`) with its own copy of the text; a removal selects the neighbour and says so (*"Hero section removed. Undo brings it back."*); a page holds up to 40 sections.
- A page may not lose what it cannot do without: the **Booking** page must keep a **visible** list of Services (`REQUIRED_SECTION`). Delete and Hide on that section are shown, disabled, with the reason, in the menu, the toolbar and the inspector alike, and the server and `validateContent` refuse it too.
- **Reorder** uses a maintained, accessible library (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`): a drag handle on each row with pointer and keyboard sensors, spoken announcements ("Picked up the Hero section. It is number 1 of 6."), and instructions the handle is described by. The drag context has a **fixed `id`**: without one the library numbers its ids per process, the server and the browser disagree, and the handle's description points at nothing (found and fixed in Phase 16). **Drag is never the only way**: Move up and Move down are in a section's menu, in the toolbar over the selected section and in the inspector, with the reason when a move is not possible. Reordering is a working-copy edit like any other: it persists only on Save, Discard restores it, and Undo steps over it.
- Hiding uses the section's existing `is_visible`.

### Pages

- A new page is a standard page (`type = content`) with one page-heading section, the title `New page`, a key `page-<n>` and an address made from the title that no other page has (`uniqueSlug`: `new-page`, `new-page-2`, never a reserved word). It starts with **no business content** (Apex's or anyone's). A duplicate is a standard page too: a copy of Home or Booking is never a second Home or a second Booking page.
- **Addresses** are made safe as they are typed (`normalizeSlugInput`: lower-case, words joined by single hyphens, no leading hyphen; a trailing hyphen while a word is being typed is dropped when the field is left), so capitals never create a second spelling of an address, and collisions are marked on the page that has them. The home page is the site's root address (`''`) and only the home page. Two pages cannot share an address.
- **Reserved addresses** (`RESERVED_PAGE_SLUGS`): `api`, `admin`, `app`, `assets`, `auth`, `favicon`, `listings`, `login`, `logout`, `marketplace`, `onboarding`, `robots`, `settings`, `signup`, `sitemap`, `sites`, `static`, `website`, `_next`. They are the names the platform and the future domain routing (§20) keep for themselves, so an authored page can never take one; the Builder explains the refusal, and `validateContent` (so the server, on every save and publish) enforces it. A page named with a reserved word is given another address (`settings` → `settings-2`).
- **The page list is the site's menu.** The order of the list is the order of the pages in the site's navigation (the Home page stays first); a hidden page is out of the navigation and, once published, out of the site. There is no second navigation table. Pages hold at most 12.
- Per page, what is structural (`PAGE_RULES`): Home cannot be deleted, hidden, moved or re-addressed; Booking cannot be deleted or hidden but may be re-addressed (its Book buttons follow); Services, About, Contact and new pages are free. A refusal is a sentence on a disabled control, not a silent no-op.

### Theme editing

The Theme inspector edits exactly the tokens of §28 and nothing more: the accent (a colour code in any capitals, or the picker; half a colour is never applied), `radius` (Sharp, Soft, Round), `density` (Compact, Comfortable), and the heading and body fonts from a closed list of three identifiers (`inter`, `system-sans`, `serif`: the application's own self-hosted Inter and the visitor's system stacks; nothing is downloaded and there is no font upload). Every token has a real effect, built from validated values as CSS custom properties on the site's wrapper (`--color-primary`, `--radius-btn`, `--radius-card`, `--site-font-heading`, `--site-font-body`) and `data-site-density`, which a few rules in `globals.css` read. There is no field for CSS, a class, a font address or an image. The theme is part of the working copy: live on the canvas, one step of history, the Draft's until Save, the site's until Publish. A theme belongs to the version, so a Published version keeps the look it was published with.

### History: Undo and Redo

`past` and `future` hold whole previous contents (cheap: edits share structure), **capped at 100 steps** (older ones are dropped, so a long session never holds unbounded copies). Typing in one field is one step (`coalesce` key per field; leaving the field ends the step). **History is for unsaved work**: it restarts after a Save and a Discard, and a new edit ends Redo. Shortcuts: **Ctrl/Cmd+S** saves from anywhere (even a text field); **Ctrl/Cmd+Z**, **Ctrl/Cmd+Shift+Z** and **Ctrl/Cmd+Y** undo and redo unless focus is in a text field (which keeps its own undo). **There is no shortcut that publishes.** Undo and Redo are also buttons.

### Who can use it, and safe switching

Anyone in the business may open the Builder; **only `website:manage` (owner, admin) can change anything**. A member sees a read-only view: every control that changes the Draft is off, selection and the preview sizes still work, and the server refuses their saves and publishes regardless (replayed in a test). The Builder never knows an organization: it reads the one Site the server gave the page. `BuilderProvider` is keyed by the Site's id, so one website's unsaved state can never be carried into another's. Switching business and logging out are page loads that **ask first** when anything is unsaved (the top bar consults `components/workspace/unsaved-work`, which holds only *whether* something is unsaved, never what), and the page that follows is the next business's own. A visitor is sent to log in and sees nothing of the Builder, which is also not reachable under any public address.

### Multi-Site seam

The Builder's internals are Site-aware and its server function takes the Site: `saveSiteDraft(ctx, siteId, …)` and `publishSite(ctx, siteId, …)` work on any Site of the verified organization (the database specs save two Sites of one business independently, with independent revisions). The Server Actions today address the **primary** Site only, and the Builder opens the primary Site's Draft, because no Sites screen exists. When one is built it chooses a Site from the verified organization's own list, the action re-verifies that the Site belongs to it (never trusting an id from the browser on its own), and the same Builder opens that Site's Draft; no schema change is needed.

### The Phase 17 template seam

This is the seam Phase 17 used, as designed. Templates stay as Phase 15 built them (`createDraftFromTemplate`, `replaceDraftWithTemplate({ confirmReplace })`, and a template with the same shape as the Builder's working copy, `TemplateDefinition = SiteContent & { schema }`); the Builder itself did not change except for two things: the bar names the Template the Draft is based on and links to the Template Gallery (**Change template**), and the Theme panel has a **Design style** control (the one new theme token, optional and backward compatible). Choosing a Template is a Server Action (`applyTemplateAction`) that replaces the Draft in one transaction against the revision the Gallery was opened at; it **moves the Draft's revision** (the triggers), the Builder opens fresh on the new Draft (its Undo history starts empty), and a Builder open in another tab at that moment is correctly stale and must reload. Four Templates, the Gallery, the preview, the confirmation, the safety rules and the tests are in §31. **Not built:** a Template marketplace or tenant-editable Templates.

### Accessibility

Every control has a name; the page and section lists mark the current item (`aria-current`) and the canvas marks the selection (`aria-pressed`); menus are real menus (opened from the keyboard, arrow keys, Home and End, Enter, Escape returns focus to the button) and disabled entries stay in them with their reason; dialogs are native `<dialog>` modals that keep focus inside, close on Escape and give focus back; drag has the keyboard alternative above and spoken feedback; focus is visible; the status, toasts and the stale alert are announced; the canvas contributes nothing to the tab order (it is inert). The Builder is part of the workspace's accessibility and responsive crawls, and has its own states checked (a section, a page, the theme, an invalid value, the library dialog, an open menu, a member's read-only view).

### Tests

| Spec | Proves |
| --- | --- |
| `website-builder-rules.spec.ts` | The editing core as pure functions: every edit, every refusal and its sentence, the library entries, style changes across every pair of styles, page rules and reserved addresses, the theme tokens, problem keys, the reducer (history cap, coalescing, Save and Discard, selection). |
| `website-builder-db.spec.ts` | `saveSiteDraft` on PostgreSQL: the whole content in order, only changed rows written, identity by key, the revision (every write path, the triggers, the missing privilege), stale refusal, two saves and a save racing a publish, forged ids and other businesses' Sites, every content refusal leaving the Draft and revision untouched, a site at the page and section limits, thirty sections, two Sites. |
| `website-builder.spec.ts` | In the browser: opening (Apex, Northstar, a new business, a read-only member), selection in sync, the inspector following the registry, connected content, edit / Save / reload / Discard, invalid values, add, copy, remove with Undo, locks, hide, style change, reorder by menu, by drag and by keyboard, a page of thirty sections. |
| `website-builder-pages.spec.ts` | Pages (add, structural pages, hide, delete and undo, order = menu, address rules), the theme, Undo / Redo and the shortcuts (no Publish shortcut), Publish, the Draft preview and View published site, the three preview sizes, the Builder at every audited size. |
| `website-builder-safety.spec.ts` | Stale tabs (save, publish, a change made elsewhere, a failed save), leaving with unsaved work (links, the business switcher, Log out, the tab), the canvas is a picture (inert, no requests, no booking), a visitor and odd page names, the Draft is never public, accessibility in each state, Tab order, menus, dialogs, keyboard reordering. |
| `website-actions.spec.ts` | `saveDraftAction` and `publishWebsiteAction` replayed as a member, as nobody, as another business's owner, with forged and malformed arguments, with a revision that is behind, six publishes at once, two saves at once. |

The existing Website specs keep their guarantees (the public pages, the Draft preview, publishing, the database rules); only where the old page editor was the thing under test did they move to the Builder.

### Limitations and what is deliberately deferred

- No custom HTML, CSS or JavaScript, no freeform canvas, no image or media library (the business logo is stored since Phase 18A, §33).
- No Sites screen, no rollback screen (the versions are kept; a rollback is a pointer change not yet exposed).
- Custom domains are claimed, verified by DNS and served by Host (§34); no Route 53, DNS writes or certificates (Phase 18C), no contact-form delivery, email or SMS, no scheduled Marketing worker, no billing, no analytics in the Builder.
- No real-time collaboration: two people editing at once is handled by the revision (the second to save is told to reload), not by merging.
- A page holds at most 40 sections and a site at most 12 pages; the working copy is the whole Draft in browser memory (tested at the limits).
- The canvas scales the 1024 / 768 / 390 frame by `transform` to fit the area; it is a viewport simulation, not a device emulator.
- No Docker image was built or run for this phase: the Dockerfile and compose file are unchanged and compatible with the new migrations (`0014`, `0015`), which were applied and tested on the PostgreSQL stand-in used for development. **Docker verification was required before AWS deployment (done in Phase 18C1, §35)** (§17). An existing development database needs `npm run db:reset` to pick up the revision column and its triggers.

## 30. Route groups and the provider boundary

The workspace's private state (the verified person, the workspaces they belong to, the active business's settings, and its core data: customers, jobs, bookings, financials, analytics, the team, the Website's Draft and Published snapshot, the Marketplace listing) is read on the server and handed to the browser by **one server component, `WorkspaceProviders`** (`src/server/workspace-providers.tsx`). Which routes mount it is a decision of the route tree, made once and held by tests. (Phase 16 first shipped with these providers in the root layout, which meant a signed-in member opening a *public* page was also sent their own workspace, Draft included. This section is the correction. Anonymous visitors were never affected and no business's data ever reached another's.)

### The tree

| Group (URL not affected) | Serves | Mounts |
| --- | --- | --- |
| `app/layout.tsx` (root) | the document, the self-hosted font, global CSS | **nothing**: it reads no session, no workspace and no data |
| `(signed-in)` | the two groups below | `WorkspaceProviders` (it verifies the person and the workspace first) |
| `(signed-in)/(workspace)` | every module, the Builder, Settings, Help | `AppShell` |
| `(signed-in)/(preview)` | the signed-in Draft previews: `/website/preview…`, `/marketplace-listing/preview` | no shell |
| `(public)` | the published Sites (`/sites/<address>…`) and Marketplace listings (`/listings/<address>`) | **nothing**: no providers, no shell, no session |
| `(auth)` | Log in, Sign up, set-up | nothing (they read the session only to send a signed-in person on) |
| `(platform-admin)` | Climvia's own console, `/platform-admin…` (§36) | nothing of the workspace: its own layout; the database says whether the person is a platform administrator |
| `(unmatched)` | an address that matches no route | its own "not found", which draws the shell and providers only for a verified member |

`WorkspaceProviders` verifies the caller first (`requireWorkspaceContext()`: a redirect to Log in or to set one up), then reads the workspace data, then mounts `AppProviders` keyed by the business, so one business's state can never be carried in front of another's. The workspace and the Draft previews are siblings under the one `(signed-in)` layout on purpose: moving between a module and a preview keeps the same providers mounted, which matters while Branding (the accent, the logo) exists only in them, until object storage makes it durable.

### The public route rule

A request to a public route resolves **only** the public projection (`app_public_site` / `app_public_listing`, §28): it does not read the session, the membership, the workspace, any tenant table or the Draft, **whoever is asking**. A signed-in member, a member of another business and someone in several businesses are served exactly what a visitor is; they are not redirected into the workspace. Signed-in status adds nothing to the page, its payload or its JavaScript.

One Next.js behaviour made this subtle and is worth knowing: **a layout's `not-found.tsx` is part of the page tree sent with every response under that layout**, even when it is never shown. The previous root `not-found.tsx` resolved the workspace to draw the shell for a signed-in member, so it ran on every request, public ones included, and put the workspace in their payload. So now: the root's `not-found.tsx` is plain and static; `(public)/not-found.tsx` is plain (one "not found" for a private, unknown or hidden Site, a page that does not exist and an address that names nothing, for a visitor and a member alike); `(signed-in)/(workspace)/not-found.tsx` and `(signed-in)/(preview)/not-found.tsx` draw the shell inside the providers the `(signed-in)` layout already mounted; and the only not-found that reads the workspace is `(unmatched)/not-found.tsx`, scoped to a catch-all page that exists for no other reason. Four small pages (`/sites`, `/listings`, `/listings/<address>/<anything>` and that catch-all) exist only to say "not found" in the right place.

### What stays private

- **Draft preview** (`/website/preview…`, `/marketplace-listing/preview`) is the business's own: a visitor is sent to Log in, a member sees their own Draft (never another business's), and the page is outside the public group. It shares the workspace's providers because it reads the workspace's Draft.
- **The Builder** (`/website/builder`) is in `(signed-in)/(workspace)` with every provider, its authorization (`website:manage` to write), its revision protection and the business switcher's guard unchanged.
- **Switching business and logging out** are still full page loads; the providers are rebuilt from the new business.

### Proof

- `provider-boundary.spec.ts` builds the import graph from each entry point and holds it: the root layout (and its not-found) import nothing of the application; nothing a public page imports, however deep, is a provider, the session, the workspace, a tenant transaction, another business's queries or the shell, and the only database modules it reaches are the connection, the table definitions and the public functions' own queries; Log in, Sign up and set-up reach no provider or shell; `WorkspaceProviders` is used by exactly the `(signed-in)` layout (the workspace and the previews) and the unmatched not-found; only the unmatched not-found reads the workspace.
- `public-boundary.spec.ts`, on the normal server: for a visitor and for each kind of member (an Apex owner, an Apex member, a Northstar owner, a person in both) every public page, its booking page, both listings and every not found are **byte for byte the same response**, with no Draft-only copy, no person, organization, customer, team or financial data and no workspace provider in the JavaScript they load; Northstar's owner opening Apex's pages and Apex's owner opening Northstar's get only the public projection; the Draft preview still needs a membership and shows a member only their own Draft.
- The same spec starts a **second server whose database role can do exactly one thing: run the three public functions** (it cannot select from a single table; the owner credential is not in its environment). Every public page still serves, for a visitor and for each member, identical to the normal server, so a public request provably asks the database nothing but those functions. The same server cannot serve a workspace page, a preview or the Builder, which shows the role is really restricted.

### What this does not change

Caching (there is none, §28), the public booking path and its rate limit, the Marketplace's public function, Row Level Security, and what each route's page verifies for itself. `/sites` and `/listings` addresses that name nothing are "not found"; an address that matches no route is "not found" inside the shell for a signed-in member and a plain page (after the sign-in redirect for a visitor) otherwise.

## 31. Website Templates

Phase 17 turned the one starter Template into four, and added the Gallery that previews them and the confirmed, safe way to put one on a Draft. It **extends** §28 and §29 and changes none of their guarantees: Sites, Site Versions, Pages, Sections, the Draft / Published lifecycle, the public functions, the revision rule and the provider boundary (§30) are as they were.

### What a Template is, and who owns it

A Template is **application-owned product content**: a row of `site_templates` whose `definition` is validated JSON (`validateTemplateDefinition`, schema `1`) that chooses registered section types and variants and gives them neutral text and a theme. It holds no component name, markup, style or script. The table has **no organization column**; the runtime role can read an active row and nothing else (no insert, update or delete: a test proves each refusal), so a business can neither create nor edit a Template. A business can only **apply** one to its own Draft.

`src/db/site-templates.ts` is the one list of them, in the order the Gallery shows them (never the database's insertion order): `climvia-starter`, `precision`, `comfort`, `airflow`. Each entry carries the key, display name, category (`hvac`), description, a style label and at most two tags (display only) and the definition (`default-template.ts` for the starter, `templates/<key>.ts` for the others). The rows are written by migration `0016_site_template_catalog.sql`, which is generated from those definitions (`npx tsx scripts/db/template-sql.ts precision comfort airflow`) and is **data only: no schema changes** (`drizzle-kit generate` reports "No schema changes"). It adds three rows with `ON CONFLICT (key) DO NOTHING`, so running it again changes nothing, and it changes the starter's display name from "Climvia starter" to "Climvia Starter" and nothing else. `e2e/website-templates.spec.ts` fails if a stored row and its definition differ in any word. Adding Templates did **not** touch any existing website: every Site still has the starter selected, and the standing Apex and Northstar Drafts and Published versions are what they were seeded as (a test reads them before and after).

### The four Templates

| Key | Name | Character | Home page, in order | Theme |
| --- | --- | --- | --- | --- |
| `climvia-starter` | Climvia Starter | Balanced, neutral: the baseline every new business starts from (unchanged) | brand-colour hero, service cards, three points with icons, hours card, contact card, closing banner | Climvia teal, medium corners, comfortable, Inter, no design style |
| `precision` | Precision | Structured and confident: bounded layout, sharp detail, a contact strip | **split opening** (headline beside a phone-and-hours panel), **trust strip**, ruled **service grid**, contact and hours side by side, **closing band** with a booking button and the phone number | blue `#1E40AF`, sharp corners, compact, Inter, look `precision` |
| `comfort` | Comfort | Warm and approachable: soft spacing, friendly type, rounded panels | **welcoming opening** (booking button and a way to call), **reassurance panel**, **friendly service cards** (icon, full description, booking button), a seasonal-maintenance prompt, a "we are here to help" block, **closing panel** | burnt orange `#9A3412`, round corners, comfortable, serif headings, look `comfort` |
| `airflow` | Airflow | Editorial and spacious: large type, plenty of white space, little chrome | **editorial opening** (very large headline, introduction beside it, two quiet links), index-style **service rows**, three **numbered steps**, contact and hours, **closing statement** | graphite `#27272A`, medium corners with pill buttons, comfortable, Inter, look `airflow` |

All four have the same five pages (Home, Services, About, Contact, Booking, with the standard keys and addresses) and each page is composed on purpose, not only the Home page: the Services page uses that Template's service presentation; the Contact page leads with a split card (Precision), a "talk to us" block (Comfort) or the hours (Airflow); the Booking page ends with contact and hours (Precision), "before you book" reassurance (Comfort) or "what happens next" steps (Airflow). `e2e/website-templates.spec.ts` holds this in structure, not in pixels: every pair of Templates must open its Home page with at least four different sections, use a different service presentation and a different closing call to action, compose at least four of the five pages differently and share less than half of the section variants they use, so four identical layouts with four different accents cannot pass. The copy is reusable HVAC starter copy that makes **no claim about a business** (no years, awards, certifications, ratings, reviews, guarantees, financing or customer counts, and nothing that says a contact message is delivered or answered); the business's name and place are the two text tokens, its phone, email, address and hours are read from its record when a page is drawn, and its Services come from its catalog (a Service section has no property for a name, price or duration). **No Template contains any organization's data**, checked against the seed data of both standing businesses.

### The registry additions: variants, not new section types

The Section registry still has **ten** section types. Phase 17 added **fifteen variants** (the Section library goes from 16 entries to 31), each with validation, a renderer, Builder metadata (a human name and description, a group, starter text), accessibility behaviour and tests: **hero** `split`, `welcome`, `editorial`; **service_list** `grid`, `friendly`, `rows` and a `-catalog` partner of each (a presentation comes twice, with a heading of its own for a shortlist and without for a full list under a page's introduction, so a page keeps one heading outline); **feature_list** `strip`, `numbered`, `reassure`; **call_to_action** `band`, `panel`, `editorial`. Their Builder names are plain ("Opening with contact panel", "Service grid (full list)", "Trust strip", "Closing statement"), never the identifiers. They are in the Section library, so a business can add any of them to any page after applying any Template. Nothing was added speculatively: every variant is used by a Template.

### The design style: one optional theme token

A different set of sections is not enough to make a website look like a different design: the header, the footer, the width of the content, the rhythm of the sections and how headings and cards are drawn belong to the whole site, and a section a business adds later must match the Template it chose. So the theme gained **one** structured token, `look`: one of `standard`, `precision`, `comfort`, `airflow`. It is an identifier the application maps to class strings written in code (`src/components/website/site-look.ts`), validated like every other token, shown in the Builder's Theme panel as **Design style**, and **never CSS**: nothing a customer types becomes a class. It is **optional and backward compatible**: a theme without it is the standard style, `validateTheme` keeps it off the result when the input did not have it (so every stored theme round-trips byte for byte, and `saveSiteDraft` still writes nothing when nothing changed), the database check on a theme still only requires `schema = 1` (so no migration), and the theme schema number stays `1`. One consequence to know: an application version from before this phase refuses a theme that carries a `look` and draws the default theme instead, so a Draft that used a Template must not be read by the old application (a rollback of the application is a rollback of this data too). The standard style is **exactly** what the renderer drew before; the header and footer are drawn per style (`SiteChrome.tsx`), still from the live business record and the visible pages, never copied.

The renderer is still one engine: `SiteRenderer` draws the Draft in the Builder's canvas, the signed-in preview, the Overview's picture, the published site and the Template previews. It was split into `site-primitives.tsx` (the parts every section is made of), `SiteServices.tsx` and `SiteVariants.tsx` (the new structures), `SiteChrome.tsx` (header and footer), `site-look.ts` (the style tokens) and `SiteRenderer.tsx` (the switch over type and variant). There is no parallel Template renderer.

### The Gallery and the preview

`/website/templates` (the Gallery) and `/website/templates/<key>` (one Template in full) are workspace pages under `(signed-in)/(workspace)`: they need a verified workspace and are never part of a public route, so the provider boundary of §30 is untouched. The Builder's bar says **Based on: Comfort** (the Template the Draft started from; it does not claim the Draft still matches it, and the Gallery says so) with a **Change template** link (**View templates** for a member who may only look). The link is on the bar's second row on purpose: the first row's height must not change with what the Draft says, or the panels under it move (an early version wrapped the first row and made an open menu close).

The server loads the Templates through the caller's own tenant transaction (`listActiveTemplates`: active, each validated again, a row that does not validate is left out and logged, ordered by the application's list) and hands the Gallery plain props. The Template definitions therefore reach a browser **as data the Gallery draws, never as a constant in the JavaScript**; they are application product content and may be in that response, unlike any tenant's seed data, which is in no bundle. Each card is a live miniature drawn by the real renderer (the header and the first three sections of the Home page, scaled, inert), so the four are distinguishable before anything is opened; a preview shows every page at the same Desktop, Tablet and Mobile widths as the Builder, scaled to fit. Everything in a preview is **inert** (nothing can be clicked, focused or read out; the figure has a text label) and **writes nothing**. A preview is drawn with the **demonstration business** in `src/data/template-demo.ts` (a made-up name, a phone number in the range reserved for fiction, "Anytown, ST", `example.com` and six Services), never from the signed-in business or any other, so no Customer, Job, Financial record, Draft or other private data is read for it; this is checked.

### Choosing a Template

Gallery or preview → **Use this template** → a confirmation → the Draft is replaced → the Builder opens on it. Clicking a card replaces nothing. The confirmation says that the Draft's pages, sections and theme are replaced (and its own changes to them lost), that the published website does not change and visitors keep seeing it until the new Draft is published (or that nothing changes for visitors when the website is not published), that earlier published versions are kept, and that the business's details, hours and Services stay as they are. Cancelling it (the button, Escape), closing a preview and leaving the Gallery change nothing, in the Draft, its revision or any row.

**Unsaved work is never lost silently.** The Gallery is a different page, reached by a link, so the Builder's existing unsaved-changes guard (§29) asks first: Keep editing stays with the work, Discard leaves it and stores nothing, and saving first keeps it. There is no Template-specific discard path.

**`applyTemplateAction`** is a Server Action like the others (`mutate`: it resolves the caller and their active organization from the session and a verified membership, requires `website:manage`, and only then reads the arguments). It takes `{ templateKey, expectedRevision, confirmReplace: true }`; nothing names an organization or a Site, and a forged `siteId` or `organizationId` in the request is ignored. It calls `replaceDraftWithTemplate`, extended in this phase and still the one mechanism, in **one transaction**: lock the Site row (`FOR UPDATE`), find the Draft, **check the revision** (the Draft is no longer the one the person looked at: refused whole with the same sentence a stale save gets), load and validate the Template (unknown, inactive, invalid or a schema this application does not read: refused before anything is deleted), delete the Draft's pages and sections, set its theme and Template, insert the Template's pages and sections, record the Site's selected Template. The revision moves (the triggers). Nothing is partly replaced, and a Published version is never touched (PostgreSQL also refuses to write one): **the published website is byte for byte what it was until the Draft is published**, and publishing then goes through the unchanged `publishSite`. Two replacements at once: one wins and the other is refused as behind.

**What is kept.** Which Services the website shows, hides and in what order (`settings.serviceDisplay`) is the business's choice about its catalog, not part of a design, so it **survives** a change of Template: a Service the business hid does not reappear on the website because the design changed. (`createDraftFromTemplate` still starts a new Draft with the Template's, which are empty.)

**History.** Applying a Template is an explicit, saved replacement of the Draft, not an edit: the Builder opens fresh on the new Draft, so its Undo history starts empty and nothing offers to take the replacement back. The earlier **published** versions are all kept, which is the way back to a design (publishing them again is the future rollback screen, §28), and a business can always apply the Template it had.

**New businesses and existing ones.** Onboarding still creates the Draft from `climvia-starter`; a new business can then choose any Template from the Builder, with nothing of any other business in it. An existing business is never moved to a new Template by a migration or a seed: it happens only when its owner or admin chooses it. A member who may only look can browse every preview; the controls that would replace the Draft are off and the server refuses the request regardless.

**Tenancy and Sites.** `replaceDraftWithTemplate` takes the Site: it works on any Site of the verified organization (two Sites of one business are replaced independently; a Site of another business is indistinguishable from one that does not exist). The action addresses the primary Site today, like every Website action, because no Sites screen exists; when one does, it chooses a Site from the verified organization's own list and the function does not change.

### What this does not change, and what is not built

Unchanged and re-tested: the public Site and booking security, the Marketplace (independent of Templates), public routes carrying no workspace providers, the Builder's every function, the revision rule, publishing. **Not built, by design:** durable logo and image upload (object storage is required, §17: the Templates use the structured theme tokens and the existing session-only branding), custom domains and DNS (§20), a delivered contact-form message, a Template marketplace or tenant-editable Templates, a Draft rollback screen, collaborative editing. **Docker verification was required before AWS deployment (done in Phase 18C1, §35)** (§17); no Docker image was built or run for this phase.

### Proof

| Spec | Proves |
| --- | --- |
| `website-templates.spec.ts` | The four definitions (valid, five standard pages, within the limits, only registered variants and the properties each declares, no markup or code), no tenant data and no claim about a business, the structural difference between every pair, the registry additions and the library's names, the design-style token (optional, backward compatible, validated, an identifier only), and the stored rows: equal to the definitions, no organization column, the migration is data only and idempotent, existing sites untouched, the runtime role can read and change nothing. |
| `website-templates-ui.spec.ts` | The Gallery (four cards, fixed order, current Template marked, pictures, accessible names), the preview (every page and width, no overflow, writes nothing, the demonstration business only), the confirmation and every way of cancelling, applying each Template (Draft replaced, Published byte-identical until Publish, Publish then moves visitors, the earlier version kept), switching, unsaved work, a stale tab, a member who may only look, a new business. |
| `website-templates-actions.spec.ts` | The revision check, what is kept and replaced, every Template applied then published, two Sites, another business's Site, unknown / inactive / invalid Templates (in a rolled-back transaction), the confirmation, the Server Action replayed as nobody, as a member who may only look, as the owner with forged arguments and as another business's owner, and two at once. |
| `website-templates-render.spec.ts` | Each Template as a visitor gets it, on every page at Desktop, Tablet and Mobile width: one level-1 heading, the landmarks, no horizontal overflow, named controls, the workspace's contrast standard, a navigation that fits a phone, a visible keyboard focus and a link to every Service; and the Builder working on each Template (edit, add, copy, restyle, remove, add a page, change the theme and design style, Undo, Save, Publish). |

Existing specs that pinned "one Template" (the database, lifecycle and round-trip specs) now count four; the server-boundary spec lists the new action; the route inventory fills the new dynamic route; nothing was removed.

## 32. Where a business's sample data may live

Apex Climate Heating & Air and Northstar Heating & Cooling are seeded businesses. Before this correction the Apex business record (name, phone, email,
address, hours, the signed-in person, the time zone) sat in `src/data/fixtures.ts` beside two generic helpers, and client code imported the helpers, so the whole
module, Apex's name and phone included, was bundled into the JavaScript every visitor and every signed-in person downloads. `src/data/settings.ts` imported the
same record to build a baseline (`initialSettings`) that only the server and the tests used. Nothing was leaking between businesses, but a business's values were
reachable from client code, and "reachable from client code" is the property that has to be false before anything else is built on the platform.

### The four kinds of data, and where each lives

| Kind | What it is | Where it lives | May it reach a browser? |
| --- | --- | --- | --- |
| Application-owned constants | Lists every business shares (time zones, date and time formats, accent swatches, the Section registry, the four Templates), pure helpers (`formatCityStateZip` in `lib/format.ts`), the sample workspace's pinned clock (`lib/prototype-clock.ts`) | `src/` | Yes, except the clock: a browser is given the clock to use by the workspace (`useClock()`) |
| Seed definitions | The Apex and Northstar organization records, hours, people and every canonical Apex record | `scripts/db/seed-lib.ts`, `scripts/db/seed-data/*` (Apex's business record is `apex.ts`, beside `northstar.ts`) | Never. Nothing under `src/` imports them |
| Test fixtures | The expected values and the helpers that read them | `e2e/*` (`apex-data.ts`, `tenant-values.ts`) | Never |
| Runtime tenant data | A business's name, phone, email, address, hours, Services, people, records | PostgreSQL rows, read on the server (`src/server/workspace.ts` for the signed-in business, `src/db/public-queries.ts` for a visitor) and handed to the browser as the page's data | Yes: its own, and only its own |

The one server-side stand-in is the sample workspace's reference crest (`src/server/sample-workspace.ts`, marked `server-only`): Branding is not stored yet, so the sample
business shows it and every other business starts plain. It goes away when logos are stored.

Why the seed modules are not marked `server-only`: the seed and the tests run them under Node, where the marker throws (the same reason `src/db/*-queries.ts` says "no
`server-only` import on purpose"). They are held by location and by the import-graph test instead. `server-only` is used where only the server runs the module.

### What changed

`src/data/fixtures.ts` is gone. `business`, `currentUser`, `businessHoursByWeekday` and `BUSINESS_TIME_ZONE` moved, unchanged, to `scripts/db/seed-data/apex.ts`, together with
`apexSettings` (the Settings baseline the old `initialSettings` was, now a test baseline built from them). `formatCityStateZip` moved to `lib/format.ts` and the pinned
clock to `lib/prototype-clock.ts`. `getSlotGroup` no longer defaults to Apex's hours or the pinned date: its callers (the booking modals, the public booking journey and
the public-booking rules) already passed the business's own, and now cannot forget to. The two Team components that defaulted a date to the pinned day read the workspace
clock, which is the same date for the sample business and the real one for every other. The phone-number example in the Settings validation message is a made-up number.

### How it is held

| Rule | Held by |
| --- | --- |
| No Client Component reaches a seed, test or server module, or the pinned clock, through any chain of imports (the walk stops at Server Actions, which a browser calls but never bundles) | `tenant-fixture-boundary.spec.ts` (import graph, with controls that prove the walker resolves the edges it is meant to see) |
| No file under `src/` imports anything under `scripts/` or `e2e/` | the same |
| No business's name, phone, email, street, person or Northstar value is written into any file under `src/` (comments excluded) | the same (the values are read from the seed, never retyped) |
| The client JavaScript the production build emits contains none of them, nor the sample role or crest | the same: it reads `.next/static` after the build, so it sees what a copied string or an import nobody foresaw would put there |
| Apex's, Northstar's and a just-created business's pages, and every script those pages load, carry the right business and no other; a visitor's Site likewise | `tenant-fixture-runtime.spec.ts` |

Both parts were shown to fail: a client-reachable import of the Apex record fails the three graph and source checks, and a client use of its values fails the bundle check, naming the files and values.

### What this does not change, and what remains

The database, the migrations, the seed's behaviour (Apex and Northstar seed exactly as before) and the canonical Apex data are unchanged; the Phase 16 provider split and the
public projection are unchanged and re-tested. **Remains:** `SAMPLE_DATA_SET` (`"apex-demo"`, in `lib/workspace-types.ts`) is the name of the sample data set, an application
identifier stored on the organization row, not business data, and it is still in client code. `America/Chicago` is one entry in the shared list of time zones a business can choose.
The crest stand-in above is temporary.

## 33. Durable assets and Organization Branding (Phase 18A)

Until this phase a business's logo existed only in the browser that chose it: an object URL that died with the session, so no public page ever drew it. Phase 18A gives a business **files that are its own and last** (today, its logo) and a **Branding** that is stored like the rest of Settings. It is the first production-infrastructure subsystem, and it is built so later Website media can use the same foundation, without a media library being built now.

### Ownership

```
Organization -> many Assets        (a file a business owns; metadata in PostgreSQL, bytes in object storage)
Organization -> one Branding       (organization_branding: its logo and its accent)
Site Version -> its own Theme      (unchanged: design tokens, the Template's `look`, per Site)
```

**Organization Branding** is the business's central identity: its logo and its accent. **A Site's Theme** is that Site's presentation: its accent token, radius, density, fonts and design style. They coexist and neither is copied into the other.

| | Organization Branding | Site Theme |
| --- | --- | --- |
| Owns | the logo (an Asset), the central brand accent | the Site Version's design tokens, including the Template's `look` and the Theme accent |
| One per | organization | Site Version (two Sites of one business can differ) |
| Changed in | Settings → Branding | the Builder's Theme panel, or a Template |
| Needs Publish | **No.** It is read when a page is drawn | **Yes.** It is part of the Draft |
| Reset by choosing a Template | **Never** | replaced with the Template's |

Propagation, stated plainly. The **logo** is drawn wherever a design shows the business's mark: the header of the Standard, Precision and Comfort Templates (in place of the initials tile), a small mark before the Airflow wordmark when there is a logo (and nothing when there is not), the Marketplace listing's mark, the Builder's canvas, the signed-in preview and the Overview's picture. The **central accent** is stored now and is the base colour of the customer-facing frames inside the workspace (the Website picture, the Builder canvas, the previews, the listing preview); a Site's own Theme accent is drawn over it and is never replaced by it, and the published pages draw the Site's Theme only. Whether the central accent should reach the published pages is a design decision that is not made here.

A logo change is therefore a **live identity change**: it shows on the published Site and the listing at once, with no Publish, and leaves the Draft, the Published version and the Template exactly as they were. Authored content (pages, sections, text, Theme) still needs Publish.

### The data

Migrations `0017` (tables) and `0018` (Row Level Security, grants, guards, the public function), applied from nothing by `db:migrate` / `db:test:prepare`; `drizzle-kit generate` reports no schema changes after them.

| Table | Holds |
| --- | --- |
| `assets` | `id`, `organization_id`, `purpose` (`logo`), `storage_driver` (`local`/`s3`), `storage_key`, `original_filename`, `media_type` (`image/webp`, `image/png`, `image/jpeg`), `byte_size`, `width`, `height`, `checksum` (SHA-256), `status`, `created_by_user_id`, `created_at`, `ready_at`, `deleted_at`. **No bytes, no data URL, no encoded image: there is no column for one.** |
| `organization_branding` | `organization_id` (primary key: one row per business), `logo_asset_id`, `accent`, `created_at`, `updated_at`. Created the first time a business saves its Branding; no row means no logo and no accent |

Integrity the database enforces, independently of the application:

- **The key is the row's own.** A CHECK makes `storage_key` equal `organizations/<organization_id>/assets/<id>/normalized`, so a key cannot point into another business's folder, another Asset's, or anywhere a filename could take it. The key is also unique.
- **Lifecycle** `pending -> ready | failed`, `ready | failed -> deleted`; a trigger refuses any other move, and (for the runtime role) any change to an Asset's identity or content. The runtime role can only `UPDATE (status, ready_at, deleted_at)`. A new Asset can only be inserted as `pending`, by an owner or admin, as themselves. **Nobody can DELETE a row** (no grant, no policy): history stays.
- **Branding can only reference its own Asset.** The composite foreign key `(organization_id, logo_asset_id) -> assets (organization_id, id)` makes another business's Asset impossible (PostgreSQL's referential checks run outside Row Level Security), and a guard trigger additionally requires it to be a **ready logo**. The foreign key is proven on its own with the guard switched off. An Asset that is a business's current logo cannot be marked deleted.
- **Row Level Security** on both tables, from the same helpers as every other table: members of the active organization read; owners and admins write. With no context at all the runtime role sees no private row.
- The old `organizations.logo_url` and `organizations.brand_accent` columns are **dropped** (nothing wrote them; any stored accent moved to `organization_branding`). A URL on the organization row would go stale and could point at someone else's file.

### Storage

`src/storage` is the seam. Business code calls `put`, `get`, `exists` and `delete` on an `AssetStorage` and never knows which driver it has. **Only `src/storage/s3.ts` imports the AWS SDK**, and no Client Component can reach this directory (the import-graph spec holds that).

| Setting | Meaning |
| --- | --- |
| `ASSET_STORAGE_DRIVER` | `local` or `s3`: where **new** uploads go. Outside production the default is `local`, so development, the seed and the tests need no AWS account. **In production it must be set**; there is no silent default |
| `ASSET_LOCAL_DIR` | the local driver's directory (default `.data/assets`, git-ignored, never under `public/`, never served by path) |
| `AWS_REGION`, `AWS_S3_BUCKET` | the S3 driver |
| (credentials) | **none in configuration**: the AWS default provider chain, which in production is an IAM role on the instance |

An Asset records the driver it was stored with, and it is read back through that driver, so changing where new uploads go does not strand old ones, and the database never holds a bucket address (a public address is derived: `/assets/<id>`, built in one place, `assetUrl`). That permits a different bucket, a CDN or image variants later without rewriting any Site.

**Keys** are built only by `assetKey(organizationId, assetId, variant)` from two lower-case UUIDs and a fixed variant, and parsed strictly by `parseAssetKey`; both drivers refuse anything else before touching a disk or a network. A browser filename is never part of a key, a path or a header; it is kept only as a display label, cleaned of paths, markup and control characters.

**Local driver.** Files are written to a temporary name and renamed (a reader never sees half a file), once only (an existing key is refused), under `<root>/<organization id>/<asset id>/normalized`, with the resolved path checked to be inside the root. Durable across a restart of the application.

**S3 driver.** A **private** bucket. It sets no ACL and no `public-read`, never lists, never creates a bucket, writes with `If-None-Match: *` (an object is never replaced under its id), reads only the keys the application generates, and takes the bucket and region from configuration, never from a request. The SDK loads on first use. Real S3 has **not** been exercised from the development machine: the driver is tested against a fake client (what it sends, how it reads, how it fails), and the bucket, its encryption, its public-access block and the role's policy are infrastructure for the deployment phase.

### The upload

`POST /api/branding` (multipart: `accent` required, `logo` or `removeLogo` optional; no field names an organization). The order is the defence:

1. the request must come from this site's own pages (`Origin` equal to the request's own `Host`, the configured public origin or a listed trusted origin, and `Sec-Fetch-Site` same-origin where sent; `Forwarded` and `X-Forwarded-Host` are **not** consulted, §35), because a Route Handler, unlike a Server Action, gets no framework check;
2. the caller is the verified person in a verified active workspace and may `settings:manage` (an owner or admin; a member is refused with 403);
3. **only then is the body read**, under a hard limit of 5 MB plus the form's framing, counted as it arrives (a lying or missing `Content-Length` is cut off), so nobody without the right to upload makes the server buffer anything;
4. the file is judged by its **bytes**.

**Validation and normalization** (`src/storage/logo-image.ts`). Nothing the browser says about a file is believed. Over 5 MB is refused first; the first bytes must be a PNG, JPEG or WebP signature, so **SVG, HTML, XML, GIF, PDF, executables and anything else, renamed or not, are never given to an image library**; SVG is refused on purpose, because it is a document that can carry script and sanitizing it is a separate problem. The header's dimensions are read without decoding: a side over 4096 px or more than 4096 x 4096 pixels is refused, so a few hundred KB that claim 144 million pixels never get a pixel buffer (tested with a real decompression bomb). The image is then decoded strictly (a warning is a failure, so a truncated or damaged file is refused, not half-shown), stood upright, scaled to fit 1024 x 1024 (never enlarged) and **re-encoded as WebP** (lossless for a PNG source, high quality for a photograph). Re-encoding removes every piece of metadata and anything that was not pixels. The SHA-256 of the stored bytes is recorded.

User-facing failures are four, none of which names a bucket, a key, a path or a stack: not a PNG, JPG or WebP; too large (5 MB, 4096 x 4096); could not be read as an image; the upload failed.

**Consistency.** The database and the object store cannot share a transaction, so the order matters (`src/server/branding.ts`): (1) normalize in memory; (2) write a `pending` row; (3) store the bytes (on failure, mark it `failed`: the Branding is untouched); (4) in **one transaction** make the Asset `ready` and point the Branding at it. The Branding therefore never points at a pending or failed Asset, and the switch from the old logo to the new is a single row update, never a gap; (5) if step 4 fails, mark it `failed` and delete the object, best effort.

- **Replacing** uploads and validates the new Asset first and switches the reference atomically. The old Asset stays `ready` and unreferenced; its file is not deleted (nothing may risk removing what something still refers to) and it is no longer public.
- **Removing** sets `logo_asset_id` to null. The row is kept; the public Site and listing fall back to the business's name and initials.
- **Concurrency.** The Branding write is one upsert that takes the row's lock, so saves at the same moment are applied one after the other and the later wins. There is no revision on Branding (Settings has none): **a stale tab can overwrite a newer logo, last write wins**, and both files exist and are the business's own. No Asset is ever cross-linked.
- **What can be left behind, and is unreachable:** an object whose Asset stayed `pending` or `failed` (the process died between steps 3 and 4, or the cleanup could not run), and replaced or removed logos. None is public and none is referenced. A later garbage collector can remove them by status and age; none is built.

### Public delivery

`GET /assets/<id>` is a public route: no session, no cookie, no workspace (the provider-boundary spec holds it). Whether an Asset may be served is decided in the database by `app_public_asset`, the **fourth public SQL function** (same rules as the other three: `SECURITY DEFINER`, fixed `search_path`, executable by the runtime role and nobody else, an answer built field by field): the Asset must be **ready**, a **logo**, and **the logo its business has currently chosen**. A pending or failed upload, a replaced or removed logo, every other Asset and an unknown id are the same plain `404`, with nothing in it that tells them apart. A logo is public because being the business's logo is its purpose; nothing else about a business becomes public.

The address is an id and nothing else: a storage key is not a UUID, so it is a 404 before the database is asked, and no query parameter chooses another file. The response is the stored WebP with its recorded type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` (no filename), `Content-Security-Policy: default-src 'none'; sandbox`, an `ETag` that is the checksum (a matching `If-None-Match` is a 304), and `Cache-Control: public, max-age=86400`. An Asset id never changes what it holds (a new logo is a new id), so it could be cached for a year; a day is chosen because a removed logo stops being served here at once and the day is how long a copy somewhere may outlive that. A CDN with purge-on-removal could lengthen it. Failures a visitor cannot act on are `503 Unavailable` (never a stack, a path or a bucket).

Public projections carry the logo as an **Asset id** (`app_public_site` and `app_public_listing` gained one field, `organization.logo`); the address is built in one place. It is not copied into a Site Version.

### The sample workspace and the seed

The Phase 17 server-side stand-in (`sample-workspace.ts`, a filename with nothing behind it) is gone. The seed stores a real Asset for Apex: `scripts/db/seed-data/apex-crest.svg` (seed input only; an SVG is never accepted as an upload or served) is rasterized and passed through the **same normalization an upload takes**, stored through the storage seam, and recorded with a derived id, so it is deterministic. The object is written first and the row describes whatever is there, so the seed is idempotent (a second run changes nothing) and a rebuilt database never refers to a missing file. Northstar has no logo. Test workers' copies of Apex get their own; the suite uses its own asset directory, recreated with the test database (`db:test:prepare`), and `db:reset` clears the development directory beside the database (only inside `.data/`).

### Configuration, Docker and the production intent

`.env.example` documents both drivers and asks for no AWS key. The Dockerfile creates `/data/assets` owned by the unprivileged user and sets `ASSET_LOCAL_DIR` to it, and deliberately does **not** set the driver; `docker-compose.yml` is unchanged (PostgreSQL only), and `docker-compose.production.yml` mounts the named volume `assets` there. **Run for real in Phase 18C1 (§35):** an upload re-encoded by `sharp` inside the read-only production container lands on that volume, survives restarts, `down`/`up` and a rebuilt image, and `deploy/scripts/backup-assets.sh` archives it (it is not in the database dump). Docker verification was required before AWS deployment (done in Phase 18C1, §35).

The intended production path: the application on EC2 with an **IAM role** (no keys), a **private S3 bucket**, and a public logo request going browser -> the application's `/assets/<id>` -> S3. CloudFront in front of that is a later optimization. **No CloudFront, no custom domain, no bucket provisioning and no AWS deployment exist yet.**

### What the tests prove

| Spec | Proves |
| --- | --- |
| `assets-database.spec.ts` | At the database, as `climvia_app`: every table's organization, the key constraint, the type/purpose/size/checksum/lifecycle constraints, cross-tenant SELECT/INSERT/UPDATE, no DELETE, no context sees nothing, owner/admin write and member cannot, the foreign key on its own with the guard off, a pending/failed/deleted Asset can never be a logo, status moves and immutability, an Asset in use cannot be deleted, `app_public_asset` for current/replaced/removed/pending/failed/unknown, and the two projections |
| `assets-storage.spec.ts` | Keys (hostile inputs), the local driver (round trip, write-once, confinement, no traversal, durability across instances), the S3 driver against a fake client, driver selection, the configuration files, and that only `s3.ts` imports the SDK |
| `assets-image.spec.ts` | The three accepted formats, transparency, scaling, orientation and no metadata, appended bytes dropped; SVG, HTML, XML, GIF, PDF and the rest refused; damaged and truncated files; the size limit; a real decompression bomb; the side limit |
| `assets-upload.spec.ts` | The endpoint: what is stored and where, filenames as labels, every refusal and its leftovers (nothing), the body limit with no length, authorization (no session, member, foreign origin), forged ids and a forged workspace cookie, replacement, removal, accent, six saves at once, a storage failure |
| `assets-public.spec.ts` | The route: headers, 304, no session needed, the same plain 404 for everything else, keys and traversals, a missing object, an unconfigured driver |
| `branding-settings.spec.ts` | Settings: stored and reloaded, a new session and browser, replace/remove/accent, errors, discard, double Save, two tabs, a member who may only look, a person in two businesses |
| `website-logo.spec.ts` | All four Templates with and without a logo, a new logo with no Publish, Template changes that leave it, the Builder, the preview, the listing, the Gallery |
| `assets-durability.spec.ts` | A logo saved through the running server is given back by two **new server processes**; the file survived both |
| `tenant-fixture-boundary.spec.ts`, `provider-boundary.spec.ts`, `public-boundary.spec.ts`, `server-boundaries.spec.ts` | No Client Component reaches storage, the AWS SDK or sharp; the client JavaScript holds no storage detail; the public path does not import the tenant module; a probe server whose role runs only the four public functions serves the logo; the three route handlers keep to their own lines |

### What this does not change, and what is deferred

Unchanged and re-tested: the Phase 16 provider split and the public projection, tenant isolation, the Draft/Published lifecycle, the Templates and the Builder, the Marketplace. **Deferred:** a media library or any other image use, private Assets, image variants and thumbnails, a garbage collector for unreferenced files, the profile photo (still session-only), SVG, CloudFront, bucket provisioning, and everything in the domain and deployment phases. The central accent reaching published pages is undecided. `SAMPLE_DATA_SET` (`"apex-demo"`) is still the sample set's name in client code, as before.

## 34. Custom domains (Phase 18B)

A business can claim a domain for a Site, prove it owns it with a DNS TXT record, and have **this application** serve the Site for requests that arrive with that name as their `Host`. This is the application layer only. Pointing the domain's DNS at Climvia, the HTTPS certificate for it, the proxy or load balancer in front, and any AWS work are **Phase 18C**; nothing here is tested against the real internet, and no screen says a domain is "live", "connected" or "secure".

### Ownership: Organization → Site → Domains

A domain belongs to a **Site**, never straight to an Organization, because one Organization can own several Sites. `site_domains` (migrations 0019 and 0020) holds a claim: `organization_id`, `site_id` (a composite foreign key to `sites(organization_id, id)`, so a claim can not name another business's Site), `hostname`, `status`, `verification_token`, `verification_created_at`, `verified_at`, `activated_at`, `disabled_at`, `removed_at`, `last_checked_at`, `is_primary`, `revision`, `created_by_user_id` and the timestamps. A Site holds at most 10 claims that are not removed. The three columns that only *recorded* a domain on `sites` (`custom_domain`, `custom_domain_status`, `primary_domain`) are gone; migration 0019 turns any recorded name into a pending claim with a fresh random token. The platform address (`sites.platform_slug`, `<slug>.climvia.com`) is separate: it is never stored in `site_domains`, a custom domain never replaces it, and a Site keeps working at `/sites/<slug>` whatever its domains do.

### The state machine (`lib/domain-rules`, enforced again by the database)

| State | Meaning |
| --- | --- |
| `pending_verification` | the claim exists; ownership is **not** proved |
| `verified` | the TXT record was found |
| `active` | the application will serve the Site when a request arrives with this Host ("Active in Climvia") |
| `disabled` | the application no longer serves it; the claim is kept and can be re-enabled |
| `removed` | released: history only; the name can be claimed again, with a **new** token |

Moves: `pending → verified → active ⇄ disabled`, and any state `→ removed`. A pending claim can never become active. In the database: a lifecycle `CHECK` ties each state to its timestamps (nothing is active without `verified_at`), the transition guard (runtime role) refuses every other move and makes `removed` and `verified_at` final, and `is_primary` is allowed only on an active claim. The `revision` counts changes to a claim's state (not a DNS check that only stamps `last_checked_at`); every action sends the revision its screen showed, so a screen that is behind can not re-activate what was disabled, restore what was removed, or change a claim it never saw.

### One hostname normalizer (`lib/hostname`)

The same function is used by the Domain Manager (a first look), the Server Actions (the enforcement) and the proxy (to classify a request). It trims, lower-cases, drops one trailing dot, converts a Unicode name to ASCII through the platform's own URL parser (never by hand) and then checks strictly: letters, digits and hyphens in labels of 1–63 characters, at least two labels, a top-level label that starts with a letter (so no IP address passes in any spelling), and at most 231 characters so that `_climvia-verification.<name>` fits in 253. It rejects a scheme, a path, a query, a fragment, user information, a port, a wildcard, `%` escapes and spaces. Only the normalized ASCII name is stored, compared or looked up. **Reserved** names can not be claimed: `climvia.com` and everything beneath it, `localhost` and the internal suffixes (`.local`, `.internal`, `.localdomain`, `.invalid`, `.home.arpa`), every name in `APP_HOSTS` and the `CUSTOM_DOMAIN_TARGET` (and beneath them). The server checks this, and the table's `CHECK`s enforce the shape and the platform and development names again.

### Global uniqueness

A partial unique index on `hostname` where `status <> 'removed'` lets one claim hold a name across every business and Site. Case, a trailing dot and a Unicode spelling can not get round it (only the normalized form can be stored). A refusal says only "This domain is already in use." and reveals nothing about who holds it. A removed claim frees the name; the next claim of it gets a new token, so an old record in DNS can not prove it (tested).

### Proving ownership

- **Token:** 32 random bytes from the operating system's strong random source, written as base64url (43 characters). Never derived from an id, the name or a time; unique across all claims ever (a unique index); immutable (no `UPDATE` privilege); shown only to people who may manage the website and only while the claim is pending (it is not in any public projection, generic Site object, or the client JavaScript).
- **Record:** the same convention for a root domain and a subdomain: a TXT record at `_climvia-verification.<domain>` with the value `climvia-site-verification=<token>`.
- **Check:** the screen's **Verify ownership** runs `verifyDomainAction`: authorize `website:manage`, then (1) a short transaction stamps `last_checked_at` in one conditional statement (the cooldown, 10 seconds, stored in the database so it holds across processes and tabs) and reads what to look for, (2) DNS is asked with **no transaction and no lock held**, (3) a second short transaction marks the claim verified, only if it is still the same pending claim. A record counts only if its logical value (a TXT record's chunks joined) **equals** the expected value; text around it, another case or another claim's token does not. A repeat of a successful check is a no-op.
- **Outcomes** the screen words: verified, no record yet, a record with another value, DNS unreachable (a timeout or resolver failure; the claim is unchanged and can be retried), and "checked a moment ago".
- **Resolver abstraction (`lib/dns-resolver`):** one narrow interface (`resolveTxt`). The default uses Node's DNS client with a bounded wait (4 s); nothing is tied to a DNS provider. Climvia only **reads** DNS: it writes no record, calls no Route 53 or other DNS API, needs no credentials, and never fetches anything from a customer's website. The automated tests supply answers through a fixture resolver (a directory of files, one per DNS name) that only the test configuration turns on; no deployment file sets it, and a spec checks that.

### Activation, the main domain, disabling and removing

`Activate` needs a verified (or previously active, now disabled) claim. The Site's first active domain becomes its **main** domain; later ones are aliases until **Make primary** hands the role over (at most one main domain per Site: a partial unique index, and every change takes the Site's row lock first). Making the Climvia address the main one again clears the flag and the domain keeps serving. `Disable` stops serving at once and ends being main; `Remove` releases the name. Nothing is ever deleted: removed claims stay as history. Activating, disabling or removing never changes the Site's content or whether it is published, and publishing, applying a Template or changing Branding never touches a claim (tested both ways).

### Routing instructions (not routing)

After verification the Domain Manager says where to point DNS: a subdomain gets a CNAME to `CUSTOM_DOMAIN_TARGET`; a root domain is told that most DNS providers do not allow a CNAME there and to use ALIAS, ANAME or CNAME flattening to the target (or the A/AAAA addresses Climvia publishes for production routing). No address is hard-coded. Until a target is configured the screen says the address will be shown when production routing is set up. The permanent note: *Active in Climvia means Climvia will show your website for this domain when a request for it arrives. Your domain's DNS must also point to Climvia, and a security certificate must be in place, before visitors can open it.*

### Resolving a request by its Host

1. **The proxy** (`src/proxy.ts`, which Next.js 16 runs on Node) looks at the `Host` header first, and only that header. `Forwarded`, `X-Forwarded-Host` and the like are sent by whoever makes the request, so they choose nothing; a trusted-proxy setting would have to be introduced and documented in Phase 18C before any of them is honoured (a spec scans the source for it).
2. `classifyHost` (`lib/hostname`) makes it **platform** (the names in `APP_HOSTS` and the host of `BETTER_AUTH_URL`, each with everything beneath it, `CUSTOM_DOMAIN_TARGET`, every IP address and every one-label name such as `localhost` or a container's service name), **custom** (any other multi-label name) or **refuse** (not a usable Host). Platform requests continue through the existing rules unchanged. Any deployment must therefore list every name it answers on in `APP_HOSTS` or those requests get a plain "not found".
3. A **custom** request is rewritten (the browser's address does not change) to the internal route `src/app/(public)/custom-site/[[...slug]]`, before any session logic: on a customer's name the sign-in pages, the workspace, the Builder, the previews and every API do not exist (`/settings`, `/login` and `/api/branding` there are only pages the site does not have). The one path passed through is `/assets/<id>`, the public logo, which asks the database for itself and ignores the host. Every other path, file paths included, takes the rewrite.
4. The route asks `getRequestSite()` (`server/request-host`), which makes one call to the public SQL function **`app_public_domain(hostname)`**: SECURITY DEFINER, executable by the runtime role and nobody else, returning only the Site's public identity (`platformSlug`) and the name its pages should call themselves (`canonicalHost`), and only for an **active** claim of a **published** Site. No token, id, organization, status, other claim or Draft is returned. The route then renders the page through the **same** `PublicSiteRoute` and `getPublicSite` as `/sites/<slug>`, with links at the root of the host (`base` is empty). An unknown name, a pending/verified/disabled/removed claim, a private Site or a hidden page is the same plain "not found"; **nothing ever falls back to a sample or standing business**. The request's session is never read; a signed-in person gets the same bytes as a stranger. Pages are dynamic and uncached, so one name can not be given another's content.
5. **Booking** on a customer's name derives the Site from the Host: the Server Action ignores the `siteSlug` the browser sends there and resolves the active domain, so a form posted to one business's name can only book that business's Services (a Service of another business is refused, a forged organization is ignored, a repeat finds the first booking). The platform route's behaviour is unchanged. Both entry paths end in the same `app_public_create_booking`, which finds the organization from the Site again.
6. **Canonical addresses:** a page on a customer's name sets `<link rel="canonical">` to the Site's main active domain (or the name it was reached on when none is main); a page opened at the platform address says the same once the Site has one. Scheme: `CUSTOM_DOMAIN_URL_SCHEME` (`https` by default; `http` only for local development and the tests). Nothing redirects, so no loop is possible and both addresses keep working. A site with no active custom domain claims nothing.

### Row Level Security and privileges (migration 0020)

Members of the active organization read `site_domains`; owners and admins (`website:manage`) insert and update. A claim is created pending, not main, at revision 1, by the caller. The runtime role can update only `status`, `is_primary` and the stamps (`verified_at`, `activated_at`, `disabled_at`, `removed_at`, `last_checked_at`); the name, Site, token and maker are fixed once created; there is no `DELETE`. The verification record is added to the workspace state only for a caller who passed `website:manage` (`core-data` and the action helper), and the public functions never name the table's columns. The migration also replaces `sites_guard_insert` and `sites_guard_update` (they mentioned the dropped columns).

### Configuration (`.env.example`)

`APP_HOSTS`, `CUSTOM_DOMAIN_TARGET` and `CUSTOM_DOMAIN_URL_SCHEME`, described above. No credentials. Development needs nothing: `localhost` and `127.0.0.1` are platform names, tenants can not claim them, and the tests send synthetic `Host` headers straight to the local server (no DNS).

### The Phase 18C seam

The application supplies **verified, active hostnames** and **safe Host → Site resolution**. Infrastructure must supply the Internet DNS target, the reverse proxy or load balancer, certificate issuance and renewal, health checks and deployment. Phase 18C1 supplied the proxy, the certificate permission and the health checks for a single host (§35); **no forwarded host is read anywhere** (the one place that did, the upload's same-origin check, now uses the request's own `Host`). DNS and public certificates remain Phase 18C2. Nothing here locks the choice between a load balancer and a proxy such as Caddy, and **Docker verification was required before AWS deployment (done in Phase 18C1, §35)**.

### Tests

`domain-rules.spec.ts` (the normalizer, reserved names, Host classification, the state machine, TXT matching, routing advice, the resolver), `domains-database.spec.ts` (SQL as `climvia_app`: who reads and writes, the transition guard, constraints, uniqueness, the public function, races), `domains-claims.spec.ts` (the lifecycle on a test copy with fixture DNS: claims, verification, cooldown, activation, main, stale screens, handing a name to another Site, independence from Templates, Branding and publishing), `domains-host.spec.ts` (requests by Host against the running server: every page, private routes, unknown and non-active names, forged headers, two businesses, two Sites, Templates, logo, canonical, booking through a browser), `domains-ui.spec.ts` (the Domain Manager) and `domains-boundary.spec.ts` (the import graph, the client bundle, header trust, no DNS writes or outbound fetches), plus the public-boundary probe: a server whose database role can run only the public functions (six when this was written, seven since Phase 18C1 added `app_tls_eligible`, §35) also serves a customer's name.

### What this does not do

Real internet DNS and TLS are not exercised (the DNS client is tested against the fixture and a never-answering address only). A Site is shown at `<origin>/sites/<slug>` (§39); no `<slug>.<domain>` hostname is routed. The Marketplace listing's "View website" still leads to the platform path. Docker, AWS, Route 53, CloudFront and certificates are untouched.

## 35. The production container runtime (Phase 18C1)

Phase 18C1 turned the container files from "written to the documentation" into a stack that was **built and run for real** (Docker 29.8, Compose 5.6, Node 24 on Alpine, Caddy 2, PostgreSQL 17), and fixed what running it found. It adds no feature and no AWS resource. This section says what the stack is, what each part guarantees, and what was and was not proved.

### The stack

```
Internet ── 80/443 ──> proxy (Caddy 2)                                   edge network (fixed subnet)
                          │  Host kept · X-Forwarded-For set by Caddy · /internal blocked · bodies ≤ 8 MB
                          └─> app:3000 (climvia-web, uid 10001, read-only, no capabilities)      edge + data
                                  │  assets volume (uploaded logos)          · tmpfs for /tmp and .next/cache
                                  └─> db:5432 (PostgreSQL 17, pgdata volume)      data network: internal, no route out
migrate (climvia-tools): runs once per deploy, before the app; exits
```

`docker-compose.production.yml` (the development file, `docker-compose.yml`, is unchanged and still PostgreSQL only). Only the proxy publishes ports (80 and 443, host ports configurable for a trial). The app and the database have **no `ports:`**; from the proxy the name `db` does not resolve, and the database cannot reach the Internet. Each container gets an explicit allow-list of settings, not `env_file`: the app receives exactly `APP_ENVIRONMENT` (`scripts/deploy/rules.ts`; a test compares it with the compose file), the migration gets the owner's connection and the app password, the database gets its own three, the proxy gets three. The app therefore never holds the owner's credential, and refuses to start if it did. App and migration run `read_only`, `cap_drop: ALL`, `no-new-privileges`, with a tmpfs for `/tmp` and `.next/cache`; nothing mounts the Docker socket; the app uses `init: true` and a 30 s grace period. Start-up order is enforced by health: database healthy → migration exits 0 → app ready → proxy.

Volumes: `pgdata` (the database), `assets` (uploaded logos when `ASSET_STORAGE_DRIVER=local`), `caddy-data` (certificates and the ACME account), `caddy-config`. None is removed by any script. A volume is not a backup (below).

### The images

`Dockerfile`: `base` → `deps` (`npm ci`) → `build` (`next build`, standalone) → `tools` and `runner`. `runner` is the standalone server plus `scripts/graceful-shutdown.cjs`, as numeric user 10001, with `CLIMVIA_ENV=production`, `APP_VERSION` (the git commit, shown by the health endpoints and the image label) and a healthcheck on `/health/ready`. `tools` holds the migration, status, roles, fingerprint and config-check scripts and `src/`, `drizzle/`; **not** the seed, its data, `e2e/`, or any test artifact. Both images were exported and scanned after the build: no `.env`, key, dump, upload or test artifact; none of the 14 secret values from the development and trial env files; no Apex or Northstar string, no seeded person; no secret in `docker history`. The runtime image is 325 MB.

Three things the run found and the files now do differently:

- **No `VOLUME` instruction.** It gave a container started without a mount an anonymous volume, which looked healthy and loses its files when the container is removed. The directory exists, owned by 10001, so a new named volume takes that ownership; without a mount, on a read-only filesystem, `/health/ready` reports storage `fail`.
- **Graceful stop.** The standalone server does not handle SIGTERM: `docker stop` ended it at once with exit 143, cutting off a request in progress. `graceful-shutdown.cjs` (preloaded with `node --require`) stops accepting connections, lets requests in progress finish and exits 0, with a 25 s deadline inside the 30 s grace period. Proved with a slow upload that was half-sent when the stop was asked for: it was answered, then the container exited 0, never killed.
- **A build context must not contain files that import ignored files.** `playwright.docker.config.ts` imported a directory `.dockerignore` excludes, so `next build` (which type-checks everything it sees) failed inside the image. Both Playwright configs are now ignored too.

### The deployment marker and the configuration

`CLIMVIA_ENV=production` is set by the runtime image and by nothing else (not the build, not the tools, not the host Playwright server, which also runs a production *build* with a test DNS resolver and an http address, so `NODE_ENV` cannot be the marker). When it is set, `productionConfigProblems` (`src/lib/deployment.ts`, pure) lists every way the environment is unfit: a missing, short or placeholder `BETTER_AUTH_SECRET` or `TLS_ASK_TOKEN`; a `DATABASE_URL` that is not the restricted role with a real password; the owner's credential, the database passwords or any AWS access key in the app's environment; a non-https address; no trusted proxy; no routing target; an unknown storage driver, a relative or test asset directory, or S3 without region and bucket; and any test-only setting (the DNS fixture resolver and directory, the test directories, `ALLOW_SEED`, `SEED_PASSWORD`). `src/instrumentation.ts` runs it before the first request and **exits the process** with the list (names and rules, never values). Throwing was not enough: Next.js logged an unhandled rejection and the server kept running half-prepared; the exit was verified (`exit=1`).

`npm run config:check -- <env-file>` applies the same rules to exactly what the app container would receive, plus `scripts/deploy/rules.ts` to the rest of the file (password strength and URL-safety; the two connection strings must name `db`, the right database, role and password; `PUBLIC_HOST` equals the host of `BETTER_AUTH_URL`; `AUTH_TRUSTED_PROXIES` lists the proxy network; no AWS key). `deploy.sh` runs it first, inside the tools image, with the file mounted read-only. A deliberately spoiled file was rejected naming the settings and printing none of their values.

### Migrations, and production never seeds

`deploy/scripts/deploy.sh`: build → config check → start the database → **run the migration on its own** → `up --wait` → verify. The migration runs before the app is replaced because Compose, given a changed app image and a `service_completed_successfully` dependency, replaces the app container first and starts it only after the migration, so a failing migration left the app *down* (observed). Run on its own, a failing migration (checked with a wrong owner password) stops the deploy at that step, the old app container is untouched and still ready (same container id). The consequence is documented: a migration must work for the version still running for a few seconds, so add in one release and remove in a later one.

`db:migrate` waits for the database with retries (`DB_WAIT_SECONDS`), treats an authentication failure as final, creates the database if missing, provisions `climvia_app` (its password follows `POSTGRES_APP_PASSWORD` on every run) and applies the migrations. It never seeds. `db:seed`, `db:reset` and `db:test:prepare` refuse under `CLIMVIA_ENV=production` (the seed had an `ALLOW_SEED` override for `NODE_ENV`; there is none for this), the seed's data is not in the images, and nothing in the compose file, the Dockerfile or the scripts names them. A new stack's database held 22 migrations, the four Website Templates and **no organization, user, customer, booking, site, domain or asset** (every public table was checked, not a list).

### The proxy and the Host

The application tells a customer's domain from the platform's own names by the request's `Host`, and by nothing a client can add. `deploy/caddy/Caddyfile` keeps it that way: Caddy passes `Host` through untouched, replaces `X-Forwarded-For`, `-Host` and `-Proto` with its own (it trusts no proxy in front of it, so a client cannot name its address), and deletes `Forwarded`, `X-Original-Host`, `X-Host` and `X-Forwarded-Server`. Checked against an echo upstream behind the real Caddyfile with every one of those forged. **`same-origin.ts` no longer reads `X-Forwarded-Host`**: it compares `Origin` with the request's own `Host`, the configured public origin and the listed trusted origins, so no source reads a forwarded host any more (the previous exemption in the boundary test is gone), and a forged one is refused (403) in both a source test and a request through the proxy.

Other proxy rules: `/internal` is answered 404 on every name, case-insensitively and for encoded and doubled slashes; request bodies above 8 MB (the logo limit is 5 MB) are refused by the proxy; header, body, write and idle timeouts are set; the access log is JSON on stdout with no body, no `Cookie`, no `Authorization`, no `Set-Cookie` (0 session tokens in the log after the session tests); HSTS and `nosniff` are added only when the application did not set them, and the logo route's own `Content-Security-Policy` reaches the browser unchanged. (Caddy applies the "only if absent" test to a whole `header { }` block, so each default is its own directive: found when HSTS vanished from the logo response.) Plain http is redirected to https; a customer's name is served at the root of its host, never under the platform's `/sites` paths.

Platform subdomains (`<site>.<platform-domain>`) are **not served**: they need DNS that does not exist and a wildcard certificate (DNS validation). The block is in the Caddyfile commented out. A name *beneath* the application's own host is the platform's by design (nobody may claim it), so it is never given a certificate on demand either.

### On-demand TLS authorization

Before Caddy obtains a certificate for a name it has not served, it asks `GET http://app:3000/internal/tls-allow?token=<TLS_ASK_TOKEN>&domain=<name>`. The answer is the status and nothing else: **200** for the exact normalized name of an **active** `site_domains` row whose Site is **published**; the same bare **404**, with no body, for everything else (wrong or missing token, a name that is not a name, unknown, pending, verified, disabled, removed, a private Site, a database that cannot be asked). One indexed query through a new `SECURITY DEFINER` function, `app_tls_eligible` (migration `0021`, the seventh public function, executable by `climvia_app` and no one else, fixed search path, `STABLE`); no DNS is asked, nothing is written, no tenant, site or token leaves. The secret is compared in constant time before the name is looked at. The endpoint is reachable from the proxy over the internal network, answered 404 by the proxy to the Internet and unknown on a customer's name.

Proved with real TLS handshakes against Caddy: the active name got a certificate and pending, verified, disabled, removed, unknown and platform-beneath names got no handshake at all; Caddy's certificate store held the application's name and the one active domain, all from the local authority, and no request to a public CA was logged. Disabling the domain made the name 404 at once and the permission question "no"; enabling it again restored it. **Local certificates prove the mechanics** (the question, the obedience, the kept Host); they prove nothing about Let's Encrypt, DNS or the Internet.

### Health

`/health/live` (the process runs; no database) and `/health/ready` (configuration, database through a public function so a database that is up but not migrated is not ready, and storage). The answer is `ready`/`unavailable`, the build, and three words; never an error, path, address or tenant; the reason goes to the log once per change. 503 when not ready, `no-store`, 404 on a customer's name. Proved: with the database stopped the app stayed alive, reported `database: fail`, served no partial page, and **recovered by itself** when the database returned (same container, no restart); an app container without its file volume was alive and not ready.

### Logging

Everything is on stdout/stderr and rotated by Docker. `[assets]` lines and `[health]` changes carry no secret; the config failure lists names only. **"The destination stream closed early"** is not an application error: it is React's server renderer (`react-dom`'s `pipe`) cancelling an in-flight page render because the HTTP response closed first, i.e. the browser or the proxy hung up (a navigation, a closed tab, an upload cut off by the proxy's size limit shows the related `aborted`/`ECONNRESET`). A real write failure uses a different message ("errored while writing data"). It was seen in the Docker run only alongside browser navigation, could not be provoked by synthetic aborts of fast pages, never accompanied a 5xx, and left the app ready. It is not suppressed: hiding it would need patching Next's logging and would hide the real ones. Treat it as noise unless it comes with error responses.

### Persistence and the lifecycle

All against the real containers, with the same rows, files and certificate compared before and after: app restart; database restart; database stopped and started; proxy restart (**the same certificate**, from `caddy-data`); full `down` and `up` without removing a volume; a rebuilt image with a new version recreating the app; a graceful stop; sign-in after each. An image given a bad configuration exits 1 listing names and printing no value (a sentinel secret was not in the output). Sign-in is rate limited per client address through the proxy (three attempts, then 429): seven attempts each claiming a different `X-Forwarded-For` were counted against one address, which is also what shows `AUTH_TRUSTED_PROXIES` names the right network.

### Backups and the restore drill

`deploy/scripts/backup.sh`: `pg_dump --format=custom` inside the database container (no password anywhere), written as a partial file, checked non-empty and readable by `pg_restore`, then renamed with a checksum and a description (`created_utc`, versions, migrations applied, size, sha256); it never deletes an older backup. `restore.sh` verifies the checksum, provisions `climvia_app` (roles are not in a dump), restores in **one transaction, stopping at the first error**, only into a database that is empty or absent, and never overwrites. `restore-drill.sh` takes a backup, restores it beside the real database, and compares every table (row count and an md5 of all rows) with `db:fingerprint --compare`, then drops the copy. Results: the live drill matched **50/50 tables, 0 differences**. A richer, **cross-server** drill (the Apex and Northstar sample data, every module, two domain claims, a logo and branding, dumped on one PostgreSQL 17 server and restored into the stack's) matched **50/50 tables**; on the restored copy the catalogue was identical (110 policies, 42 functions, 106 grants), the public functions worked, and row-level security held as the restricted role (Apex's owner saw Apex's 5 customers, 9 invoices, 8 payments, 14 bookings and none of Northstar's; naming the other business, or having no membership, returned nothing). `backup-assets.sh`/`restore-assets.sh` archive and restore the logo volume with a checksum, to an empty volume only; the restored files were byte-identical and owned by 10001. In S3 mode the bucket holds the files; S3's durability is not a backup (versioning and a copy are). An EBS snapshot protects the instance's disk but is not by itself a database backup (it captures a database mid-write); keep dumps off the instance.

### Tests

`e2e/deployment-config.spec.ts` (the configuration rules), `e2e/runtime-endpoints.spec.ts` (health, readiness with the database unreachable or storage unconfigured, fail-fast on a bad production configuration, the permission endpoint's every answer, the function's ACL), `e2e/container-config.spec.ts` (the Dockerfile, compose file, Caddyfile, env example and scripts held to the rules above, with no Docker needed), a forged-header upload test in `assets-upload.spec.ts`, and the boundary specs updated for the seventh public function and the removed forwarded-host exemption. The Docker suite, `npm run test:docker` (`playwright.docker.config.ts`, `e2e-docker/`, a stack started from an env file, **not** part of `npm run test:e2e`): `01` a fresh database and the stack's guarantees, `02` a first user, onboarding, a Service, every workspace module, PNG/JPEG/WebP logos through `sharp` in the container, publishing, `03` custom domains through real handshakes and a booking on a customer's name, `04` the lifecycle above. Run it against a stack whose database is new.

### What this does not do, and what Phase 18C2 still has to

Nothing was created in AWS, no public certificate was requested, no DNS exists, and no S3 bucket was used (S3 mode is configuration- and unit-tested only). A single instance is **not highly available**: the host, the Docker daemon, the one database and the one proxy are each a single point of failure, and a deploy is a few seconds of replacement. Remaining for 18C2: the instance and its IAM role (IMDSv2, S3 access without keys), the security group (80/443 only, no public 5432, no public SSH if possible), DNS for the application's name, the routing target and the platform wildcard, real certificate issuance (which the permission endpoint only authorizes), secrets from Secrets Manager/SSM onto the instance, EBS and off-instance backups, log collection, and a CI/CD path (prefer OIDC to long-lived keys). A first deployment must also test the public mode of the proxy (`mode.public.caddy`) for the first time.

## 36. Platform administration (Phase 19A)

Phase 19A adds Climvia's own control plane: a small console, at `/platform-admin`, for the people who run the platform (not for the businesses on it). It is separate from everything above. This section says what the authority is, where it comes from and where it cannot come from, how it is granted, what the console shows and may do, how a Marketplace listing is moderated, and what remains.

### The rule: Platform Super Admin != Organization Owner

A **platform super administrator** (`super_admin`) is a person Climvia has chosen to operate the platform. An **Organization owner** is a person who runs one business. They are different kinds of authority, held in different tables, checked by different code, and neither implies the other:

| | Platform super administrator | Organization owner / admin / member |
| --- | --- | --- |
| Is about | the platform: every business, read across, and the one moderation action below | one business's workspace |
| Stored in | `platform_admins` (no `organization_id`) | `organization_memberships` |
| Granted by | the command line, by an operator with the database owner's credential | the business's owner, in Team |
| Visible in the workspace | never: there is no link, word or data of it in any workspace page, its code or its data | everything about that business |

An owner of every business on the platform has **no** platform authority. A platform super administrator has **no** access to any business's workspace: the console reads aggregate and profile facts through functions; it never opens a business's customers, bookings, quotes, invoices or payments, and there is **no impersonation** ("log in as a business") anywhere.

Platform authority is **never inferred** from an Organization role, an email address or domain, being the first user, a value the browser sends (a cookie, a header, a query string, a form field, a JSON body), an organization id, or a URL. It comes from one place: the database's answer (`app_is_platform_admin()`) about the user whose session Better Auth just verified.

### The data (migrations `0022` and `0023`)

- `platform_admins`: `id`, `user_id` (foreign key to `auth_user`, `ON DELETE CASCADE`), `role` (`super_admin`, a check), `created_at`, `granted_via` (`cli`, a check: the only way an assignment is made), `granted_by` (the operator's provenance, `cli:<operating-system user>`), and `revoked_at` / `revoked_by` (set together or not at all). A **partial unique index** allows one *active* (`revoked_at IS NULL`) assignment per person; a revoked row is history and a later grant is a new row. The table holds no organization: it is not tenant-owned.
- `platform_listing_moderation`: one row per listing that has ever been decided (`listing_id` is the primary key and a foreign key to `marketplace_listings`, `ON DELETE CASCADE`): `state` (`allowed` or `suspended`), an optional internal `reason` (allowed only when suspended, at most 500 characters), `decided_by`, `decided_at` and a `revision`. **No row means allowed.**
- `platform_audit_events`: append-only (below). No foreign key: the record of a person or a listing outlives both.

All three have Row Level Security enabled **with no policy**, and every privilege is revoked from `PUBLIC` and from `climvia_app`. Even a mistaken `GRANT SELECT` would show nobody any row (a test proves it with a throwaway role). Only the database owner reads or writes them directly.

### Granting and revoking: the only way

```bash
npm run platform-admin:grant  -- --email <address>     # an EXISTING account becomes a platform super administrator
npm run platform-admin:revoke -- --email <address>     # takes it away; the account and its businesses are untouched
npm run platform-admin:list                            # who is an administrator now (prints no secret)
```

- **Public signup never creates an administrator**, whatever the request carries (a test signs up with `role`, `platformAdmin` and similar fields and checks no assignment exists), and no migration, seed, schema default or page writes `platform_admins` (a test scans `drizzle/`, `scripts/` and `src/`). **No real address and no default administrator exists in source, migrations, seed data or docs.**
- `grant` finds the account by the **exact address after trimming and lower-casing**; an unknown address is refused and **no account is created**; granting someone who already is an administrator changes nothing and says so. It connects as the **database owner** (`DATABASE_ADMIN_URL`) and writes the assignment and its audit event in **one transaction**. `revoke` sets `revoked_at` and **never deletes the account**; revoking someone who is not an administrator changes nothing. Revoking takes effect on the very next request, because every request asks the database again.
- There is no browser path, API route, Server Action or form that writes an assignment. A deployment has no administrator until an operator runs `grant`.

**Bootstrapping the first administrator** (after the first person has signed up like anyone else):

```bash
# local development (the dev database):
npm run platform-admin:grant -- --email <the address they signed up with>
# the container stack: the tools image holds the same command
docker compose -f docker-compose.production.yml --env-file .env.production run --rm migrate npm run platform-admin:grant -- --email <the address>
```

Then they open `/platform-admin/login` and sign in with their ordinary account. The operator is recorded in the audit trail as `cli:<user name on the machine>`. That is provenance, not authentication: the credential that matters is the database owner's.

### Route and authentication boundary

- **Group `(platform-admin)`**, a sibling of `(public)`, `(auth)` and `(signed-in)` (§30): its own layout (no providers, no workspace shell, `noindex`, never cached). It reads **no active organization**, no workspace provider, no tenant data access and no fixture data; a test builds the import graph and holds it, and checks the other direction too: nothing in the workspace, the public pages or the sign-in pages imports, names or links to the console (`platform-admin-boundary.spec.ts`).
- **`/platform-admin/login`** is the console's door. It uses the ordinary Better Auth sign-in (the same form), then the console asks the database whether that person is an administrator. Signing in proves who someone is; it never decides who may enter. It says nothing about who is an administrator: a signed-in person who is not one sees the same form.
- **Anonymous** requests to any other `/platform-admin…` address are redirected to the login by `proxy.ts` (an early, cheap check on the session cookie, not the boundary). **A signed-in person who is not an administrator gets the ordinary "not found" page**, the same for every address, which does not reveal that an administrator exists. An administrator gets the console.
- The real check is `requirePlatformAdmin()` (`src/server/platform-admin.ts`), which every console page, the console layout and the one Server Action call **first**; the database functions check again, so hiding a link was never the protection. A page or action added without it fails the server-boundaries spec.
- **On a customer's domain** the console does not exist (`proxy.ts` rewrites every path on a customer's host to the customer's site, where `/platform-admin` is a path the site does not have), even with an administrator's cookie.

### Row Level Security and the cross-tenant strategy

Row Level Security is **not** disabled, weakened or bypassed anywhere, and `climvia_app` gains **no** cross-tenant access on its tenant context. The platform reads and writes through **narrow `SECURITY DEFINER` functions**, each with a fixed `search_path`, `EXECUTE` revoked from `PUBLIC` and granted to `climvia_app` alone:

- `app_is_platform_admin()`: true only when the user in `app.user_id` has an active assignment; it answers about the caller and about nobody else.
- Reads: `app_platform_overview()`, `app_platform_organizations(search, limit, offset)`, `app_platform_organization(id)`, `app_platform_users(…)`, `app_platform_listings(…)`, `app_platform_reviews(…)`, `app_platform_system()`, `app_platform_audit_recent(limit)`. Each begins with the internal guard `app_platform_guard()` (not executable by `climvia_app`), which refuses a caller who is not an administrator with error `42501` (insufficient privilege) before any row is read. Limits and offsets are clamped; a search is matched literally (`%`, `_` and `\` are escaped, 100 characters at most).
- The one write: `app_platform_set_listing_moderation(listing, state, reason)`: guard, validation, an advisory lock per listing, an idempotent decision, and the audit event in the same transaction.

There is **no generic "run this as administrator" function and no argument that carries SQL**. The functions return only what the console shows: no password, session token, OAuth token, recovery or verification material, domain ownership token or secret of any kind (tests compare every output with the stored secrets). The application's side is `src/db/platform-queries.ts`: it calls only these functions, names no table, and opens the connection as the verified user (`withUser`), so the database sees who is asking.

*What this does not protect against:* anyone who can run arbitrary SQL as `climvia_app` can set `app.user_id` to any value, exactly as they could already read tenant data by setting `app.org_id`. The role's password is held by the application; the protection against SQL injection is the application's parameterised queries and the boundary tests, as it has been since Phase 10. Platform authority adds no new exposure to that, and the owner's credential is never in the application's environment.

### The console

Navigation: **Overview, Organizations, Users, Marketplace Listings, Reviews / Moderation, System**. The pages are dense, quiet and plain (the existing design language), and show nothing that is not real.

- **Overview**: ten counts read now: organizations, users, active memberships, Sites, published Sites, listings, published listings, suspended listings, bookings, reviews. No chart, trend or percentage change, because there is no history behind one. Zero is a valid state and says so.
- **Organizations**: name, created, members, owners, Services, Sites (and how many are live) and listing status; search by name; page by page. A detail page shows the business profile, activity counts (counts only), people with roles, Services, Sites and the listing. Read-only.
- **Users**: name, address, created, businesses and roles, and whether the person is a platform administrator; search by name or address. No password, session, token or recovery detail, and no action on an account.
- **Marketplace Listings**: every listing with what the business chose, the platform's decision and whether it is **public now**; suspend (with an optional internal reason) and allow again.
- **Reviews / Moderation**: a read-only look at reviews across the platform (search, rating filter). See below for why it is not more.
- **System**: the build, the environment, readiness (configuration, database, file storage), the PostgreSQL version, how many migrations are applied, the storage driver's **name**, diagnostic counts and the recent platform activity. It reads no setting's value: no connection string, password, key, token, path or ownership token.

### Marketplace moderation

A listing has two independent states, held in two places:

| Who | State | Where |
| --- | --- | --- |
| the business | `draft`, `hidden` or `published` | `marketplace_listings.status` (unchanged) |
| the platform | `allowed` (the default) or `suspended`, with an optional internal reason | `platform_listing_moderation` |

A listing is **public only when both agree**: the business has it `published` and the platform has not `suspended` it. `app_public_listing(slug)` (replaced in migration `0023`; the existing semantics are unchanged and it stays the same public function) returns nothing for a suspended listing, the same "unavailable" as an unpublished one or an address that does not exist, and it adds nothing to what a published listing returned (no reason, no state). Consequently: published and allowed is available; published and suspended is not; unpublished and allowed is not; **allowing again restores a listing only if the business still has it published**; and suspending changes **nothing the business wrote** (the listing row, its text, its Services and its Site are exactly as they were, so a suspension can always be undone). The business is not told in 19A (below).

Every decision that changes something writes an audit event in the same transaction; deciding what is already true changes and records nothing. Concurrent decisions on one listing are serialised.

**Review moderation: not built, deliberately.** Climvia has no *public* review display: a review is shown to the business that earned it and to nobody else, and no published Site or Marketplace listing renders one. Moderating a review would mean changing a business's own record (hiding or deleting something the business owns and may reply to) with nothing public to protect, and no screen design for it. 19A therefore gives the platform a read-only view and **does not pretend otherwise**; moderation arrives with public reviews (19B/19C).

### The audit trail

`platform_audit_events` records: an administrator granted, an administrator revoked, a listing suspended, a listing allowed again. Each has the action, who (`actor_kind`: `cli` for the two grants and revocations, `platform_admin` with the person's id and address for moderation), the target, an optional reason, a small `metadata` object (never a secret) and the time. It is **immutable**: a row trigger refuses `UPDATE` and `DELETE` and a statement trigger refuses `TRUNCATE`, for every role including the owner, and the runtime role has no privilege on the table at all. A tenant cannot write it, and a business never sees it. (Removing it requires dropping the trigger, which is a schema change that shows in a migration.)

### Empty and zero data

The console works on a database that was only migrated: no organization, user, listing or review, and no administrator. Nothing seeds a platform administrator or any business in production; the development seed does not create one either. A test serves a freshly migrated, unseeded database with a second server and checks every page.

### Tests

`platform-admin-database.spec.ts` (the tables closed to the runtime role, function privileges and shapes, authority for every kind of caller, search escaping, moderation semantics and concurrency, audit immutability), `platform-admin-cli.spec.ts` (the three commands as an operator runs them; signup cannot assign), `platform-admin-routes.spec.ts` (anonymous, every kind of member, forged claims, an administrator with and without a business, revocation, a customer's domain, and that no workspace page, RSC payload or script carries the console), `platform-admin-console.spec.ts` (sign-in, real figures, search and paging, the moderation flow end to end including what the business and the public see, the Server Action replayed by people who must not run it, accessibility, contrast and a phone width), `platform-admin-empty.spec.ts` and `platform-admin-boundary.spec.ts` (the import graph in both directions, the query module naming no table, authority asked first, no impersonation). The existing boundary and inventory specs were updated for the new group.

### What this does not do

- No tenant impersonation, no editing of a business, no account or password management, no billing, no email.
- **No notification to a business** whose listing is suspended: it sees its listing as published, and cannot tell why it is not public. Telling the business (and an appeal path) belongs with the public Marketplace.
- **No review moderation** (above), and no moderation of a Site: the Marketplace listing is the only thing the platform can hold back.
- The console has one role (`super_admin`); there are no narrower platform roles, no two-person approval and no session-length limit beyond Better Auth's.
- The first administrator needs an operator with the owner's database credential.

### What Phase 19B must change for the public landing

*Update (Phase 19B).* §37 built what this subsection asked for except the landing page: the public Marketplace index and its Service and place pages, the SEO surface (sitemap, robots, canonical and `noindex` rules) that honours suspension, a public display of reviews (with the visibility switch it needs; collection and moderation are not built), and a notice to a suspended business that says THAT and never why. What follows is the list as it stood; §37 ends with what is left for Phase 19C.

The public landing (`/` → Marketplace → Business signup → Business login) is **not built** in 19A. When it is:

- `/` is the signed-in workspace's Overview today (an anonymous visitor is sent to Log in). It must become a public landing page for visitors, with the workspace Overview moved or branched by session, and the proxy's rules (`PUBLIC_PREFIXES`, `AUTH_PAGES`), the route inventory, the sidebar's "Overview" and every `next=/` redirect updated with it.
- `/listings` is "not found" today (only `/listings/<address>` exists). A public **Marketplace index** needs a public list function in the family of the seven public functions (and the public-boundary and function-count specs updated), and it **must exclude suspended listings the same way `app_public_listing` does**, or moderation would not hold on the index.
- "Business signup" and "Business login" are today's `/signup` and `/login`; the landing must link them with their purpose clear, and the separate **platform** sign-in at `/platform-admin/login` stays unlinked from any public or workspace page.
- Telling a business its listing was suspended, and why it may say so, needs a design (and a tenant-visible field that is not the internal reason).
- Public reviews, and with them review moderation and the audit actions for it.
- The listing's SEO surface (`sitemap`, `robots`, structured data) must honour suspension.

## 37. The public Marketplace (Phase 19B)

Phase 19B turns the per-business Marketplace listing of Phase 15 into a customer-facing discovery experience: a visitor with no account says what they need and where, sees the providers that really offer it there, opens a provider's profile and books. It adds no second data model. It reuses Organizations, listings and their selected Services, Reviews, Branding, Bookings and the platform moderation of §36, and adds only what discovery needed that did not exist: **where a business works** (service areas), **which reviews may be public**, and **where a booking came from**. This section says what the pages are, how the data is shaped and protected, how a search is matched and ranked, what the public can and cannot see, how bookings are attributed, how moderation interacts, what a search engine is told, how a business configures all this, and what Phase 19C needs.

### The rule: Marketplace visibility = tenant published AND platform allowed

A provider appears anywhere in the Marketplace (search, a Service or place page, its profile, its booking page, the sitemap) only when **all** of these are true, decided in one SQL function (`app_marketplace_match`) and repeated nowhere else:

1. its business has the listing **published** (`marketplace_listings.status = 'published'`), and
2. the platform has **not suspended** it (`platform_listing_moderation`, where no row means allowed), and
3. it shows **at least one active, public Service** (a selected Service that is still active and not internal).

Neither side alone is enough, and neither can override the other: a business cannot publish past a suspension, and the platform allowing a listing again publishes nothing. A suspended or hidden provider is not "greyed out" anywhere: it is absent, with the same answer as an address that does not exist, and the business's own data (the listing, its text, Services, areas, reviews, bookings) is exactly as it was, so lifting a suspension restores the provider **only if the business still has it published**. A test walks all four combinations and the transitions between them (`marketplace-discovery.spec.ts`).

### Routes

| Address | What it is |
| --- | --- |
| `/marketplace` | the public index and search: `?q=` words, `?service=`, `?location=`, `?booking=`, `?category=`, `?page=` |
| `/marketplace/services/<service>` | the providers that list one Service (the Service's own address, e.g. `ac-repair-diagnostics`) |
| `/marketplace/locations/<place>` | the providers that listed one place: `austin-tx`, or a five-digit ZIP |
| `/marketplace/services/<service>/<place>` | the providers that list the Service **and** work in the place |
| `/listings/<address>` | a provider's profile (unchanged address; upgraded page) |
| `/listings/<address>/book/<service>` | the Marketplace booking page for one of the provider's Services |
| `/sitemap.xml`, `/robots.txt` | for crawlers (below) |

**The tenant screens moved.** `/marketplace` used to be the signed-in business's own Marketplace screen. The public index needed that address, so the business's screens are now `/marketplace-listing` (overview), `/marketplace-listing/edit` and `/marketplace-listing/preview`. The sidebar still says "Marketplace". They are workspace pages (session required, `marketplace:manage` to edit); nothing under `/marketplace` is.

All of `/marketplace…` and `/listings/…` live in the `(public)` route group of §30: **no workspace provider, no session read, no cookie, no tenant context**, `force-dynamic`. `proxy.ts` leaves `/marketplace` (the exact path and everything under it) public; `/marketplace-listing` is not, because the prefix match needs the slash. **On a customer's own domain none of it exists**: the proxy rewrites every path on a customer's host to that customer's site, so `/marketplace`, `/listings/…`, `/sitemap.xml` and `/robots.txt` there are paths the site does not have, and an unknown host is "not found". There is **no fallback** from a customer's name, an unknown name or an empty search to the platform's Marketplace or to any sample business (a test requests every one with the Host of an active claim and of a name nobody owns).

### The service-area model

A business states where it works as rows of `marketplace_service_areas` (migration `0024`), one per place, in the order it gave them, belonging to its one listing (composite foreign key `(organization_id, listing_id)`, `ON DELETE CASCADE`):

- A row is **either a city with its US state (`city` + `state_region`, two capital letters) or a five-digit `postal_code`, never both and never neither** (a check). It may have a display `label` ("South Austin", 1 to 60 characters, plain text) that customers read instead of the city or ZIP. There is no free-form text that a search could be confused by.
- `city_key` is a **generated column** (lower case, apostrophes and periods dropped, hyphens and runs of spaces as one space) so "St. Louis", "st louis" and "ST LOUIS" are one place and no writer can store a key that disagrees with the name. A unique index over `(listing, city_key, state, postal_code)` refuses the same place twice, however it was typed. At most **fifty** per listing (a trigger). The TypeScript `cityKey()` in `lib/marketplace-discovery` computes the same key, and a test holds the two to each other for every spelling.
- **A business's headquarters address is not coverage.** Only what a business lists is claimed. A listing with no areas is found by Service and by name, **never by a place** (a place filter, or a place word in a search, matches only a configured area), and its card says "Not listed" rather than implying anywhere.
- Matching is **exact on the normalized keys**: a ZIP equals a ZIP; a city equals a city (in the state asked for, or any state when none was given). There is no radius, no geocoding and no distance. **The seam for them is a new kind of row** (a "radius" kind with its own columns would sit beside "city" and "postal"), and the single SQL function that says whether an area matches a search (`app_marketplace_match`) is the one place that would learn it. Nothing else knows what a "kind" is.
- Row Level Security: members of the active business **read**; only owners and admins **insert and delete** (rows are replaced as a set when the listing is saved); there is no update. A forged `listing_id` of another business fails the composite foreign key; a member's insert fails the policy; a visitor reads the table through no policy at all (the public functions are the only door).

### The reviews that may be public

`reviews.visibility` (`private`, the default, or `public`) and `made_public_at` (set by a trigger the moment a review becomes public) say which reviews may be shown on the profile and counted in a public rating. **No workspace screen or Server Action can change it**: the runtime role has `SELECT` on `reviews` and nothing else, so a business cannot curate its own rating, and a customer-consent step (a later phase) is the only writer there will be. The single predicate `app_review_is_public(review)` is the definition of an eligible review and is used by every public path, so review moderation, when it exists, narrows it **there and nowhere else**. The seeded sample reviews are marked public (test and development data only); a new business has none.

A public review is projected as a rating, its text and its date, and the reviewer as **"First L."** (`app_reviewer_display_name`; a single name stays as it is; nothing becomes "Customer"). The full name, email, phone, job and customer ids never leave the database on a public path. A provider's rating is the average of its **public** reviews to one decimal, and the count behind it; a provider with none says "No reviews yet". Nothing is estimated, defaulted or shown to look better.

### The public discovery model and the data projection

The Marketplace never reads a table. It calls **five more narrow `SECURITY DEFINER` functions** (fixed `search_path`, `EXECUTE` revoked from `PUBLIC` and granted to `climvia_app` alone), beside the existing public functions, so the visitor's door runs **twelve** functions in all (the server-boundaries spec lists them by name):

- `app_public_marketplace_search(tokens, service, location, booking, category, page, size)` → `{ total, page, pageSize, results[] }`;
- `app_public_marketplace_facets(…)` → the Services, places, types of work and ways of booking that really exist **given what is chosen** (each list leaves out its own filter, and counts providers);
- `app_public_marketplace_sitemap()` → the discoverable providers and the Service, place and Service-in-place pages that have at least one;
- `app_public_listing(address)` (replaced) → the profile, now with service areas, rating and the ten latest public reviews;
- `app_public_listing_booking(address, service)` → what the booking page needs for one Service of one listing; and the booking writer `app_public_create_marketplace_booking(…)` (below).

**A card is built field by field**: the listing's address, the business's public name and description, its logo's asset id, its rating, the Service the search matched (its name, category, price and way of booking), how many Services it shows, its types of work, up to four of its areas (the one searched for first) and whether the matched Service can be booked online. **No organization id, listing id, user id, email, phone, internal Service id, moderation state or reason, reviewer name or customer** is in any projection; a test compares the exact key set of every card, service, area, rating and review, and scans the serialized answer for every kind of secret. On the profile, a contact detail the business turned off is **absent from the answer**, not hidden by CSS; the hours the profile shows follow the same switch, while the booking page still gets the hours it needs to offer slots.

The application parses each answer again (`src/db/public-queries.ts`) and draws it; `src/server/public-site.ts` memoises each reader for **one request** on primitive arguments, so a page and its metadata ask once and nothing is shared between visitors.

### Search: what is matched, filtered and ranked

A visitor's words are **tokenized by deterministic code** (no `Intl`, no locale): lower case, letters and digits only, filler words dropped, no repeats, at most eight words of at most forty characters. The database cleans them again (`app_marketplace_tokens`), so what reaches a query is only `[a-z0-9]{1,40}`: a hostile search is ordinary words or nothing, never SQL, a pattern or an error (tests send injection strings, regular-expression characters, `%`, `_`, backslashes, NUL, emoji and 5,000-character searches). **Every word must be found**, matched from the **start** of a word in: the business name, the name or type of one of the Services it **shows**, or one of its configured areas (city word, state code or ZIP prefix). A Service the business does not show, and a Service that is internal or switched off, is not matched.

Filters (each in the address): a **Service** (by its address), a **type of work** (the five categories), a **way of booking** (a fact about one Service that is bookable online, on a listing that offers booking: the same Service must have both) and a **place** (a ZIP, a city and state, or a city). A filter value that is not valid **matches nothing**; it is never an error. "Availability" is deliberately not a filter: Climvia does not know a provider's real availability, so it claims none.

**Ranking is deterministic and has no invented signal.** Hard filters first; then, in order: how many of the words matched a shown Service, how many matched the business name, the average **public** rating (no reviews last), the number of public reviews, the business name, and the listing id as the last tie-break. Nothing is sponsored, boosted, randomised or time-dependent, and the same search is the same list every time. **Pages hold twelve providers** (the SQL clamps size to 1..24 and the page to 1..100), each page has its own address, a page past the end says so, and a page number that makes no sense is the first page.

Where the search is made: PostgreSQL only (indexes on the area keys, the ZIP and the listing's Services; narrow projections; the counts and facets are four set queries, not one per provider, so there is no N+1). There is no external search service, and none is needed at this scale.

### Pages, SEO and what a crawler is told

- A search with words or filters has an address that can be shared; a search that only names a Service and/or a place **redirects to the clean page** (`/marketplace?service=ac-repair&location=78704` → `/marketplace/services/ac-repair/78704`), and empty parameters are tidied away.
- **Indexable**: the Marketplace itself, and a Service, place or Service-in-place page that lists at least one provider and is the first page. Each has a title (`HVAC service in Austin, TX · Climvia Marketplace`), a description built from the **real** number of providers, and an absolute `canonical` on the platform's origin (`BETTER_AUTH_URL`). **`noindex`**: a search with words or filters, a later page, a place that was not understood, and any page with nobody on it. An address that is not a Service or a place at all (malformed, upper-case, too long) is the plain "not found" with status 404, not an empty page. A profile is indexable with its canonical set to its own address, whatever a visitor was looking at when they arrived (the query it carries is not a different page); a booking page is `noindex`.
- **`/sitemap.xml`** lists `/marketplace`, the Service pages, the place pages, the Service-in-place pages and the profiles **that the discovery function says exist**: a suspended, hidden or unpublished provider is in no entry, and no combination is made up (a Service and a place appear together only when one provider has both). It is bounded (5,000 profiles, 500 Services, 500 places, 2,000 combinations), contains no search page and no query string, and is a different answer after every change because it is never cached.
- **`/robots.txt`** allows `/marketplace` (exactly), `/marketplace/`, `/listings/`, `/sites/` and `/assets/`, disallows everything else, and names the sitemap. The workspace, the console and the sign-in pages are not offered.
- **Not built:** structured data (JSON-LD). It is a later, separate decision, because it would restate a rating and prices as claims to a search engine.

### The pages themselves

The design is the product's own ("warm operational clarity": linen canvas, deep teal, Inter), pushed to be consumer-facing. A teal hero carries the search (**What do you need? / Where?**), the Service and place chips are the real facets, and each provider card is a **nameplate**, the rating-plate of an air handler: four ruled cells (Rating, Price, Booking, Serves) of facts the provider really has. A card that does not have a fact says so ("No reviews yet", "Not listed", "Not online"). There is no "Verified", no badge, no availability, response time, provider count, savings, urgency or AI claim anywhere; a test scans the page for those words. The filters are ordinary links (each a search of its own, the one in use marked `aria-current`) and fold behind one button on a phone; the search is a plain `GET` form that works before any script has run; every control is reachable and operable with the keyboard; focus is visible; nothing animates beyond a colour change, and reduced motion is respected. Every page is held to the structural and contrast checks of the route crawl (`accessibility.spec.ts`), has no sideways scroll at 390 px, and logs nothing to the console.

### The profile

The profile is the Marketplace's page about a business: its logo and name, its rating (a link to its reviews), its description, the Services it shows each with its price, length and a **Marketplace booking link** (for a Service that is bookable online, when the listing offers booking), the places it works, the contact details and hours it chose to show, and its public reviews. It links to the business's **website** only when the business has a published one and chose the action, and it is a different page at a different address: the profile is the directory's, the website is the business's. A business with no published website shows no website or contact button at all (not a button that goes nowhere). Where the visitor came from (the Service and place on the results page) rides on the address of the profile and its booking links, validated as addresses, and nowhere else.

### Booking from the Marketplace, and its attribution

A Marketplace booking uses **the existing public booking architecture** and a second, equally narrow door:

1. The page (`/listings/<address>/book/<service>`) reads the one Service through `app_public_listing_booking`: the listing must be published, not suspended and offering booking, and the Service one that listing shows **and** the business offers for online booking; anything else is "not found".
2. The journey is the same `BookingJourney` the website uses (same slots, same intake, same confirmation), so the rules cannot drift; it names no business.
3. `submitMarketplaceBookingAction` has **no session by design** and is held to the same order as the website's: parse the request, rate-limit the visitor's address (a key of its own), look up the listing **as a visitor sees it**, check the slot against that business's hours, and only then write. It refuses a customer's own domain. **It names a listing and a Service and nothing else**: not an organization, a source, a status or a number; extra fields in the request are not read.
4. `app_public_create_marketplace_booking` finds the business and the Service **from the listing** and writes through `app_insert_public_booking`, the one internal function that writes a public booking (shared with the website's booking function, never executable by the runtime role): its `source` is chosen **by the function** (`Marketplace`), never by a request. The booking is the business's own, with no customer record, no job, quote, invoice or payment, and no payment is taken. A repeat of the same submission or of the same person asking for the same time is the first booking.

**Attribution is persisted and server-derived** (migration `0024`): `bookings.marketplace_listing_id` (a composite foreign key that is cleared, not cascaded, when a listing is deleted: the booking and its source stay) and `bookings.discovery_service` / `discovery_location` (what the visitor was looking at: kept only if they have the shape of an address, informational, never used to decide anything). The business sees the source in its Bookings and a **Marketplace bookings** count on its Marketplace screen, counted from the stored bookings (all that are recorded as coming from the Marketplace, whatever their age). **The Analytics module is unchanged** and its canonical baseline is untouched: it reports no booking source today, and no history is invented. A booking made through the website stays a Website booking. Notifications, payments and commissions do not exist here.

### How a business configures its listing

The business's own page (`/marketplace-listing`, edit at `/marketplace-listing/edit`) manages: the description and cover; which contact details show; the **Services shown** and their order; the **Service areas** (add a city and state or a ZIP, optionally name it, change, reorder and remove; a form that checks each place as the server does and says what to fix: "choose a US state for the city", "Austin, TX is already listed", "enter a five-digit US ZIP code"); the customer actions; and published or hidden. Owners and admins edit (`marketplace:manage`); a member reads, sees the areas and the Marketplace bookings count, and the edit address sends them back. The server parses the whole configuration again, replaces the Services and the areas as sets in **one transaction** under a lock on the listing row, and answers with what was stored; forged ids of another business have nowhere to go (the request carries none). The unsaved-changes guard covers the areas like everything else on the page.

When the platform has suspended the listing the business sees **that**, not why: a badge ("Suspended by Climvia"), a notice that customers cannot find, open or book from it, that its content is saved, and that publishing again will not make it public until the suspension is lifted. **The internal reason, the administrator and the time are never sent to the business's pages** (`app_listing_suspended()` returns a boolean, for a member of the active business only; the runtime role has no privilege on the moderation table). There is no email or notification, and no appeal path (Phase 19C). *Update (Phase 19C).* §38 added the message the platform chooses to send (still never the internal reason) and a request for a second look; there is still no email or notification.

### The Platform console

Marketplace Listings now shows, for every listing, the Services it shows, the **service areas** it listed, whether it is **in the Marketplace** (published, allowed and showing a Service), and a link to its **public profile** while it has one; the suspend and allow actions are unchanged and remain the **only** write authority over a listing's public availability. Reviews shows whether each review is public or private (read-only: hiding a public review is not built).

### Tests

`marketplace-discovery-rules.spec.ts` (every normal form, the parsing, tokenizing, addresses and the database's city key), `marketplace-discovery-database.spec.ts` (what each public function answers and leaves out, filters, ranking, pages and their clamps, facets, the sitemap, the profile, booking and attribution, Row Level Security on the areas, the moderation record and the review table), and `marketplace-discovery.spec.ts` (the pages as a visitor and a business use them: search, filters, pages, empty and mistyped searches, clean pages, SEO, sitemap, robots, a customer's domain, the profile, booking and the replayed action, suspension everywhere, the tenant's area editor, the notice and the count, a phone, and no leakage). The route inventory, the public-boundary probe (the restricted-role server now serves the Marketplace too) and the server-boundaries pins were extended; the specs that named the tenant routes use their new addresses.

### What this does not do, and what Phase 19C needs

Not built: consumer accounts (a visitor books as a guest), payments, commissions, Stripe Connect, payouts and subscriptions; email or SMS (to a business about a booking, a visitor about a confirmation, or a business about a suspension); geographic radius and geocoding (the seam is above); an availability filter or claim; structured data; review collection, a customer's consent step that makes a review public, and review moderation; provider verification of any kind; the public landing page at `/` (the signed-in Overview still is `/`, an anonymous visitor is still sent to Log in, and "Business signup" and "Business login" are still `/signup` and `/login`); and an appeal or contact path for a suspended business.

Phase 19C needs: (1) the **public landing** (`/` for visitors, with the workspace Overview branched by session, and `PUBLIC_PREFIXES`, the sidebar, the route inventory and every `next=/` redirect updated with it), linking the Marketplace and the business sign-up and log-in with their purposes clear; (2) a way for a **suspended business to learn why and ask for review** (a tenant-visible field that is not the internal reason, and a contact path); (3) **review collection with consent**, the writer of `reviews.visibility`, and review moderation on top of `app_review_is_public`; (4) **notifications** (booking received, booking confirmed, suspension); (5) a **decision on structured data** and on the sitemap's size beyond 5,000 profiles (an index of sitemaps); (6) the AWS deployment with the proxy, TLS and DNS for the platform's own name (still deferred), after which `BETTER_AUTH_URL`'s origin is what every canonical address and the sitemap use.

*Update (Phase 19C).* §38 built items (1), (2), (3) and the structured-data half of (5) (decision: implemented, narrowly); items (4) notifications, the sitemap index beyond 5,000 profiles and (6) the AWS deployment are still open and are listed again in §38.

## 38. Public entry, review collection and suspension resolution (Phase 19C)

Phase 19C makes the first-run journey real. A visitor who opens the platform's address now sees **Climvia's own landing page**, not a sign-in screen or somebody's workspace; a business can find its way from there to the Marketplace or to a workspace of its own; a customer can write a review through a link a business gives them, and **only the customer's own consent makes it public**; the platform can hide and restore a public review; and a business whose listing was suspended can learn what Climvia chose to tell it and ask for a second look. It adds no second architecture: the entry page is one more route group, the review link and the suspension request are two more groups of narrow `SECURITY DEFINER` functions, and the single review predicate of §37 gains the one condition review moderation needed. This section says what `/` does for each kind of person, how a business is created and what it finds, how the public pages learn who is looking, how a review is collected, consented to and moderated, how a suspension is resolved, what a search engine is told, how a deployment at a single host such as `example.duckdns.org` is configured without a hostname in the code, how a customer's own domain stays isolated, and what Phase 19D must still do.

### The root route

`/` lives in a route group of its own, `(entry)`, next to `(public)`, `(signed-in)`, `(auth)` and `(platform-admin)` (§30). It mounts nothing: no provider, no shell, no active business. Its page calls `entryDestination()` (`src/server/entry.ts`), which decides **from verified records** among three outcomes:

| Who is asking | What `/` does |
| --- | --- |
| nobody (no session, no cookie) | the public landing (and no database lookup at all) |
| a member of at least one business | a redirect to `/overview`, the workspace's Overview (which moved there from `/`) |
| signed in, no business, **not** a platform administrator | a redirect to `/onboarding` |
| signed in, no business, **a platform administrator** | the public landing: an administrator needs no Organization to be on the platform |

There are no loops: `/login` and `/signup` send a signed-in person to `/`, which sends them on exactly once. `/overview` is a workspace page like any other (its own `requireWorkspaceContext()`), and a business member who wants the landing's words can read them nowhere else, by design. The landing page is **the same bytes for everyone who stays on it**: it reads no session and no data, so a platform administrator and a visitor get an identical document (a spec compares them) and nothing of a person, a business or a setting is in it.

`proxy.ts` treats `/` as public on the platform's names (a request with no cookie is no longer sent to Log in); whether to send someone on is decided by the page, against the database, never by the cookie's mere presence. On a customer's own domain the **customer's-name branch comes first** and takes every path, the root included, to the one route that serves that customer's site (§34): the landing, the Marketplace, Log in, Sign up, the review page, the session answer, the workspace and the console do not exist there, and a header any client can send chooses nothing (§31's rule, unchanged: only `Host` is read).

### The landing page

`src/components/landing/Landing.tsx`. Two doors in the hero, named for who they are for: **Find HVAC services** (`Find a Service` → `/marketplace`) and **Run your HVAC business with Climvia** (`List Your Business` → `/signup`, and `Sign in` → `/login`). Under them: the path **one service call** takes through the product (found, booked, scheduled, done, billed, reviewed: a real sequence, so an ordered list), what a business gets (the sidebar's own modules, in four groups, with what each does), and how the Marketplace works for a homeowner (a search says what and where; businesses say what they offer; a rating counts only reviews customers chose to make public). **It states no number of businesses, customers or reviews, no saving, no response time, no coverage, no "verified" or "licensed", no AI and no testimonial**: none of those is a fact the product holds, and a spec scans the page's text, and its source, for each. A capability it names is one the workspace has, by the sidebar's own name. It is held to the structural and contrast checks of the route crawl, has no sideways scroll at 390 px, and has a visible keyboard focus order that starts with the header.

The **public header** (`PublicHeader`, also on a provider's profile; the Marketplace's teal band carries the same account links) is: the Climvia mark and name (home), Marketplace, For HVAC businesses (`/#for-businesses`), Sign in and **List your business**. It never renders the workspace's sidebar, and it **never links the platform console to anyone**.

### How the public pages learn who is looking

A public page carries no session (§30), so the account links are a small client component, `PublicSessionNav`, that asks **`GET /api/session-state`** after the page has loaded. The route answers three booleans about the caller, from the verified session and the database: `signedIn`, `workspace` (an active membership) and `platformAdmin`. It takes **no parameter and no body**, names no business and no person, sends `Cache-Control: private, no-store` and `Vary: Cookie`, and sets no cookie and no CORS header (another origin cannot read it). Until it answers, and if it never does, the signed-out links are shown, which is also exactly what the server rendered, so the page's HTML is unchanged for everyone. A business member then sees **Go to Dashboard** (→ `/overview`) and **Sign out**; a platform administrator sees **Platform console** (as the main button when they have no business of their own); someone mid-signup sees **Finish setting up**. **Tenant owners, admins and members never see the console link**, because the answer for them says `platformAdmin: false`, and the console itself checks the database again on every page and action (§36).

**Sign out** from here is Better Auth's own endpoint (`authClient.signOut()`, same origin), followed by a full page load of `/`: the session row is deleted and its cookie cleared, `/overview` and every workspace page send the next request to Log in, the console's pages to its own sign-in, `/api/session-state` says signed out, and the Marketplace stays open. The active-business preference cookie (a UUID that is only ever **checked** against the person's own memberships) is left to expire; it carries no authority and nothing in the page.

### Log in, and where it may send someone

`/login` signs in an ordinary account and routes nothing special: a platform administrator who signs in there lands exactly where any person does (`/`: their dashboard if they belong to a business, otherwise the landing with its console link). The platform console keeps its own door, `/platform-admin/login`, which signs in with the same accounts and then asks the database whether the person is an administrator. The return address (`?next=`) goes through `safeNextPath`: only a plain path on this site is followed, an address with a scheme, `//`, a backslash or a control character is dropped, **and the console is never a return address** (`/platform-admin…` is refused), so a link cannot make the ordinary sign-in look as if it granted or routed anything there. Nothing about authority is ever read from a query string.

### The first business

**Sign up** (`/signup`) creates an ordinary Better Auth account with an email and a password; nothing in the request can name a role (a test posts every kind of forged claim: the account that results is ordinary and `platform_admins` is untouched, because the only writer is the command-line tool of §36). **Set-up** (`/onboarding`) collects only what a business needs to exist (name, phone, business email, address, time zone, hours; nothing about the Website or the Marketplace is asked) and then creates, in one transaction, the Organization, the person as its **owner**, the weekly hours and a first, private Site. **It creates nothing else: no customer, Service, booking, job, quote, invoice, payment, plan, review, campaign, listing or domain, and it copies nothing from the sample business.** The person lands on `/overview`, which for a business with nothing in it is a welcome with five optional next steps (add services, set up the team, check business hours, customize the website, publish the Marketplace listing), none of them a gate.

Every one of the sixteen workspace pages was checked on a database that was only migrated (`public-entry-empty.spec.ts`): each opens, has its heading, shows no sample name or record, no invented figure and no console error, and nothing runs off the screen. A business with no listing has no Marketplace presence; a Marketplace with no providers says so.

### Review collection

A review request (`review_requests`, §26) now carries a **link**. The application makes a random secret (32 bytes, 43 URL-safe characters, `src/lib/review-link.ts`), stores **only its SHA-256** (`token_hash`, unique, 64 lowercase hex characters, with an expiry; both enforced by a check), and shows the link to the business **once**, in the step after the request is recorded; it is not stored, not logged and not in any later answer. Nothing is sent: the business copies the link and gives it to the customer, and the screen says so. A request recorded before links existed has none ("No link"); a business can make a **new** link for a request whose link was lost or ran out (`app_reissue_review_link`, owners and admins, a definer function because the runtime role has no `UPDATE` on requests): the old secret stops working at once. A link lasts 30 days (the database refuses more than 90) and works once (`status` becomes `completed`, with a `completed_at`, and `reviews.request_id` is unique).

The customer opens `/review/<secret>` (in `(public)`: no session, no workspace, `noindex`, `Referrer-Policy: no-referrer` through the page's metadata, never cached). The database looks the secret up **by its hash** (`app_public_review_request`) and answers whether the link can be used, the business's name and the name the review would be shown under; a secret that is not a link, in any way, is the same plain "not found". The form collects a **rating** (1 to 5), **words** (1 to 2,000 characters) and **a consent to show the review publicly**, a checkbox that starts **unchecked** with the words: the review appears on the business's public Marketplace profile with the rating, the words and the date, under the customer's **first name and last initial** ("it is not anonymous"); it counts toward the public rating; the business always sees the full review; and unchecked, the review stays private. `app_public_submit_review` locks the request, checks it is open, writes the review (**customer, Job, business and date taken from the request, never from the form**; the date is the business's calendar day in its own time zone) with `visibility = 'public'` **only for an explicit yes**, and closes the request in one transaction, so ten people opening one link write exactly one review. The Server Action parses the form again (public display needs the string `"yes"`: a boolean, an array, `YES` or an empty value is no), refuses a customer's own domain, and is rate limited by address and by link; it names no organization and no customer. A business cannot make a review public, private or shown in any other way: the runtime role can `SELECT` reviews and nothing else, and no workspace screen offers it.

The business sees each review as **Private**, **Public on Marketplace** or **Hidden from Marketplace by Climvia**, and the requests with where each link stands (active, expired, review received, no link).

**The secret stays out of the proxy's log.** A review link's address is its secret, so the access log of the container deployment (`deploy/caddy/Caddyfile`, `(access_log)`) writes `/review/<secret>` as `/review/REDACTED`, in the request address and in a `Referer` that carries it (the review page also sends `Referrer-Policy: no-referrer`). The application never logs the secret, and a spec fails if its action does.

### Review moderation

The platform can **hide** a review the customer made public and **restore** it (`platform_review_moderation`, one row per decided review, no row meaning visible; RLS on, no policy and no privilege for the runtime role; reached only through `app_platform_set_review_moderation`, which starts with the administrator guard, takes a per-review advisory lock, writes the decision and its audit event in one transaction, and refuses to "hide" a private review). The internal reason is for administrators; the business is told **which** of its reviews is hidden (`app_hidden_review_ids()`, its own, ids only), never why. **Nothing is deleted or rewritten**: the review, its words, its reply and its place in the business's Reviews are exactly as they were, and restoring puts it back. `app_review_is_public` (§37) remains the one predicate behind a profile's reviews, its rating, its count and a search card's rating; it now also excludes a hidden review (and is therefore `SECURITY DEFINER`, because it reads a table the runtime role cannot), so a hidden review leaves all four at once and a restored one returns to all four. Specs assert the exact averages and counts through hide, restore and private reviews, on a profile and in a search.

### Suspension resolution

A suspension (§36) now carries two different texts and a small lifecycle, all on the existing moderation row (migration `0026`/`0027`):

- the **internal reason** (administrators only, never sent to a business's pages) and the **message to the business**, a separate field written for it (what was seen, what to change), plus when the suspension began. `app_listing_suspension()` is what the business's pages read: the message, the time, and where its request stands, for a member of the active business; it has **no** reason, no deciding person and no audit. The old yes/no `app_listing_suspended()` remains.
- a **request for a second look**, `none → requested → resolved` (as `kept` or `lifted`). An owner or admin asks with a note of up to 500 characters (`app_request_listing_review`); it records who and when, changes **nothing about whether the listing is public**, and cannot be repeated while one waits; after the platform keeps a suspension the business waits a day before asking again (the answer says about how long). It uses the same advisory lock as the platform's own decisions.
- the platform sees the waiting requests **first** (the Overview's "Review requests waiting", a banner and the top of the Marketplace listings, the business's note beside the listing) and answers: **Keep suspended** (with a message that becomes what the business reads) or **Allow again**, which also answers a waiting request as `lifted`. A message can be edited while the suspension stands. Allowing a listing again makes it public **only if its business still has it published** (the rule of §37 is unchanged). A new suspension starts a fresh lifecycle.
- every step is an audit event (suspended, message changed, review requested **by an organization member**, review answered, allowed again), append-only as before; the System page names them. A business **cannot unsuspend itself**: the moderation table has no privilege for the runtime role, and every function that changes it starts with the administrator guard (the request function checks owner or admin of the *active* organization).

Email, SMS and in-app notifications **do not exist**: a business learns of a suspension and its answer on its Marketplace screen, and the platform learns of a request on its own pages. Delivery is deferred (Phase 19D).

### What a search engine is told

The landing is **indexable** (title `Climvia · Find HVAC service. Run the business behind it.`, a description, a canonical address built from `BETTER_AUTH_URL`, never from the request) and is the first entry of `/sitemap.xml`; `robots.txt` adds `Allow: /$`. Log in, Sign up, set-up, the workspace and previews, the platform console and its sign-in, and a review link carry `noindex, nofollow`, and `robots.txt` still disallows everything it does not allow. The Marketplace's rules (§37) are unchanged.

**Structured data (decision: implemented, narrowly).** The landing carries an `Organization` and a `WebSite` with a `SearchAction` aimed at `/marketplace?q=`. A provider's profile carries an `HVACBusiness` with the name, address (a canonical one), description, and **only the details its business chose to show** (a telephone number or an address that the listing switched off is absent), and an `aggregateRating` **only when the provider has at least one review a visitor can see right now** (the single predicate), never a rating without reviews, never a price, a service area it did not list, opening hours, or a claim like "best". The script text is escaped so that no business name can close the tag (`</script>` and the line separators); a spec round-trips a hostile name. Individual reviews are not marked up.

### A single host, and the names the platform answers on

Nothing in the application names a deployment's hostname (a spec fails if a free DNS provider's name appears in `src`). **The platform's own names are configuration**: the host of `BETTER_AUTH_URL` and the optional `APP_HOSTS`, and nothing else (Phase 19D removed the last assumption of a product domain; §39). To deploy at `https://example.duckdns.org` set `BETTER_AUTH_URL=https://example.duckdns.org`, give `CUSTOM_DOMAIN_TARGET` a *different* name (for example `sites.example.duckdns.org`, which is never claimable because it sits under the platform's own name) and the other settings of §35: the landing, the Marketplace, sign-up and Log in then all work under that one host (`/`, `/marketplace`, `/signup`, `/login`, `/overview`), with no wildcard name needed. Businesses' websites stay at `/sites/<address>` and profiles at `/listings/<address>`. `classifyHost` calls the configured host (and `localhost`) the platform's, any other multi-label name a customer's candidate, and refuses a claim on the platform's own name or anything under it; a spec runs those rules with a `duckdns.org` configuration. The seams for a later `app.<domain>`, `<site>.<domain>` and customer domains are untouched: adding a name is adding it to `APP_HOSTS`. **Not deployed, and nothing about AWS was done in this phase.**

*Update (Phase 19D).* The Website screens no longer display `<address>.climvia.com`: a Site's address is written from the same configuration, `<origin>/sites/<address>` (§39).

### Tests

New: `entry-rules.spec.ts` (return addresses, the host rules with a single-host configuration, the production rules, structured data, the secret, the review form's parsing, and the source's claims about the landing and the entry module), `entry.spec.ts` (`/` for a visitor, a member, an account with no business, an administrator with and without a business; byte-identical pages; the session answer; the header and sign-out; open-redirect attempts; the customer's-domain root; robots and sitemap; mobile and keyboard), `review-collection-database.spec.ts` and `suspension-lifecycle-database.spec.ts` (every function as the runtime role: grants, definer settings, the shape constraints, tokens, expiry, replacement, races, cross-business attempts, exact rating arithmetic through hide and restore, every transition of the lifecycle and its audit events), `review-collection.spec.ts` and `suspension-lifecycle.spec.ts` (the journeys in a browser, with forged replays), and `public-entry-empty.spec.ts` (a database with nothing in it: the first user, the first administrator, the first listing, a guest booking, a review, a suspension). The route inventory, the boundary specs, the platform specs and every spec that named `/` as the Overview use the new addresses. At the end of the phase the whole suite was 3644 tests in 126 spec files, none failing and none skipped.

### What this does not do, and what Phase 19D must still do

Not built: email or SMS (a business is not emailed its review link, a customer is not reminded, a business is not told of a suspension or its answer), consumer accounts, a customer editing or withdrawing a review, a business replying publicly through the Marketplace, review verification of any kind, a ticket system for appeals (one request and one answer, on purpose), impersonation, and any AWS or DNS work.

Phase 19D needs: (1) **delivery**: sending the review link by the channel the request names (an email and SMS provider, with consent, bounce and unsubscribe handling, which is the real reason a link stays valid for 30 days), and notifying a business of a suspension and its answer; (2) the **AWS deployment** and DNS for the platform's own name (still deferred; a Site's displayed address already follows `BETTER_AUTH_URL`, §39); (3) a decision on **review disputes** by businesses (the platform hides reviews today; a business cannot ask for one to be looked at) and on the sitemap's size beyond 5,000 profiles; (4) an operational view of the review-request backlog if the volume warrants it.

## 39. Release qualification (Phase 19D)

Phase 19D adds no product feature. It closes the local launch blockers that Phases 18 and 19 left, and it proves the result on the production-shaped stack, so that the build in this repository can be taken to a host later without a change to the source. This section says what changed, what the initial deployment looks like, how each claim was proved, and what is still a deployment task or a known limit.

### A Site's address belongs to the deployment

Before this phase the Website, Pages, Domain and Overview screens, the Business information card, the Marketplace listing and the copied booking link wrote a Site's address as `<slug>.climvia.com`: a name that nothing routed and that the product does not own. Now every one of them writes it from the deployment's configuration, in one place:

- **`<origin>/sites/<slug>`**, where the origin is the scheme, host and port of `BETTER_AUTH_URL` (`siteAddressing()` in `lib/domain-config`, `platformSiteUrl()` in `lib/site-domain`). On a deployment at `https://<name>.duckdns.org` a Site is at `https://<name>.duckdns.org/sites/<slug>`; on the test server it is `http://localhost:3460/sites/<slug>`. With no usable origin it is the path alone, never an invented host.
- A Site with an **active, primary custom domain** shows that instead (`<CUSTOM_DOMAIN_URL_SCHEME>://<hostname>`), as before; the platform address stays beside it and is never replaced.
- The state sent to the browser carries the addressing (`DomainState.addressing`, set by the one server function that loads a business's website), so a client component never reads the environment and never guesses.
- The booking link the Bookings screen copies is the Site's address plus its Booking page, and it opens that page.

**No product domain is assumed anywhere.** `PLATFORM_DOMAIN` and `platformHost()` are gone, and `HostConfig` no longer has a platform domain: the platform is **exactly the names a deployment lists** (`APP_HOSTS` and the host of `BETTER_AUTH_URL`, each with everything beneath it, and `CUSTOM_DOMAIN_TARGET`), plus `localhost`, IP addresses and one-label names. A name under the product's own domain is a customer's candidate, and then nothing, unless the deployment lists it. The one remaining mention is `BRAND_DOMAIN = "climvia.com"` in `lib/hostname`: a **reservation** (a business may not claim it or anything under it), which the database also enforces with the CHECK `site_domains_hostname_reserved` (migration 0019, mirrored in `db/schema/sites.ts`, which cannot change without a migration). No address is built from it and no request is routed because of it. `release-rules.spec.ts` fails if `climvia.com` appears anywhere that ships other than those two places, if a module joins a slug to a domain, or if a hostname of a free DNS provider appears in the source or in the example configuration.

**A purchased domain later is configuration plus one piece of routing.** Adding the domain to `APP_HOSTS` makes it and everything beneath it the platform's and reserved. Serving `<slug>.<domain>` would additionally need a host-to-Site route and a wildcard certificate; it is not built, and `siteAddressing`/`getPrimaryAddress` are the one place the displayed form would change.

### The initial deployment shape

One platform hostname, path-first. For an origin of `https://<name>.duckdns.org`:

| What | Address |
| --- | --- |
| Climvia's public landing | `/` |
| The Marketplace | `/marketplace`, `/marketplace/services/<service>`, `/marketplace/locations/<place>` |
| A provider's profile and its booking page | `/listings/<slug>`, `/listings/<slug>/book/<service>` |
| A business's published Website | `/sites/<slug>`, `/sites/<slug>/<page>` |
| Sign up, Log in, set-up | `/signup`, `/login`, `/onboarding` |
| A business's workspace (signed in) | `/overview`, `/customers`, `/bookings`, … |
| A customer's review form (a secret link) | `/review/<secret>` |
| Platform Admin (separately protected) | `/platform-admin` and its own sign-in `/platform-admin/login` |
| Probes | `/health/live`, `/health/ready` |
| A customer's own domain (optional) | the root of that name; only the customer's Site and Booking |

Configuration needs no source edit: `BETTER_AUTH_URL=https://<name>.duckdns.org`, `PUBLIC_HOST=<name>.duckdns.org`, and `CUSTOM_DOMAIN_TARGET` set to a **different** name (for example `sites.<name>.duckdns.org`; it is only shown in a custom domain's DNS instructions and can never be claimed). Custom domains are optional and can be absent at launch.

### The host matrix

`host-matrix.spec.ts` asks the running server every kind of Host about every kind of path, and the Docker part 3 repeats the customer-domain half through the real proxy.

| Host | Landing, Marketplace, profile, `/sites/<slug>`, Log in, Sign up | Workspace, set-up | Console | Review page, session answer, API, health, certificate question | Its own Site |
| --- | --- | --- | --- | --- | --- |
| The platform's name (or `localhost`, an IP address) | served | redirected to Log in | redirected to the console's sign-in | the review page is a plain not found unless the secret is a link; the rest answer or refuse as designed | `/sites/<slug>` |
| A customer's **active** domain | plain not found | plain not found | plain not found | plain not found (also with a valid session cookie, a POST, or the certificate secret) | served at the root |
| A pending, verified, disabled, removed or unknown name; a lookalike of the platform's; a name that is not a name | plain not found, root included | same | same | same | none |

Only the `Host` header chooses. `X-Forwarded-Host`, `Forwarded` and the like are read by nothing, in either direction (proved on both host kinds). The platform's `/internal/tls-allow` answers only with its secret, and on a customer's name it does not exist.

### Proof on the production stack

The Docker suite (`npm run test:docker`, 80 tests in nine files numbered 01 to 10 (the lifecycle part, once 04, runs last as 09), one worker, a database that starts empty) is the qualification of the build as it ships:

1. `01-fresh` an empty database, the restricted role, the hardening, the networks, the migration safe to repeat.
2. `02-business` an anonymous visitor finds the landing and an empty Marketplace; the first person signs up from **List Your Business**, sets a business up and lands on a workspace with nothing in it but five next steps; a Service, the modules, logos through `sharp`, a published Site.
3. `03-domains` a customer's domain through the real proxy and real handshakes.
4. `05-platform-admin` an ordinary account (the first one included) is no administrator; the tool in the tools image grants and revokes; the console works while it lasts.
5. `06-public-entry` the landing through the proxy, and a review link's address is `REDACTED` in the proxy's log.
6. `07-marketplace-journey` the first business sets the Marketplace up with a place and publishes; a visitor finds it; three guests book and each booking is attributed (Marketplace, the listing, what was searched for); three review links are shown once, stored only as SHA-256, thirty days, one use; a yes (an unchecked box) makes a review public and the rating counts only public ones; an administrator hides and restores a review and the rating follows; a suspended listing is gone from search, profile, booking page and sitemap, the business reads the message and not the reason, asks again, and **asking lifts nothing**; revoking closes the console at the next request; no secret is in any log (the proxy's log writes the address as `REDACTED` and drops the two headers the framework's navigation sends with it, `Next-Url` and `Next-Router-State-Tree`, which the first run of this part found carrying the secret).
7. `08-backup-restore` below.
8. `09-lifecycle` below. 9. `10-images` below.

### Backup and restore of the current schema

`db:fingerprint --compare` now digests, besides every table's rows, **sixteen kinds of object that protect the data**: columns, constraints, indexes, triggers, Row Level Security switches and policies, functions (their SECURITY DEFINER flag, `search_path`, owner, privileges and body), table and column privileges, schema and default privileges, sequences, enum types, extensions and the migration journal. Two things PostgreSQL prints differently for the same meaning are made the same before comparing, because a drill that cries wolf is as useless as one that cannot fail: a privilege list that was never set is the owner's defaults (`acldefault`), and a CHECK constraint's expression is compared by what it says, not by how deeply its ANDs are nested (a restored copy prints `(a AND b AND c)` where the migration made `((a AND b) AND c)`; `scripts/db/constraint-text.ts`). A changed constant, operator, column or AND/OR is still a difference. When two databases differ it prints the objects that differ. `fingerprint-catalog.spec.ts` proves it can fail: it copies a migrated database and changes one thing in the copy (a revoked grant, a function made SECURITY INVOKER, a dropped `search_path`, Row Level Security switched off or forced, a dropped or widened policy, a granted privilege, a column, a constraint, an index, the journal, a row), and each change must be named.

`08-backup-restore` takes the operator's own `backup.sh` of the running stack (which, after the journey, holds the Phase 19 data: a listing with its service area, attributed bookings, public and private reviews, requests, a hidden-then-restored review, an answered suspension, an administrator granted and revoked, and the audit trail), checks that a plain-SQL dump holds no review secret and no password, restores with the operator's `restore.sh` into a database that did not exist (and refuses to restore over one that has data), compares the two with the fingerprint, and then **asks the restored database the same questions as the source, as the application's own restricted role from inside the real application container**, and requires identical answers that are also the right ones: no context sees nothing, a business sees its own rows and another business's id sees none, a write into another business is refused (`42501`), the platform tables and functions refuse an ordinary account and a revoked administrator and answer a granted one, the public functions return the public projection only (the public review, never the private one), a review link made before the backup still opens and a used one is still used, and the next booking number continues. It ends with `restore-drill.sh` itself, which must pass and leave nothing behind.

### Persistence, health and shutdown

`09-lifecycle` runs last, so everything the other parts made is protected. Its snapshot is a digest of **every table** (sessions and one-time codes aside) plus the files and the certificate, and it must be unchanged after: an app restart, a database restart, a proxy restart (the same certificate), the whole stack down and up with no volume removed, an image rebuild with the app container recreated (a new build, the same data), a graceful stop (a request in progress is finished, exit code 0, not killed), and a failed migration (the running app is not touched). With the database stopped `/health/ready` answers 503 with three words and nothing else, `/health/live` stays 200 and the container is not restarted, and readiness returns when the database does. Nothing durable lives in the application container: it is read-only, and uploads, certificates and data are on three volumes.

### The images

`10-images` looks inside the web and tools images the stack runs, from outside them, in throwaway read-only containers with no network: no environment file, dump, report, trace, upload, Git metadata, editor setting or reference design; no sample business; none of the stack's own secrets and no review secret; no cloud credential or private key in the application's own files; an environment of fixed switches only; a build history with no secret and no seed; the web image runs as `10001:10001` and the tools image as `node`. The running container is read-only, drops every capability, cannot gain privilege, publishes no port, and `sharp` re-encodes an image in it.

### Dependency review

The registry's advisories were checked for every package in the lockfile (the same request `npm audit` makes; this machine blocks Node's network access, so it was made with Python). **No critical advisory, and no high advisory in anything the runtime image holds.** Findings:

| Package | Severity | Reaches | Verdict |
| --- | --- | --- | --- |
| `esbuild` ≤ 0.24.2 (0.18.20 under `@esbuild-kit`, a dependency of `drizzle-kit`; GHSA-67mh-4wv8-2f99) | moderate | the tools image only (`drizzle-kit`, `tsx` are development tools there); not the web image | Not applicable: the flaw is in esbuild's **development server**, which nothing starts. No fix by upgrade without a `drizzle-kit` major change; left as it is. |
| `braces` ≤ 3.0.3 (GHSA-vfj7-8cjw-p6xm) | high | development only (`eslint-config-next` → `fast-glob` → `micromatch`); in neither image's runtime | Not applicable: a stack exhaustion from deeply nested patterns in a lint-time glob; no attacker-controlled pattern reaches it. |

### Known MVP limitations (documented, not scoped in)

- **Customers (resolved in Phase 19E, §40; what remains).** A business can add a customer and a guest's booking makes one, so a new business can ask for a review on its first day. What is still not there: a customer's service locations and equipment cannot be added in the application, there is no merge, duplicate view, edit or delete, and bookings made before Phase 19E that have no customer were **not** matched or backfilled.
- **Review links are handed over by the business.** No email or SMS is sent; the link is shown once and a new one can be made.
- A business **cannot dispute** a review the platform hid; it is told which one is hidden, not why.
- The Marketplace sitemap lists at most **5,000** profiles.
- The workspace is **desktop and tablet first** (768 to 1440 px, the sidebar does not collapse); the public, sign-in, set-up, review and console pages are held at 390 px.
- No consumer accounts on the Marketplace, no commission or payment, no radius or geospatial search.
- **One server**: the single-host stack is not highly available; a restart interrupts requests for seconds (a graceful stop finishes the ones in progress).

### Still a deployment task

The host and its DNS name, the firewall and ports, the certificate for the platform's name (the public ACME mode of the proxy), the `.env.production` file with real secrets, a real mailbox for `ACME_EMAIL`, off-machine copies of `backup.sh` and `backup-assets.sh` output and their schedule, log collection and an alert on `/health/ready`, and the first `platform-admin:grant`. None of it is in this repository, and none was done.

### Tests

New: `host-matrix.spec.ts` (every kind of Host against every kind of path), `release-rules.spec.ts` (a Site's address from configuration, the platform as exactly the names a deployment lists, no hostname or product domain in what ships, the single-host production rules), `site-address.spec.ts` (every screen writes the same address, it opens the Site, the booking link opens the Booking page), `fingerprint-catalog.spec.ts` (the restore comparison fails on each of sixteen kinds of change and does not fail on a difference of printing), `release-accessibility.spec.ts` (landing, Marketplace, profile, booking, Sign up, Log in, set-up, the review form, the console and the business's Marketplace management, at 390 px or the workspace's narrowest width and by keyboard), and Docker parts `06` to `10`. `public-boundary`'s page comparisons now compare a page only when the normal server's answer from just before and just after is the same page, and the discovery specs draw their ZIP codes from a shared helper (`uniqueZip`). The whole suite at the end of the phase was 3696 tests in 131 spec files, none failing and none skipped, and 78 Docker tests.

## 40. Customer creation and the booking-to-customer link (Phase 19E)

Phase 19D found the one product gap that stood between a new business and its first review: **the application could not create a customer**, and a guest's booking was kept as a name and two contact lines with no customer behind it. A review is requested *from a customer*, so a business that had just signed up had nobody to ask. Phase 19E closes it, narrowly: two ways in, one rule for who is who, and nothing else about Customers changed (no merge, no duplicate cleanup, no new fields, no import).

### 40.1 Adding a customer by hand

`Customers → Add customer` (the button sits in the header once there is a customer, and is the one action of the empty state before that). A modal asks for what the Customers module already has: **name** (required, up to 80 characters), **email**, **phone** and **preferred contact** (SMS, Phone or Email). At least one of email and phone is needed, and the preferred contact must be a way the customer can be reached by what was entered; unless the owner chooses, it follows what was typed (a phone number is texted, otherwise the email is written to). The form shows the same messages the server enforces (`parseNewCustomer`, `src/lib/customer-rules.ts`): a refusal is words on the field, and the focus goes to the first thing to fix. On success the customer's page opens and the list and the pickers (the review request, a new booking) read the new customer from the server.

- **Who.** The capability is `customers:manage` (`src/lib/policy.ts`): owners and admins. A member sees the list, not the button, and an empty list tells them why. The screen only decides what to show; `addCustomerAction` calls `authorize("customers:manage", …)` **before it parses anything**, takes the business only from the verified session, and names no organization, id, position, key or public reference (the server chooses the reference, `dana-lee`, `dana-lee-2` …, with the same rule the other modules use). Whatever else a caller adds to the call is ignored.
- **The database holds it a second time.** `0030` gives the runtime role `INSERT` on `customers` and nothing more, behind `customers_insert`: `organization_id = app_current_org_id()` and the caller is an owner or admin of it. UPDATE and DELETE on customers, and every write to notes, properties and equipment, are still refused (`core-data-isolation.spec.ts` holds both halves). A platform administrator is not a member of a business because of it and cannot add a customer to one.
- **Normalization.** A phone that is a US number (ten digits, or eleven with a leading 1) is stored as `(555) 010-0100`, as Settings stores one; any other phone with at least seven digits is kept as typed. The email is stored as typed, trimmed. Names, emails and phones are plain text (the same checks the public booking uses). Nothing depends on a locale.
- **The same email twice.** An email that already belongs to a customer of this business, however it is typed, is refused on the field: *"A customer with this email address is already on your list."* A phone number alone is **not** refused (a household shares one), and the same email and phone twice cannot exist at all (below).
- **A customer with nothing else yet** has no service location and no equipment, and says so (*No service location is on record yet*, *No phone/email on file*) instead of showing an empty list or a link to nothing.
- **No tenant activity log.** The product has no per-business audit trail for CRM actions (the platform console's audit, §36, is the platform's own and records platform acts). The customer row's `created_at` and its place in the list are the record, and no private contact detail is written to any log.

### 40.2 A guest's booking makes (or finds) the customer

Both public booking paths, a business's **website** and its **Marketplace profile**, write through one internal function, `app_insert_public_booking`. It now finds or creates the business's customer **inside the same statement and transaction as the booking**, through the internal `app_resolve_public_customer`, and the booking points at it. The business is the one the caller found from the Site or the listing, never the browser's; the browser sends no customer id and no organization, and the runtime role cannot call either function. If the booking then fails, the customer goes with it (tested by making the booking's own insert fail after the customer was made). A repeat of a request (same submission key, or the same person asking for the same Service at the same time) returns the first booking and makes no customer.

**What moves.** A booking *for a customer* carries no name, phone or email of its own: they are the customer's (the existing `bookings_party` rule, unchanged, and `bookings_customer_holds_contact`, which 0029 narrowed from "no phone, email or address" to "no phone or email"). The booking keeps what only it knows: **the address the visit was requested at** (the customer made from it has no Property yet), its source, its listing, the Service and the place the visitor had searched, and its note. The business sees a customer-linked booking with the customer's name, and the drawer shows the requested address when there is no Property. The customer's own page shows its bookings in a **Bookings** card, read from the same operations records the Bookings module reads (nothing is copied onto the customer and no history table was added), and no Job is made up for anyone.

### 40.3 The identity rule (hardened by 0031)

Two keys, **derived by the database** (`customers.email_key` and `customers.phone_key` are generated columns over `app_email_key` and `app_phone_key`, 0028/0029, so no code path can disagree about them): the **email key** is the email trimmed and in lower case; the **phone key** is the digits only, a US number without its country code (`+1 (555) 010-0100`, `555.010.0100` and `15550100100` are one phone), and fewer than seven digits is no identity at all. Inside **one business, and never beyond it** (every lookup names the organization first, and a booking cannot point at another business's customer: the composite foreign key refuses it):

The **email comes first**: a phone number is shared by households, offices and families, and a different person's email on a known phone is not evidence of the same person (the first version of this rule, 0030, took it for evidence; migration 0031 replaced it).

| The booker's email and phone | Result |
| --- | --- |
| the same email **and** the same phone as one customer | that customer |
| an email that exactly one customer has | that customer, **unless** the phone given belongs to a *different* customer. A new or changed phone alone changes nothing and is *not* written to the customer; the booking's note keeps it |
| an email that **nobody** has | a **new, separate customer**, even when the phone is somebody's: the household's phone does not make two people one |
| an email that is one customer's and a phone that is **another's** | a **new, separate customer** carrying what the booker typed: nobody is picked and nothing is merged. The next identical booking finds it by the first row |
| an email that several customers have, with a phone | a new, separate customer (nobody can be told apart); with no phone, no customer, and the booking keeps the visitor's details |
| no usable email, a phone that exactly one customer has | that customer |
| no usable email, a phone that several customers have | the one of them who has **no** email (the separate customer an earlier such booking made), otherwise a new, separate customer |
| nothing usable (no email key and no phone key) | no customer; the booking keeps the visitor's name and contact details, as before |

The public booking form always asks for an email and a phone, so the rows without an email are what the database does if it is ever asked without one, not something a visitor reaches.

A **name is never used to find anyone**, and a customer that is found is **never changed** by a booking (the name, phone and email are written only on a customer the function creates). When what the booker typed differs from the customer found (another name, phone or email), the booking's note begins *"Booked as <name>, <phone>, <email>."* so that nothing a visitor typed is lost. The database allows **one customer per exact email-and-phone pair per business** (`customers_org_identity_unique`) and deliberately nothing stricter: a unique email alone would forbid the separate customer the conflicting case needs, and families share an email and households a phone. No uniqueness crosses businesses.

The visitor learns nothing from any of it: the answer is the same reference and status as before, whether a customer was found, made or left out. A visitor cannot choose a customer, a business, or a customer id, cannot overwrite an existing customer's details, and cannot tell whether an email or a phone is already a customer's.

### 40.4 At the same time

Creating customers is serialized **per business** by a transaction-scoped advisory lock (`pg_advisory_xact_lock`, keyed by the organization), taken by the guest-booking function and by the Add customer query alike; the lock is the database's, not the application's. So twelve simultaneous bookings by one person make one customer; six people booking three times each make six; a conflict arriving eight times at once makes one separate customer; and an owner adding a customer while that person books ends with one customer holding that email (three rounds each, in `customer-acquisition-database.spec.ts`). The unique pair index is the backstop for anything that does not take the lock (an operator's import), and the resolver treats its violation as "that customer".

### 40.5 Review requests, and the old bookings

A review request needs a customer, and a new business now has one the first day: one it added, or one a guest's booking made. The request is the 19C one unchanged: the business is **given the link once**, nothing is sent, no email or SMS exists. The customer page of a person with no email or no phone says so in the request's channel choice.

**Bookings made before Phase 19E that have no customer are left exactly as they are.** Nothing in 0028–0030 looks backwards, matches old names or contacts, or creates a customer for an old booking (a test makes such a booking and shows a later one leaves it alone). Matching a business's historical requests to people is a decision for the business, with a screen to make it on, and there is none yet.

### 40.6 Operating notes

- **Migrations 0028–0031.** 0028 (the two key functions), 0030 (the grant, the policy, the resolver and the booking function) and 0031 (the resolver's hardened body, §40.9) are hand-written; 0029 is generated (two generated columns on `customers`, three indexes, and the bookings check `bookings_customer_holds_contact` replacing `bookings_contact_without_customer`). Adding the generated columns rewrites `customers` once; the unique index would stop a migration on a database that already holds two customers with the same email **and** phone in one business (the error names `customers_org_identity_unique`; nothing shipped has any). A backup of the new schema restores with the keys recomputed, the functions before the table, and the same grants and policy (`08-backup-restore` compares sixteen kinds of catalog object).
- **Nothing is sent and nothing is deployed.** No email, SMS, notification or webhook is part of this, and no AWS resource.

### 40.7 Limits

A customer made from a booking has a name, a phone, an email and a default preferred contact (SMS); it has **no property and no equipment** until someone adds them (there is no screen for that yet), and the address stays on the booking. There is no merge, no duplicate view and no way to edit or delete a customer: if two customers should be one, that is a manual job for now, and the separate customer the conflicting case makes is the price of never guessing. A household that shares **one phone** and gives different emails is **two customers** (§40.3); one person who uses two emails and one phone is two customers until the business sorts it out, which is the price of never guessing. A customer made from a booking is in the business's *all customers* marketing audience like any other (campaigns are stored; nothing is sent).

### 40.8 Tests

`customer-acquisition-database.spec.ts` (the keys; every row of the table above; cross-business; repeats and refusals leave no customer; the late failure; old bookings; concurrency ×3; who may insert; the unique pair; the internal functions are closed; the query the action runs), `customer-acquisition-flows.spec.ts` (the empty business adds its first customer; the form's words and focus; admin and member; the action asked as nobody, as a member, as an unrelated platform administrator, with forged fields and malformed arguments, and ten at once; a Marketplace booking and a repeat; a website booking; the review request; another business sees nothing; 768 px and the keyboard), the first-day journey (`public-entry-empty.spec.ts`) now with **no** SQL import, and Docker parts `02`, `03`, `07`, `08` and `09`: the first customer added by hand on the empty database, the booking on a customer's domain and the three Marketplace guests each becoming a customer, every guest booking still pointing at its customer after restarts, and a restored backup holding the same customers and links, the keys recomputed, and the objects 0028 to 0031 added, a phone shared by two customers kept as two, and the resolver the source's (08). Existing specs that read a guest's booking back by its email now read it through the customer. The correction added `customer-resolver-upgrade.spec.ts`, `customer-identity-safety.spec.ts`, the ten-case matrix and a household concurrency test in `customer-acquisition-database.spec.ts`, and made the household two customers in Docker `07` (Maya books on Jordan's phone, twice, and each of their review requests is for the right one). The whole suite at the end of the phase (after the correction) was 3751 tests in 135 spec files, none failing and none skipped, and 80 Docker tests.

### 40.9 Hardening the rule, and the tests' shared state (the Phase 19E correction)

**The rule (0031).** Phase 19E first shipped with a resolver that, when the email was new, took "the only customer who has this phone" for the same person. A shared landline, a household, an office's front desk: that would have folded one person's bookings into another's customer, and their activity, their review requests and their marketing with it. Migration **0031** (hand-written, no schema change, `0030` untouched) replaces the resolver's body with the table in §40.3 and keeps its name, signature and privileges (nobody but its owner and the booking function that calls it). It was proved three ways: a database at the migration before it, with data, is upgraded and its customers are byte-for-byte what they were (`customer-resolver-upgrade.spec.ts`); a second migrate changes nothing; and the upgraded database compares equal to one built from zero on every table and sixteen kinds of catalog object. The ten cases of the rule are one test each in `customer-acquisition-database.spec.ts`, the concurrency tests were re-run with it (a household's two people booking six times each at the same instant are two customers with six bookings each, three rounds), and `customer-identity-safety.spec.ts` holds what is downstream: the marketing audiences keep a household's people as separate customers with their own emails (nothing is sent), a review request names the person it was made for and the review that returns is theirs alone, and a repeat booking, a changed phone and a third person on the same phone move nobody's bookings to another's page.

**The tests' shared state.** The Phase 19E repeat reported `fingerprint-catalog.spec.ts` failing when its repetitions ran at once. Two things were shared, and both are fixed at their root: the spec made its databases under fixed names (`climvia_fp_source`, `climvia_fp_copy`), so one repetition dropped the databases another was comparing (each worker now has names of its own, by its index), and every migration of a database rewrote the **runtime role**, which belongs to the whole server and which PostgreSQL will not let two sessions change at once (`tuple concurrently updated`). `provisionRuntimeRole` now leaves the role alone when it already is what provisioning would make it (it can log in and nothing else, and this password opens a session); a changed `POSTGRES_APP_PASSWORD` is still applied on the next migrate, and `db:roles` and the restore script behave as before. The spec, with the upgrade spec, was then run three times at once, six workers, and nothing collided.
