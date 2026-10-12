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
25. [Financials: quotes, invoices and payments](#25-financials-quotes-invoices-and-payments)
26. [Maintenance plans and reviews](#26-maintenance-plans-and-reviews)
27. [Marketing and Analytics](#27-marketing-and-analytics)
28. [Websites, Site Versions and the Marketplace](#28-websites-site-versions-and-the-marketplace)

## 1. Status and scope

Before this phase Climvia was a single-business front end: one hard-coded business (Apex Climate Heating & Air), no sign-in, every edit lost on
reload. Now:

| Done | Not done (deliberately) |
| --- | --- |
| Real sign-up, log-in, log-out (Better Auth, sessions in PostgreSQL) | Email verification, password reset, invitations by email (no mail service yet) |
| Organizations, memberships, owner / admin / member roles | A UI to invite or remove members, or to change roles |
| Many people ↔ many businesses; a workspace switcher | Billing for Climvia itself |
| New-business onboarding in one transaction (the organization, its owner, its hours, a private primary Site with its Draft) | Delivering the Website's contact-form messages (no mail service) |
| Business information, Business hours, Workspace preferences and the profile name stored in PostgreSQL | Logo / branding / avatar storage (needs object storage) |
| Customers, properties, equipment, Services, the team and its roles stored in PostgreSQL per organization (§13) | A flow to add or edit a customer, email invitations for team members |
| Bookings, Jobs (with work details and photo metadata), the Schedule (derived) and blocked time stored per organization (§24) | Rescheduling a booking, file storage for photos, a public booking page for a business's own domain |
| Quotes, invoices (with line items) and payments stored per organization, money in integer cents, balances derived, payments voided rather than deleted (§25) | A payment processor, bank or accounting connection, Climvia's own subscription billing |
| Maintenance plans (with coverage and included visits) and reviews (with replies and review requests) stored per organization; a visit is scheduled as a real booking (§26) | Pausing or ending a plan from a screen, sending a review request (email or SMS), a public way to submit a review, automatic billing from a plan |
| Marketing campaigns (email and text, with Draft / Scheduled / Sent state, recipient snapshots and business-time scheduling) and Analytics as PostgreSQL reporting queries, with the sample business's approved history kept as explicit imported adjustments (§27) | Sending any email or text (no provider), templates and a rich email builder, A/B tests, open and click analytics |
| Strict tenant isolation: server authorization **and** PostgreSQL Row Level Security | Custom-domain verification and routing, the visual Website Builder (§28) |
| Websites: one organization owns many Sites (one primary); a Site has one mutable Draft and immutable Published versions of Pages and Sections, a code-level section registry with server-side validation, theme tokens and an application-owned template; published pages are served to anyone through a narrow public read path, the Draft only to people signed in; a visitor can book (§28) | A Sites screen, a template gallery, adding or reordering sections, uploaded images (object storage) |
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
property if the customer record is ever merged. There are no scores, lifetime-value, health or telemetry fields, and no flow to add a customer, send a message or edit history: the product does not have those yet, so the runtime role has
**no INSERT/UPDATE/DELETE privilege** on these four tables (a write fails with `permission denied` before RLS is even consulted). When an Add Customer flow ships, its migration adds the grant and an owner/admin policy together.

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
template it started from (`selected_template_id`, a real foreign key to `site_templates`), the published version it points at (`published_version_id`) and a record of a custom domain. Its content lives in versions, pages and sections (§28). Onboarding creates the first Site, private,
with a Draft from the default template. There is no "website" field on the organization. The whole model, the primary-Site strategy and the multi-Site rules are in §28.

## 15. The future Website Builder

The ownership chain is built (Phase 15) so the Builder adds screens and section types, not tables above it:

```
Organization ──< Site ──< Site Version ──< Page ──< Section
                  │            └─ theme tokens and settings
                  ├── selected template (site_templates: application-owned, validated JSON)
                  ├── the Published version visitors see
                  └── platform address + custom-domain record (§20)
```

`site_pages` and `site_sections` carry `organization_id` with the same policies, grants and composite foreign keys as `sites`, so they inherit §9 and §10 unchanged. The current Website module (page editors with fixed sections, a Draft preview, publishing, the booking journey) is the product the Builder is built from,
and §28 draws the line: what exists and is kept (the model, the registry and its server-side validation, the Draft/Published lifecycle, the public read path) and what the Builder will add (inserting, removing and reordering sections and pages, a template gallery, a Sites screen, a Theme editor, an image library that needs object storage).
**The visual Website Builder is not built.**

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
| Where it lives | Future platform tables (`subscriptions`, `plans`, `billing_events`), a Climvia-owned Stripe account | The **Payments / Quotes & Invoices** modules: the `quotes`, `invoices`, `payments` and line tables of §25, a Stripe Connect account *per business* later |
| Today | Not built | Built and stored per business (§25): payments are **recorded** by hand as money the business received; no processor, bank or accounting connection exists |

Billing will hang off the organization (`organizations.id`), never off a user, because the business is the customer. Gating features by plan will be a check beside the role check in §9. The financial tables of §25 share nothing with it: no table, column, function or credential is common to both, and a test asserts no table in the database is named for subscriptions or a payment processor.

## 20. Future domain routing

Not built. What exists (Phase 15, §28): every Site has a public identity, `platform_slug`, served today at `/sites/<platform_slug>` on the application's own host, and shown in the workspace as `<platform_slug>.climvia.com` (`PLATFORM_DOMAIN`). **Nothing resolves that host name yet**, and the product never says it does. A custom domain is only a *record*
(`custom_domain`, `custom_domain_status`: `configured`, `pending_verification` or `verified`), and no screen claims it is connected, verified or live.

The intended design: a request's host name selects the **site**, and the site selects the organization.

- A proxy / edge function resolves `Host` → Site (`<platform_slug>.climvia.com`, or a *verified* `custom_domain`) → organization and renders the published Site read-only through the same narrow public function the `/sites/…` routes use (`app_public_site`): the public path already takes a public identity and never an organization, so routing only changes how the identity reaches it. Public traffic needs no session and must not use the
  tenant policies of §10 (which require a signed-in member).
- A wildcard subdomain for every Site plus customer-owned custom domains (with DNS verification and certificates) is the likely shape. Verification is the platform's act: the runtime role cannot mark a domain verified (a trigger), and only a verified domain is unique across Sites (a partial unique index); until then a domain is a claim several businesses may hold.
- The authenticated app stays on its own host so cookies and CSRF origins stay separate from public sites.
- No DNS, Route 53, wildcard record or certificate automation exists.

## 21. Deferred domain migrations

Each of these moved from sample data to PostgreSQL in its own phase, with `organization_id`, RLS and tests as in §9–§10. When a module moved, its `fixtureGate` call was deleted and it works for every organization.

Done: Services, Customers (+ properties, equipment), Team (staff, roles) (§13); Bookings, Jobs, the Schedule (derived) and blocked time (§24); Quotes, Invoices and Payments (§25); Maintenance Plans (with coverage and visits) and Reviews (with replies and requests) (§26); Marketing (campaigns, recipient snapshots, scheduling and sent state) and Analytics (reporting queries over those tables, with the sample business's approved history as explicit imported adjustments) (§27). The Website (Sites, Site Versions, Pages, Sections, the template, the public read path and a visitor's booking) and the Marketplace listing (§28). **No module remains on sample data.** What is pending: the visual Website Builder (Phase 16) and the Host → Site mapping of §20, branding / logo / avatar storage and photo files and website images (an object store), invitations and member management, email and SMS (including the Website's contact-form messages).

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

- Websites and the Marketplace (§28): `site-rules.spec.ts` (the pure rules: the section registry and props validation, the theme tokens, the template definition and whole-site validation, the domain record, the public booking request and its checks, the listing configuration), `website-database.spec.ts` (SQL as `climvia_app` and the owner: template read-only, RLS and grants per business and role, the Published-snapshot immutability, composite foreign keys, the Site/domain/identity guards, the Marketplace guards, the three public functions called with no session, a visitor's booking at the database), `website-lifecycle.spec.ts` (publish, atomicity, concurrency, make private, more than one Site, template application and explicit replacement, the domain record), `website-actions.spec.ts` (the Server Actions replayed as a member, with no session, as another business's owner, with forged arguments, and six at once), `website-public.spec.ts` (the public pages and what they never show, live bindings, the Draft preview, a visitor's booking and its refusals and rate limit, a new business, the client bundle), `website-roundtrip.spec.ts` (what the seed wrote is what is read, a second seed changes nothing, a test copy is restored, the Marketplace operations) and `website-edits.ts` (the small pure builders the data specs use). `website.spec.ts`, `marketplace.spec.ts`, `plans-website-data.spec.ts`, `server-boundaries.spec.ts` and the other regression specs were adapted only where a fixture became the database.

## 23. Known limitations

- Email verification, password reset, invitations and member management have no UI: they need a mail service and are the next SaaS work.
- Branding, logo and avatar are session-only until object storage exists. **Object storage required for durable uploaded logos/assets**; no public page shows an uploaded logo (they show the business's initials), and there is no image upload or image binary column anywhere.
- Websites and the Marketplace (§28): the page editors change a page's text and visibility only (there is no adding, removing or reordering of sections or pages: the Builder, Phase 16), there is no template gallery, Sites screen or Theme editor, and no way to roll back to an earlier version from a screen (the versions are kept; a rollback is a pointer change not yet exposed). The Website's contact form confirms and **delivers nothing** (no mail service). The platform address `<slug>.climvia.com` and any custom domain are only displayed or recorded; nothing resolves, verifies or routes them (§20), and the public pages are served at `/sites/<slug>` and `/listings/<slug>` on the application's host. The visitor-booking rate limiter is held in one server process (§28). The Draft preview's booking journey makes a real booking as the signed-in owner or admin. A business's uploaded logo is not shown on its Site or listing.
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

Since Phase 15 the **published Site has a real public booking page** for a visitor with no session (`/sites/<slug>/booking/<service>`), through one narrow public write path that finds the business from the Site, validates the Service and the time with the same rules, deduplicates, and is rate limited (§28). The booking has source `Website` and no customer record (`customer_id` stays NULL until the business matches the request).

### Not in this phase

Quotes, invoices, payments, plan records, review records, marketing, the Website model, file storage, rescheduling, drag and drop, routing, notifications by email or SMS, and the Analytics aggregate facts. No Docker image was built or run for this phase: the Dockerfile and compose
file are unchanged and compatible with the new migrations, and **Docker verification is required before AWS deployment** (§17).

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

A payment processor, bank or accounting connection, Climvia's own billing, a Quote builder, invoice editing, refunds and credit notes, tax, PDFs and email, Maintenance Plans, Reviews records, Marketing, the Analytics aggregate facts, the Website model and Marketplace configuration (Maintenance Plans and Reviews followed in §26, Marketing and Analytics in §27). No Docker image was built or run for this phase: the Dockerfile and compose file are unchanged and compatible with the new migrations, and **Docker verification is required before AWS deployment** (§17).

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

Pausing, ending or renewing a plan from a screen, editing a plan or its visits, rescheduling a visit other than by cancelling its booking and booking it again, automatic billing from a plan, sending a review request (email or SMS), a public way for a customer to submit a review, reviews on the Website or the Marketplace, Marketing, the Analytics aggregate facts, the Website model and Marketplace configuration. No Docker image was built or run for this phase: the Dockerfile and compose file are unchanged and compatible with the new migrations, and **Docker verification is required before AWS deployment** (§17).

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

Sending any email or text message, any provider (SES, Twilio, SendGrid), external marketing automation, templates and a rich email builder, A/B tests and open or click analytics, Website pages and Marketplace configuration in PostgreSQL, SaaS billing, custom domains and S3. The migration roadmap that remains is the **Website** (pages, the booking page configuration and the public preview paths) and the **Marketplace** listing, then the object store for photos and branding. **Docker verification is required before AWS deployment** (§17): the new migrations were applied and tested on the PostgreSQL stand-in used for development, the Dockerfile and compose file are unchanged, and no image was built or run.

## 28. Websites, Site Versions and the Marketplace

Phase 15 moved the Website and the Marketplace to PostgreSQL and built the architecture the visual Website Builder (Phase 16) will sit on. Nothing in this section is a fixture any more: a new business gets its own private Site with a Draft, and the approved Apex Climate Heating & Air website is **seed data** (`scripts/db/seed-data/website.ts`) written through the application's own functions. The Builder itself (dragging, inserting and reordering sections, a template gallery, a theme editor, an image library) is **not built**; the last subsection draws the line.

### The model in one view

```
Organization ──< Site ──< Site Version ──< Page ──< Section
      │             │          └─ theme and settings (JSON, validated)
      │             ├── selected template  ──>  site_templates   (application-owned, read-only to tenants)
      │             ├── published_version_id ─>  exactly one Published Version of this Site (or none: the Site is private)
      │             └── platform_slug (its public identity) + a custom-domain RECORD
      └──< marketplace_listings (at most one) ──< marketplace_listing_services >── services
```

Seven tables, in `src/db/schema/sites.ts` and `src/db/schema/marketplace.ts`, migrations `0012_website_marketplace.sql` (tables, constraints, indexes; generated by drizzle-kit and then edited by hand: the backfill of `platform_slug`, the move of the new composite `UNIQUE` keys ahead of the foreign keys that need them) and `0013_website_marketplace_rls.sql` (policies, column grants, triggers, the public functions and the default template row; hand-written, built from the same pieces as `0001`, `0003`, `0005`, `0007`, `0009` and `0011`).

| Table | What it holds | Who writes it |
| --- | --- | --- |
| `site_templates` | An application-owned, reusable site definition: `key`, `name`, `category`, `schema_version`, `definition` (JSONB), `is_active`. | **A migration only.** The runtime role has `SELECT` on the active rows and nothing else. |
| `sites` | A Site: `organization_id`, `name`, `slug` (unique in the business), `platform_slug` (unique everywhere), `is_primary`, `status` (`draft`, `published`, `archived`), `selected_template_id`, `published_version_id`, and the domain record. | Owner and admin: the name, status, template, published pointer and domain record. The identity (`slug`, `platform_slug`, `is_primary`, `organization_id`) has no `UPDATE` privilege at all. |
| `site_versions` | One state of a Site's content: `status` (`draft` or `published`), `version_number`, `theme`, `settings`, `template_id`, `published_at`, `published_by_user_id`. | Owner and admin create the Draft and change a **Draft's** theme, settings and template. A Published version is created only by Publish and never changes. |
| `site_pages` | A page of one version: `page_key`, `title`, `slug`, `page_type`, `sort_order`, `is_visible`. | Owner and admin, while the version is the Draft (and Publish, for the snapshot). |
| `site_sections` | A section of one page: `section_key`, `label`, `type`, `variant`, `props` (JSONB), `sort_order`, `is_visible`. | The same. |
| `marketplace_listings` | A business's listing (below). | Owner and admin. |
| `marketplace_listing_services` | The Services a listing shows, in order. | Owner and admin. |

Every table carries `organization_id` itself and reaches its parent through a **composite foreign key that includes it** (`(organization_id, site_id)`, `(organization_id, site_id, site_version_id)`, `(organization_id, site_id, site_version_id, page_id)`, and for the published pointer `(organization_id, id, published_version_id)` against `(organization_id, site_id, id)`), so a Page cannot belong to another business's Site or Version, a Section cannot sit on another business's Page, a Site cannot be published from another Site's Version, and a listing cannot select another business's Service, **whoever writes the row** (PostgreSQL checks a foreign key outside Row Level Security). No table cascades from a Site: a Site holds pages people wrote, so it is removed deliberately, never as a side effect, and the runtime role has no `DELETE` on `sites`, `site_versions` or `marketplace_listings` at all.

### Site ownership and the primary-Site strategy

An organization owns **many** Sites (`organization_id`, `ON DELETE RESTRICT`); there is no `organization.website` field and no rule that a business has one Site. Exactly one is its **primary** Site (`is_primary`, a partial unique index: at most one per organization): the one the Website module edits, the one the Marketplace "View website" and "Book service" actions lead to, and the one the preview shows. Nothing in the Website's Server Actions accepts a Site id: each action finds the primary Site from the **verified** organization inside its own tenant transaction (`findPrimarySite`), locks it, and changes it. A Sites screen (choose, add, archive) is Phase 16 work and needs no schema change. The standing sample data proves the many-Sites rule with real rows: Apex has a published `main` Site and a private `commercial` one, each with its own Draft, pages, sections, theme and history; the tests create more.

Onboarding creates the first Site in the same transaction as the organization: `slug = "main"`, `is_primary`, **private**, with a Draft made from the default template (below) in neutral words that speak of the business only through its own record. Nothing of Apex or Northstar is copied.

### Public identity: the platform address

A Site's public identity is `platform_slug`: globally unique, lower-case words joined by hyphens, at most 63 characters, never a name the platform keeps for itself (`www`, `app`, `api`, `admin`, `login`, `sites`, `listings`, `climvia` … : `RESERVED_PLATFORM_SLUGS`), checked by the database. It is the same string in `/sites/<platform_slug>` (where it is served today) and in `<platform_slug>.climvia.com` (what the workspace shows as the Site's address; **nothing resolves that host yet**, §20). It is **collision-safe and not taken from the business's name as typed**: the first Site of a new business starts from the organization's own address (itself unique and numbered when two businesses share a name), a second business that already has it (or a reserved name) gets `-2`, `-3` …, and a Site made without one gets the organization's address plus six random characters from a database trigger. Two businesses with the same name get two different public addresses (tested).

### The Template model

A template is **data, not code**: a row of `site_templates` whose `definition` is validated JSON (`validateTemplateDefinition` in `src/lib/site-template.ts`) that selects registered section types and variants and gives them text. It holds no component, markup, style, script or hook. It is owned by the application: the runtime role cannot insert, update or delete a template, and `0013` writes the one that exists, **`climvia-starter`** ("Climvia starter", category `hvac`): a five-page HVAC website (Home, Services, About, Contact, Booking) that reproduces the approved Apex website word for word, with `{{business.name}}` / `{{business.location}}` where the business is named. `src/db/default-template.ts` is the same definition in code (the migration cannot import it): a test keeps the stored row and the code equal, and `scripts/db/template-sql.ts` prints the `INSERT` for the migration, so they cannot drift.

The definition is `{ schema, theme, settings, pages: [ { key, title, slug, type, visible, sections: [ { key, label, type, variant, visible, props } ] } ] }`. **Schema/version strategy:** `schema_version` (a column) and `definition.schema` (inside) are the version of this *shape* and a `CHECK` keeps them equal; the code lists the shapes it reads (`SUPPORTED_SCHEMAS`, today `[1]`). A new shape means: raise `TEMPLATE_SCHEMA`, keep a reader for the old one (or migrate the stored definitions in a migration), never edit a stored definition in place. Bounds: at most 12 pages, 40 sections per page, 200 Service references; unknown keys are refused, never carried along.

**Applying a template is a server-side act.** `createDraftFromTemplate` copies a template's theme, settings, pages and sections into a new Draft (refused when the Site already has one) and records `selected_template_id`. `replaceDraftWithTemplate` puts a template over an existing Draft: it **destroys that Draft's pages and sections**, so it refuses unless the caller passes `confirmReplace: true`, keeps the Draft's identity, and never touches a Published version. Both validate the template again before using it. There is no template gallery in the interface (Phase 16); onboarding and the "create website" action use the default.

### The Site Version model

A Site has **at most one Draft** (the mutable version: `status = 'draft'`, no number; a partial unique index) and any number of **Published versions** (immutable snapshots: `status = 'published'`, a number 1, 2, 3 … unique per Site, stamped with when and by whom). The version carries the **theme** and the **settings** (which Services the Site shows and in what order), so a Published version keeps the look and the list it was published with. `sites.published_version_id` is the version visitors see; a CHECK keeps `status = 'published'` exactly when that pointer is set, a trigger lets it point only at a *published version of this very Site*, and the composite foreign key makes it a version of this Site of this business. **Published versions are kept** (no cleanup): they are the history a rollback (a pointer change) would read.

**Published authoring rows are immutable, not merely unwritten by the application.** A trigger (`site_versions_guard_update`, `site_content_guard_update`) refuses any `UPDATE` of a Published version, or of a page or section of one, through any column, for anyone, **the owner role included** (`site_published_final`). Row Level Security lets the runtime role create a Published version, page or section **only in the transaction that has just changed the Site it belongs to** (`sites.updated_at = now()` is the transaction's own start time), as the person publishing (`published_by_user_id` = the caller), and only if that person is an owner or admin; and it lets the runtime role update or delete only the rows of a **Draft**. So no other path, a forged request included, can write a snapshot or change one.

### The Draft / Published lifecycle

```
create website ─▶ Draft ──save page──▶ Draft ──Publish──▶ Published vN (new, immutable) ◀── site points at it
                    ▲        │                              │
                    │        └─ Discard (the screen drops its unsaved edits) ─────────────────────┘
                    └── Unpublish: the Site becomes private; pointer cleared; every version kept
```

- **Save** (`savePageAction`) validates every section's text against its registered type and variant on the server and persists to the **Draft only**; a Published page is not selectable. Nothing is stored when any section of the page is invalid. The page editor keeps its Unsaved changes state, its Discard confirmation and its leave-the-page protection; **Discard** restores the saved Draft (the unsaved edit only ever existed in the browser).
- **Publish** (`publishSite`) is one transaction: it authenticates the caller, verifies the active organization and the `website:manage` capability, **locks the Site row** (`SELECT … FOR UPDATE`), validates the **whole** Draft (`validateContent`: theme, settings, every page and section; an invalid Draft is refused with every problem named), returns without a new version when the Site is already live with exactly the Draft's content, takes the next version number under the lock, touches the Site row, inserts the Published version with fresh copies of the Draft's pages and sections, and points `published_version_id` at it. A failure anywhere rolls all of it back; a test throws after the work and finds no version, no page, no pointer change. **Two publishes at once** queue on the lock: the second finds the Site already live with that content and answers with the first's number (six simultaneous publishes make one version), and a publish racing a save sees the Draft whole, as it was before or after the save; version numbers are contiguous and unique (the database also enforces `UNIQUE (site_id, version_number)`).
- **Unpublish** sets the Site private and clears the pointer. Pages, sections and versions are kept; publishing again makes the next version.
- The Domain record is independent of all of it: connecting, removing or choosing the main address never changes content or publication.

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

The theme belongs to the version and is **design tokens, never CSS** (`src/lib/site-theme.ts`): `accent` (`null` for the Climvia teal, or `#RRGGBB`), `radius` (`small | medium | large`), `density` (`compact | comfortable`), `headingFont` and `bodyFont` (an identifier from a closed list; only the self-hosted Inter exists). Unknown keys are refused; the accent is the only token applied today (as the Site's primary colour, as CSS custom properties built by the application from the validated value); the others are reserved for the Theme editor. A stored theme that does not validate is replaced by the default when drawn. A `CHECK` requires the theme to be an object with `schema = 1`.

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

The routes (all in the `(site)` group, which is `force-dynamic` and has no shell):

| Route | Serves |
| --- | --- |
| `/sites/[siteSlug]`, `/sites/[siteSlug]/[...slug]` | A published Site's pages; the booking journey of one Service is `/sites/<slug>/booking/<service-slug>`. |
| `/listings/[listingSlug]` | A published Marketplace listing. |

A Site that is private, unpublished, unknown or misspelt, a page that does not exist or is hidden, and a path that names nothing are **one and the same "not found"** (a test compares the bodies), so nothing reveals whether a private Site exists. No organization comes from the browser: an `organizationId` in the query string, a header or a cookie changes nothing (tested). **No shared cache:** pages are rendered on request with `Cache-Control: private, no-cache, no-store`; the only memoisation is React's `cache()` *within one request*; nothing in `src` uses `unstable_cache`, `revalidate` or static generation (a source scan). Because nothing is cached across requests, a cache key never needs the Site or version identity, a Draft can never be in a shared cache, and Publish "invalidates" by construction: the next request reads the new pointer. `src/proxy.ts` lets `/api/auth`, `/sites` and `/listings` through without a session; every other route still requires one.

### Draft preview security

The Draft is for people signed in to the business. `/website/preview` and `/website/preview/[...slug]` (and `/marketplace/preview`) call `requireWorkspaceContext()` first (the layout does, and the shared preview route does), read the **signed-in person's own** primary Site's Draft from the workspace snapshot, and draw it with the same renderer as the published Site. A visitor is redirected to Log in; a person from another business sees their own Draft, never another's; an address that names no visible Draft page is "not found". Compatibility: the old `?view=live` links redirect to the published Site at `/sites/<slug>`. The preview's booking journey makes a real booking **as the signed-in owner or admin** through the workspace's authorized action (the preview is inside the workspace); the published Site uses the public path below.

### A visitor's booking: tenant resolution

`submitPublicBookingAction` is the one anonymous Server Action. A request names a **Site (by its public address)**, a **Service (by its slug)**, a time and the visitor's details; it never names an organization, and anything extra in it is dropped when it is parsed. The server: (1) parses and bounds every field (plain text only, a valid email and phone, a key of 8–64 safe characters), (2) **rate limits** by Site and the visitor's address, (3) reads the Site as a visitor would (published only) to get the business's hours, clock and Services, (4) checks the Service is one the business offers for online booking, the time is one of that Service's slots on a day the business is open and not in the past, and the answers are among the Service's options, with the **same rules the workspace uses** (`checkPublicBooking`), and (5) calls `app_public_create_booking`, which **finds the organization from the Site again**, checks the Service belongs to it and is active and bookable online, allocates the business's next number, and writes one booking: `source = 'Website'`, status from the Service's booking method (instant → confirmed, otherwise pending), **`customer_id` NULL** (a visitor is not a customer record; the business matches them when it reviews the request) and the details as typed. The answer is a reference, a status and whether it was a repeat: **a visitor can read no booking record.** A database error is never shown.

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

### Domain record (nothing is routed)

`custom_domain` and `custom_domain_status` (`configured | pending_verification | verified`) are a **record**: a domain the business wants to use. Recording one stores it as `pending_verification` (the Apex baseline's is `configured`); the main address is the platform address unless the owner chooses the recorded domain. **Nothing verifies, resolves or routes a custom domain, and no screen says otherwise.** A domain is a *claim* until it is verified: several businesses may record the same name and none learns of the others; only a **verified** domain belongs to exactly one Site (a partial unique index), and the runtime role cannot mark one verified or create a Site already verified (triggers), so only the platform (the owner role, in the domain-routing phase) can. No DNS, Route 53 or certificate work exists.

### Assets and uploaded files (deferred)

**Object storage required for durable uploaded logos/assets.** There is no image upload, no image library and no binary column anywhere: a cover is one of three CSS treatments, a section holds text only, and the Site's mark is the business's initials. Settings → Branding still lets a person choose a logo for the visit, but it is a browser object URL that dies with the session, so **no public page, Site or listing, ever shows one**. The future shape is a private S3 bucket per environment with the object key and metadata in a table and a signed read path (§17); the Builder's image library and the Branding logo both wait for it.

### What the tests prove

`site-rules.spec.ts` (the pure rules), `website-database.spec.ts` (SQL as `climvia_app` and the owner: templates, reads and writes per business and role, column grants, immutability of a Published version, composite foreign keys, Site/domain/identity guards, version/page/section structure, the Marketplace guards, the three public functions called with no session, a visitor's booking at the database), `website-lifecycle.spec.ts` (the operations as the application runs them on a test copy: publish, atomicity, concurrency, make private, more than one Site, template application, the domain record, the stored website is the approved one), `website-actions.spec.ts` (the Server Actions replayed as a member, as nobody, as another business's owner and with forged arguments, six publishes at once), `website-public.spec.ts` (the public pages, live bindings, the Draft preview, a visitor's booking, a new business, the client bundle), `website-roundtrip.spec.ts` (what the seed wrote is what is read, stable ids, a second seed changes nothing, a test copy restored, the Marketplace operations), plus `website.spec.ts` and `marketplace.spec.ts` (the screens) and the existing server-boundary scans.

### Where the data meets the screens

The server reads the active business's primary Site (its Draft, and the Published snapshot while it is published) and its listing with the rest of its core data (`getCoreSnapshot`), `WebsiteProvider` and `MarketplaceProvider` hold them, and each change goes to a Server Action which answers with the website **as stored**; only then does the working copy change. The published pages are drawn on the server from the public projection and send the browser only the markup and the booking form.

### The Phase 16 Builder boundary

Built here and **kept by the Builder**: the model above, the registry and server-side validation, the Draft/Published lifecycle and its guarantees, the policies and grants, the public functions, the preview's authentication, the rule that text is plain and styling is tokens. **Not built (Phase 16 and later), and needing no change to the schema above except where noted:** dragging and reordering sections, inserting and removing sections and pages, a template gallery and choosing a template, a Sites screen (choose, add, archive), a Theme editor, an image/asset library (**needs object storage and a new assets table**), per-page SEO, rollback to an earlier version, Host → Site routing and custom-domain verification (§20), a delivered contact-form message, email and SMS. A new section type is a new entry in the registry (code); a richer template is a new migration row.

No Docker image was built or run for this phase: the Dockerfile and compose file are unchanged and compatible with the new migrations (`0012`, `0013`), which were applied and tested on the PostgreSQL stand-in used for development. **Docker verification is required before AWS deployment** (§17). An existing development database needs `npm run db:reset` to pick up the new tables and the seeded websites and listings.
