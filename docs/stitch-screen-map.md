# Stitch screen map

How the Google Stitch export in `design-reference/stitch/` maps onto the production Climvia app.
The export is the **visual and product-design source of truth**. It is not production code, and its
generated screen IDs, `{{DATA:SCREEN:SCREEN_n}}` links, `href="#"` links and inline JS routers are
never used for routing.

`bw/` below is shorthand for the folder prefix `climvia_business_workspace_`.
`onb/` is `climvia_hvac_business_onboarding`. Every folder holds `code.html` and `screen.png`.

## 1. Read this first: what the export actually contains

| Fact | Consequence |
| --- | --- |
| 177 folders: 149 workspace screens, 26 onboarding screens, `climvia_development_handoff`, `warm_operational_clarity` (DESIGN.md only). | Many are states or duplicates of one screen. Use the module tables below, not the folder list. |
| Only **37** `screen.png` files are real images (all 26 onboarding + 11 workspace). The other 140 are 28-byte `FIFE Image failed to fetch` stubs. | For most screens the HTML is the only reference. Render `code.html` in a browser (it loads the Tailwind CDN and Google Fonts) to see it. |
| **The approved Workspace Overview has no usable PNG.** Its PNGs are stubs. The two real Overview PNGs (`bw/overview_dashboard*`) show an older "Good morning, Alex" zero-state concept. | Phase 1 was built from `bw/phase_1_foundation_2/code.html`, and verified by rendering it at 1440×900 and comparing element geometry with the app. |
| **Two different shell "skins" exist.** See below. | Resolve before building the next module (§5). |

### The two shell skins

| | Skin B: approved foundation (**implemented**) | Skin A: older operations screens |
| --- | --- | --- |
| Where | `bw/phase_1_foundation_2`, `bw/phase_1_foundation_1`, `climvia_development_handoff`, audit board | `bw/overview_dashboard*`, `bw/bookings*`, `bw/schedule_*` (all the real workspace PNGs) |
| Top bar | Full-width white bar, logo + "Pro", workspace switcher, search with ⌘K, bell, "Alex Morgan / Operations Lead" | No logo in bar, "+ New" menu button, "Alex / Apex Climate Heating & Air" chip |
| Sidebar | White with border, **solid teal** active item, groups Overview / Operations / Business / **Financials** / Growth / Insights | Linen, **mint pill** active item, no Financials group (Quotes, Payments and Plans sit under Business) |
| Cards | 1px border + `shadow-sm` | Borderless, soft shadow |

The Phase 1 brief (Financials group, "Alex Morgan / Operations Lead", the exact search placeholder,
the Overview copy and numbers) matches Skin B on every point, and the handoff and audit board both
describe Skin B. The Skin A PNGs are useful for **page content and layout only**, not chrome.

## 2. Source-of-truth hierarchy

1. `climvia_development_handoff`: locked module map, tokens, status taxonomies, record-boundary rules, acceptance checklist. It states that only frames linked from the Interactive Master are authorized for production, and that old explorations (field-operations/telemetry shells, North Carolina addresses, IVR/emergency-dispatch cards, synthetic BI forecasts) must not be built.
2. `bw/phase_1_foundation_2`: shell and Overview.
3. `warm_operational_clarity/DESIGN.md`: elevation, shape and type guidance.
4. `bw/comprehensive_consistency_navigation_audit_board`: cross-module data locks (customer, services, statuses, totals).
5. Individual module screens (below).

Not product screens, never to be built as UI:
- Governance boards: `climvia_development_handoff`, `bw/comprehensive_consistency_navigation_audit_board`, `bw/interactive_prototype_qa_board`.
- Single-file clickable prototypes with an inline JS router: `bw/comprehensive_interactive_master` (all 16 modules as hidden `<section>`s) and `bw/payments_interactive_master`. Useful for module content and copy; their routing is exactly what must not be copied.

## 3. Production module structure

Locked at 16 modules in 6 groups, one shared shell, no module-specific sidebars. Implemented in
`src/config/navigation.ts`. Status: Overview (Phase 1), Customers and Services (Phase 2), Bookings, Schedule and Jobs (Phase 3),
Team, Quotes & Invoices and Payments (Phase 4), Maintenance Plans and Website (Phase 5), Marketplace, Reviews and Marketing
(Phase 6) and Analytics and Settings (Phase 7) are built; **Help is the one placeholder left** in the real shell.

| Group | Module | Route | Status |
| --- | --- | --- | --- |
| Overview | Overview | `/overview` (Phase 19C; `/` is now the public landing and sends a business member here) | Built |
| Operations | Bookings | `/bookings` | **Built (Phase 3)** |
| | Schedule | `/schedule` | **Built (Phase 3)** |
| | Jobs | `/jobs` (+ `/jobs/[jobId]`, `/work-details`, `/files`) | **Built (Phase 3)** |
| | Customers | `/customers` (+ `/customers/[customerId]`, `/properties`) | **Built (Phase 2)** |
| Business | Services | `/services` (+ `/services/[serviceId]` and 4 tab routes) | **Built (Phase 2)** |
| | Team | `/team` (+ `/team/[memberId]` and 4 tab routes, `/team/roles`, `/team/roles/[roleId]`, `/team/roles/new`) | **Built (Phase 4)** |
| Financials | Quotes & Invoices | `/quotes-invoices` (+ `/quotes/[quoteId]`, `/invoices/[invoiceId]`) | **Built (Phase 4)** |
| | Payments | `/payments` (+ `/payments/[paymentId]`) | **Built (Phase 4)** |
| | Maintenance Plans | `/maintenance-plans` (+ `/maintenance-plans/[planId]`) | **Built (Phase 5)** |
| Growth | Website | `/website`, `/website/pages`, `/website/builder` (the Website Builder, Phase 16; Phase 17 adds `/website/templates`, the Template Gallery, and `/website/templates/[templateKey]`, one Template in full, both reached from the Builder's **Change template**; the Phase 5 page editors at `/website/pages/[pageId]` are superseded and the address redirects to it), `/website/booking`, `/website/domain`; the signed-in Draft preview outside the shell at `/website/preview` (+ `/services`, `/about`, `/contact`, `/booking`, `/booking/[serviceSlug]`) and, since Phase 15, the same pages published for anyone at `/sites/[siteSlug]` (+ the same page addresses) | **Built (Phase 5); stored and published in Phase 15** |
| | Marketplace | `/marketplace-listing`, `/marketplace-listing/edit` (+ `?setup=1`); signed-in listing preview outside the shell at `/marketplace-listing/preview`; the published listing at `/listings/[listingSlug]` (Phase 15); the public Marketplace at `/marketplace`, `/marketplace/services/[serviceSlug]`, `/marketplace/locations/[locationSlug]` and `/marketplace/services/[serviceSlug]/[locationSlug]`, with booking at `/listings/[listingSlug]/book/[serviceSlug]` (Phase 19B; the business's screens were at `/marketplace` until then) | **Built (Phase 6); stored and published in Phase 15** |
| | Reviews | `/reviews` (+ `/reviews/[reviewId]`) | **Built (Phase 6)** |
| | Marketing | `/marketing` (+ `/marketing/new`, `/marketing/[campaignId]`, `/marketing/[campaignId]/edit`) | **Built (Phase 6)** |
| Insights | Analytics | `/analytics` (tab and date range in the query string) | **Built (Phase 7)** |
| Utility (bottom) | Settings | `/settings`, `/settings/hours`, `/settings/branding`, `/settings/preferences`, `/settings/profile` | **Built (Phase 7)** |
| | Help | `/help` | Placeholder (no Stitch screen exists; see §5) |

Sub-routes: Phase 2 set the pattern. A record is `/<module>/<slug>`, each tab of a record is its own
nested route (`/services/ac-repair-diagnostics/pricing`), and modals and multi-step flows are UI state,
not routes. Suggested for later modules: `/jobs/JB-204`, `/payments/PAY-1001`,
`/maintenance-plans/comfort-care`, `/website/editor/home`, `/settings/business`.

## 4. Reference screens per module

**Bold** = use this one. Plain = other states of the same module. "Dup" = superseded variant.
Folders are under `bw/` unless marked.

"Dup" and **bold** are inferred from the `_refined` / `_approved` / `_final` naming plus the handoff,
not from comparing renders (most PNGs are stubs). Confirm visually when a module's phase starts.

### Overview (Phase 1)
- **`phase_1_foundation_2`**: approved Overview + shell (real `<a>` links, no dead placeholder).
- Dup: `phase_1_foundation_1` (same visuals; JS router + a placeholder route whose container is missing).
- Dup / do not build: `overview_dashboard`, `overview_dashboard_refined` (older "Good morning, Alex" zero-state concept in Skin A; the refined variant shows "Needs attention", "Business pulse" revenue / avg-job-value tiles and "Marketplace verification pending", which conflict with the approved Overview and the no-verification / no-invented-analytics rules).
- Dev-only, **not** product UI: the "Design Primitives & Foundation Verification" block at the bottom of the foundation HTML, and its "Module Foundation Ready" placeholder.

### Bookings
**`bookings_refined`** (real PNG; list + drawer, Requests/Upcoming/Past/Cancelled tabs) · `create_booking_flow` (5-step modal). Dup: `bookings`.

### Schedule
**`schedule_week_view_approved`** (real PNG; 7-day board + detail drawer) · **`schedule_day_view_refined`** (real PNG).
**Phase 3 used `schedule_week_view_final`** (detail panel *below* the board) for Week and `schedule_day_view_refined` for Day; `_approved` (drawer) is superseded. Dup: `schedule_week_view`, `schedule_week_view_refined`, `schedule_day_view`. See §8.
Included-visit scheduling lives under Maintenance Plans.

### Jobs
**`jobs_active_list`** · `jobs_empty_state` · `job_jb_204_overview` · `job_jb_204_work_details` (real PNG) · `job_jb_204_photos_files` · `complete_job_modal_flow`.

### Customers
**`customers_main_list`** · `customer_detail_overview` · `customer_properties_equipment` (Sarah Mitchell, 1402 Kinney Ave).

### Services
**`services_main_catalog`** · `services_empty_state` · `add_service_flow` · detail tabs: `service_detail_overview`, `_pricing`, `_booking_settings`, `_customer_intake`, `_availability_visibility`. Catalog is exactly 6 services (see audit board).

### Team
**`team_main_list`** · `team_solo_owner_state` · member detail tabs `team_member_detail_overview` / `_permissions` / `_schedule_availability` / `_assigned_services` / `_activity` · `add_team_member_flow` · `add_team_member_invitation_sent` · `deactivate_team_member_modal` · `deactivate_team_member_no_upcoming_jobs` · roles: `manage_roles`, `role_detail_technician`, `create_custom_role`.

### Quotes & Invoices
**`quotes_invoices`** · `quote_qt_884_detail` · `invoice_inv_1044_detail` · `invoice_inv_1044_paid_state` · `invoice_inv_1044_unpaid_after_void` · `create_invoice_from_approved_quote`.

### Payments
**`payments_main_list`** · `payments_outstanding_invoices` · `payments_empty_state` · `payment_pay_1001_detail` · `payment_pay_1001_detail_voided_state` · `payment_pay_1001_voided_success` · `void_payment_pay_1001_modal` · record flow: `record_payment_select_invoice` → `record_payment_invoice_inv_1044`.
State-sequence boards (reference for transitions, not routes): `payments_interactive_flow`, `payments_interactive_flow_pay_1008`, `payments_interactive_states_1_to_5`.

### Maintenance Plans
**`maintenance_plans_active_plans`** · `maintenance_plans_all_plans` · `maintenance_plans_upcoming_service` · `maintenance_plans_empty_state` · `maintenance_plan_detail_comfort_care` · `create_maintenance_plan_flow` · `schedule_included_maintenance_visit_flow_1` / `_2` (duplicate pair; diff before use).

### Website
**`website_published`** · `website_private_staging` · `website_empty_state` · `website_pages_content_overview_1` / `_2` (pair) · domains: `website_domain_management_1` / `_2` (pair), `website_domain_connected`, `website_domain_primary_lifecycle`, `website_domain_overflow_menu_open`, `website_remove_custom_domain_flow`, `website_remove_custom_domain_modal_1` / `_2` (pair), `website_custom_domain_removed_restored_climvia`.
Page editors (**superseded in Phase 16 by the Website Builder**; the Stitch editor screens remain the visual reference for the canvas and the inspector; each had default / unsaved / saved-unpublished / customer-preview states): Home (`website_editor_home_page_1` / `_2` pair, `website_editor_interactive_states_flow`), Services (**`website_editor_services_page_refined`**; Dup: `website_editor_services_page`), About, Booking, Contact (+ `…_contact_form_success`), `website_editor_services_page_discard_modal`.
Customer-facing public journeys (outside the operator shell): `website_booking_instant_booking_journey`, `website_booking_request_appointment_journey`, all `*_customer_preview` frames.

### Marketplace
**`marketplace_published_listing`** · `marketplace_first_time_empty_state` · `set_up_marketplace_listing_first_time` · `marketplace_listing_published_success_state` · `marketplace_hidden_listing_state` · `edit_marketplace_listing_published` / `_unsaved_changes` / `_hide_listing_modal` · `marketplace_public_listing_preview` (customer-facing). Their `<title>` says "Website (Domain Management)", a copy-paste artifact; ignore it.

### Reviews
**`reviews_main_list`** · `reviews_empty_state` · `review_detail_awaiting_reply` · `review_detail_responded` · `reply_to_review` · `edit_response` · `request_review`.

### Marketing
**`marketing_campaign_list`** · `marketing_empty_state` · `create_campaign_email` · `create_campaign_sms` · `campaign_review_schedule` · `scheduled_campaign_detail` · `sent_campaign_detail` · `cancel_scheduled_campaign_modal`.

### Analytics
**`analytics_overview`** · `analytics_bookings_jobs` · `analytics_quotes_invoices_payments` · `analytics_maintenance_plans_services` · `analytics_empty_state` · `export_analytics_report_modal`. Strictly read-only reporting.

### Settings
**`settings_business_information`** (owns the canonical business record) · `settings_business_information_unsaved_changes` · `settings_discard_unsaved_changes_modal` · `settings_business_hours` · `settings_branding` · `settings_workspace_preferences` · `settings_my_profile`.

### Help
No Stitch screen. The foundation HTML renders Help as a button with no destination. **Resolved in Phase 8 (§13):** a minimal landing page of links into the workspace.

### Onboarding (outside the 16 modules)
26 folders (`onb/…`, all with real PNGs): a separate pre-workspace setup flow, steps 1–13 with several "refined"/"final" re-takes per step. It will live **outside** the `(workspace)` route group so it does not get the operator shell. Likely-latest per step (confirm visually before building): step 6/7/9/10/13 `_refined`, 11/12 `_final`, step 4 has three variants (`_1`, `_2`, `_progressive_disclosure`), step 8 `_business_trust` vs `_international`.
Review before building: step 8 ("credentials") collides with the no-verification / no-fake-licensing rule.

## 5. Open items for later phases

1. ~~Shell skin vs module PNGs.~~ **Resolved (Phase 2 brief):** the Phase 1 shell (Skin B) is final. Module content from Skin A screens (Bookings, Schedule, Customers, Services all render in Skin A) is rebuilt with the Phase 1 tokens and shell; only layout and content are taken from those screens.
2. ~~Data continuity (INV-1044 / PAY-1008 / PAY-1009).~~ **Resolved (Phase 4):** the post-#PAY-1008 baseline is canonical and `#PAY-1009` is the demo payment on `#INV-1050`. See §9.
3. ~~Help module: no design (above).~~ **Resolved (Phase 8):** a minimal landing page, §13.
4. ~~Schedule week view: `_approved` (drawer) vs `_final` (bottom panel).~~ **Resolved (Phase 3):** `_final`.
5. ~~Notification bell shows an unread dot but has no data source yet.~~ **Resolved (Phase 8):** the bell opens a short "No new notifications" panel and has no unread dot, because there is nothing that produces a notification.

## 6. Product rules that constrain every phase (from the handoff / audit board)

- Website booking → creates a **Booking only** (never a Job, Quote, Invoice or Payment).
- Included maintenance visit → creates a **Booking only** (never an Invoice or charge).
- Review request → standalone invitation (never a campaign, never changes a job).
- Quote → Invoice only through the explicit "Create invoice" action.
- Payments are independent records linked by invoice; voiding restores the invoice balance and keeps history. Voided payments are excluded from "received" totals.
- Locked status vocabularies: Bookings (Confirmed, Completed, Pending confirmation, Cancelled) · Jobs (Scheduled, In progress, Completed) · Quotes (Draft, Sent, Approved, Declined, Expired) · Invoices (Paid, Unpaid, Partially paid) · Payments (Recorded, Voided) · Reviews (Awaiting reply, Responded) · Marketing (Draft, Scheduled, Sent).
- No telemetry, dispatch-fleet, ledger, BI-forecast, verification-badge, unverified-claim or "Module Foundation Ready" UI anywhere.

## 7. Phase 2: Customers and Services

Built from `customers_main_list`, `customer_detail_overview`, `customer_properties_equipment`,
`services_main_catalog`, `services_empty_state`, `service_detail_overview` / `_pricing` /
`_booking_settings` / `_customer_intake` / `_availability_visibility` and `add_service_flow`.
All were rendered in a browser (their PNGs are stubs) and read for content and layout only.

### Source conflicts and how they were resolved

| Conflict in Stitch | Decision |
| --- | --- |
| Customer is "Elena **Rodriguez**" on the Customers list and Jobs list, but "Elena **Rostova**" on the audit board, Schedule, Payments and Reviews. | Used **Rodriguez** (the dedicated Customers screen, with its phone and address). **Locked in Phase 3**: Rodriguez is canonical everywhere and "Rostova" is stale Stitch data; a test fails if it appears in `src/`. |
| Sarah's customer ID is `#CUS-0842`, `CUS-08429` and `#4092`; "customer since" is May 2022 and April 2021. | Not shown. Routes use slugs (`sarah-mitchell`). |
| Equipment: Honeywell T6 Pro (Overview tab) vs Ecobee Smart Thermostat Premium (Properties tab); 16 SEER vs "19VS"; 4-ton on other screens vs 3.0 ton. | Used the **Properties & equipment screen** throughout (Carrier Infinity 19VS, 3.0 ton; Ecobee). SEER omitted. |
| Gate/access text differs between Overview and Properties tabs. | One field, Properties-tab wording. |
| Maintenance plan: "Annual Comfort Care" (list/detail), "Comfort Care" (handoff, audit board); renewal date May 14 vs May 18, 2025. | "**Comfort Care**", $189/yr, 2 visits/yr. Renewal date omitted. |
| Other customers' plans ("Comfort Plus", "Seasonal Maintenance") differ from the Maintenance Plans screens ("Seasonal Maintenance $29/mo" for David Chen). | Kept as shown on the Customers list. **Resolved in Phase 5 (§10):** the Maintenance Plans screens win, so David Chen's plan is "Seasonal Maintenance". |
| Catalog shows 8 services (adds Commercial Rooftop Unit Maintenance and Internal Warranty Callback); "Heat Pump Diagnostic & Repair" (singular) vs the handoff's "Diagnostics & Repair". | Exactly the **six** locked services, with the handoff's exact names. |
| Emergency service says "Emergency handling enabled". | Dropped. Booking method is plain "Request appointment". |
| Service code is `SVC-AC-01` on Overview and `SVC-ACR-8840` on Booking settings. | Service code omitted. |

### Deliberately not built (no approved flow, or outside the Phase 2 rules)

- **Customers:** KPI tiles (142 / 38 / 168 / "Follow-up needed" are fabricated against 5 rows), the Commercial
  account row (Oakridge: refrigeration work, not an approved service), "+1 rental" (no second address exists),
  service-area and recent-service filters (need regions and a clock), Add customer, Message/SMS composer,
  Add note/property/equipment, Log service, photos, the Service history / Financials / Activity tabs (no
  designs exist), Financial summary (self-contradictory: "1 invoice" and "no invoice created yet").
- **Services:** KPI tiles, grid view, Duplicate service, service media, tax and surcharges, waive-fee/credit
  rule, service-area zones, operating hours and technician eligibility (belong to Settings and Team),
  buffer/notice and confirmation-automation sections, the intake question builder (add/edit/delete/reorder),
  wizard presets and the Intake step, the "Internal only" booking method (visibility covers it).
- **Service empty state:** reachable through `/services?state=empty` as a design-preview hook, because the
  catalog cannot be emptied from the UI.

### Demo state

Add Service, Save changes and Activate/Deactivate edit an in-memory copy of the catalog
(`ServicesProvider`). Fixtures in `src/data/services.ts` are never written to, and a reload restores the six
canonical services. (Phase 3 update: jobs and bookings now live in `src/data/operations.ts`; `Customer.jobs` was
removed and the Customers pages look jobs up by customer id. `lastService` and `upcoming` remain display text.)

## 8. Phase 3: Bookings, Schedule and Jobs

The operational core. All three modules read one typed dataset (`src/data/operations.ts`) that references the
Customers, Properties, Equipment, Services and Team fixtures by id. Nothing in it repeats a customer, service or
technician name: they are looked up.

### Reference screens used

| Module | Screen (folder under `bw/`) | Used for |
| --- | --- | --- |
| Bookings | **`bookings_refined`** | Header, Requests / Upcoming / Past / Cancelled tabs, filters, table columns, booking details panel, statuses |
| | **`create_booking_flow`** | The five steps: Customer, Service & property, Date & time, Assignment, Review |
| Schedule | **`schedule_week_view_final`** | Week board (Mon–Sun columns, Today highlight, closed Sunday), "Unassigned" banner, detail panel *below* the board, "Central Time (CT)" |
| | **`schedule_day_view_refined`** | Day view: Unassigned panel left, technician timelines, detail panel right |
| Jobs | **`jobs_active_list`** | Job table and columns (Job, Customer, Service, Scheduled window, Technician, Status, Property, action) |
| | **`jobs_empty_state`** | Empty state ("No jobs yet", one action) |
| | **`job_jb_204_overview`**, **`_work_details`**, **`_photos_files`** | The three job tabs |
| | **`complete_job_modal_flow`** | Complete Job modal |

Ignored as stale or duplicate: `bookings` (superseded by `_refined`); `schedule_week_view`, `schedule_week_view_refined`,
`schedule_week_view_approved` (drawer layout, superseded by `_final`); `schedule_day_view`. The blurred "Bookings Queue" behind
`create_booking_flow` is a backdrop, not a screen. Chrome from every one of these (Skin A: "+ New" menu, linen sidebar, mint pill,
"Alex / Apex Climate Heating & Air" chip, bell dot) was ignored; the approved Phase 1 shell is unchanged.

### Domain model and relationships

```
Customer ──< Property ──< Equipment            Service (catalog)         Team member
    │            │                                  │                        │
    └────────────┴──────── Booking ─────────────────┴────────────────────────┤
                              │  1 ── 0..1                                  │
                              └──────── Job ────────────────────────────────┘
Schedule events = derived from Jobs, then Bookings that have no Job, plus internal blocks (nothing stored)
```

- `Booking` and `Job` carry **exactly one** of `customerId` or `contactName`. `contactName` is a snapshot for the requesters and one-off
  visits Stitch shows who have no Customers record (Claire Dubois, Jason Miller, Robert Ramirez, Olivia Romero, Arthur Pendleton,
  Liam Foster). No phone, email or address is invented for them; the UI says "No customer record yet".
- A booking's `jobId` and the job's `bookingId` always agree, as do their party, service, property, time and technician. A completed
  job means a completed booking; unfinished work is a confirmed booking. A test enforces all of this.
- The Schedule has no events of its own. Pending and cancelled bookings never appear on it; "Unassigned" simply means confirmed or
  scheduled work with no `assigneeId` (it is not a status).
- Customers no longer own job data: `Customer.jobs` was removed, and the customer Overview reads `getJobsForCustomer`
  (`CustomerWork.tsx`), so completing a job elsewhere is reflected there. `getBookingsForCustomer` is available for the
  Customers phase that adds a bookings view; no approved Customers screen shows one yet.
- Selectors: `getBookingById`, `getJobById`, `getBookingsForCustomer`, `getJobsForCustomer`, `getScheduleEvents`,
  `getScheduleEventsForDate`, `getUnassignedEvents`; each takes optional data so the fixtures and the in-memory demo state share logic.
- Overview aggregates stay aggregates: **Bookings 24** and **Completed Jobs 18** (also the sidebar badges) are not derived from the
  fixtures, and no 24 / 18 placeholder records were created.

### Fixture dataset (canonical, deterministic)

"Today" is **Friday, October 25, 2024** (`PROTOTYPE_TODAY`; `PROTOTYPE_NOW` is 10:45 AM), the date on the Schedule screens' TODAY badge, never the
real clock. Times are business-local wall-clock in **America/Chicago** with no timezone conversion, so the pages render identically in any
browser timezone (a test runs the Schedule in four).

- Bookings: BK-1040 and BK-1038 pending; BK-1042, 1041, 1039, 1035, 1028, 1014 confirmed; BK-1006 to BK-1010 completed; none cancelled.
- Jobs: JB-204 (full details and 4 files; **completed since Phase 7**, §12), JB-201, 198, 195, 189 scheduled; JB-186, 184, 182, 180, 178, 142 completed.
- Internal blocks: Team Safety Training (Tue Oct 22, everyone) and "Training / Off duty" (Fri Oct 25, Samira Patel).
- Team: Alex Morgan (Operations Lead, the signed-in user), Marcus Vance (Technician), Samira Patel (Technician).
- **JB-204 = Sarah Mitchell, AC Repair & Diagnostics, 1402 Kinney Ave**, booked as BK-1042. It is never renamed or repurposed.

### Source conflicts and how they were resolved

| Conflict in Stitch | Decision |
| --- | --- |
| Customer is "Elena Rodriguez" (Customers, Jobs) vs "Elena Rostova" (Schedule, audit board). | **Rodriguez** everywhere, as instructed. |
| `bookings_refined` is dated "Tomorrow, Oct 25" (so today would be Oct 24); the Schedule and Jobs say today is Oct 25. | Today is Oct 25. Dates are shown as weekday + date, never "Tomorrow". |
| Weekday labels on the Bookings screen are wrong for 2024 ("Fri, Oct 26", "Sat, Oct 27", "Mon, Oct 29"). | The date is the source and the weekday is computed from it (Oct 26 is a Saturday, Oct 28 a Monday). |
| BK-1042 is "New / pending" on Bookings, "Confirmed" on the Schedule, and has a job on Jobs. | **Confirmed**, with job JB-204. *(Phase 7: BK-1042 and JB-204 are now **Completed**, §12 Part 0.)* |
| Tab counts on Bookings (3 / 4 / 12 / 0) do not match the rows. | Counts are derived from the records (2 / 6 / 5 / 0). |
| Jobs statuses "En route", "Waiting – Parts", "Needs assignment". | Not statuses. Jobs are Scheduled, In progress or Completed; "Needs assignment" is "Unassigned" with an Assign action. |
| Jobs KPI strip (Needs assignment 2, Scheduled 5, In progress 3, Waiting 1, Completed 14) and tab counts 11 / 8 / 14 / 2. | Not built (they would be invented against 5 rows). Tabs are Active, Upcoming, Completed with derived counts. No Cancelled jobs tab: jobs have no cancelled state. |
| Sarah's phone is (512) 843-9912 on Jobs, (512) 555-0194 elsewhere; her unit is "Lennox XC21 4-ton" on Jobs, a Carrier heat pump elsewhere; gate code 4421 vs 4412. | The Customers record wins: (512) 555-0194, Carrier Infinity 19VS 3.0 ton, gate code #4412. |
| Claire Dubois and Jason Miller are "Requests" on Bookings but "Confirmed work awaiting assignment" on the Schedule banner. | They are **pending requests** and stay off the Schedule. The unassigned items are Elena Rodriguez (BK-1035) and Robert Ramirez (BK-1041). |
| Claire's service is "Heat Pump Assessment" and Jason's "Ductless Mini-Split Consultation", with booking methods that differ between screens; neither name is a catalog service. | Canonical services only: Claire = Heat Pump Diagnostics & Repair, Jason = Ductless Mini-Split Installation & Estimate. The booking method comes from the catalog, never from the booking. |
| Robert Ramirez appears on Oct 25 (completed), Oct 26 and Oct 28. | Two visits: BK-1010 / JB-186 completed Oct 25, and BK-1041 confirmed Oct 28 (Furnace Safety Inspection & Tune-Up). |
| Hannah Wright is booked Saturday 2:00 PM, but Saturday hours end at 2:00 PM. | Kept, because the approved Customers list shows it. The Create Booking flow itself refuses slots outside business hours. |
| Services on these screens that are not in the catalog (Full Duct Sanitization, Gas Furnace Pilot Check, Capacitor Replacement, Commercial Refrigeration…). | Mapped onto the six canonical services or dropped. The Oakridge Cafe commercial job was not built. |
| People that appear on a single Schedule screen only (Brandon Vance, Travis Green, Mei-Ling Zhao, Harrison Wade, Kendra Brooks, Carlos Santana, Wayne Cooper…). | Not built. Only people who appear on more than one approved screen, or are required by the brief, exist. |
| "Alex (Owner)", "Lead HVAC Tech". | Alex Morgan, Operations Lead (the signed-in user). |

### Create Booking rules

- Customer and property come from the shared records. Selecting Sarah Mitchell selects her only property, **1402 Kinney Ave, Austin, TX 78704, Home**.
- The six canonical, active services are offered. Their booking method decides the slots: instant booking offers exact start times
  (9:00, 11:30, 2:00, 4:00), request appointment offers 2-hour arrival windows, request quote / assessment offers consultation slots.
- Availability comes from the structured business hours (Mon–Fri 7:30–6:00, Sat 8:00–2:00, Sun closed; a test keeps them in step with the
  Overview's strings) and from the fixed "today". Nothing reads the real clock.
- Creating adds a **confirmed** booking to this session's in-memory data, shows a success state, and returns to Bookings → Upcoming with the
  booking open. A reload resets it. Overview's "New booking" (header and quick action) and the customer page's "New booking" open this one flow
  at `/bookings?new=1` (the customer page also preselects the customer); there is no second implementation.

### Deliberately not built

- **Bookings:** the Date filter, the "All / New / Needs confirmation / Needs customer response" chips, "Suggest another time", "Message customer",
  intake photos, the activity timeline ("Automated confirmation email sent"), customer "New / Returning" tags, pagination, a "+ New" menu.
- **Schedule:** drag-and-drop and its hints, "Block time", the service-area filter, "Quick Assign", the "Overlap" badge, "2 open windows available",
  "Emergency requests enabled", Reschedule / Change slot, and any map, route, travel time, GPS, capacity or optimization feature.
- **Jobs:** "Create Job" (a job is created from a confirmed booking), the status KPI strip, the table / calendar display toggle, the date and area
  filters, the row overflow menu, and any cloud or file-upload backend.
- No Quote, Invoice or Payment is created by completing a job (a test asserts this against the state and against the screens).

### Demo state

`OperationsProvider` (mounted once in the workspace layout, so it survives navigation between modules) holds the active business's bookings, jobs and
blocked time as the server read them from PostgreSQL (Phase 11). Creating a booking, confirming or declining a request, assigning, creating / starting /
completing a job and saving work details each call a server action (`src/server/actions/operations.ts`) that authorizes, validates and stores the change
in one transaction; the screen adopts the stored result, so a reload keeps it. The canonical records live in `scripts/db/seed-data/operations.ts` (seed
only). Photo upload is local to the page session (file name and size only; nothing is read or sent) and is labelled so; visibility of a stored photo is stored.
`/jobs?state=empty` previews the empty state, as `/services?state=empty` does.

### Unresolved source contradictions (for later phases)

1. Customers' `lastService` and `upcoming` are still the display text from the Phase 2 list. Their dates agree with the bookings (a test checks it),
   but the text is not yet derived.
2. ~~Maintenance-plan names and prices for customers other than Sarah Mitchell remain unreconciled.~~ **Resolved (Phase 5, §10).**
3. ~~Team members, contact details and permissions.~~ **Resolved in Phase 4** (§9): `src/data/team.ts` is now the Team module's dataset.
   Settings will still own business hours and the timezone; until then `businessHoursByWeekday` (now `scripts/db/seed-data/apex.ts`, seed and test data) stood in.
4. ~~The Overview's 24 bookings and 18 completed jobs, and the sidebar badges, remain fixed aggregates until Analytics defines how they are counted.~~ **Resolved (Phase 14):** they are the current month's totals of the Analytics report, the stored rows plus the sample business's imported adjustments ([saas-architecture.md §27](saas-architecture.md#27-marketing-and-analytics)).
5. Several Stitch people have no Customers record (listed above). Whether they become customers on confirmation is a Customers / Bookings decision.

## 9. Phase 4: Team, Quotes & Invoices and Payments

Three modules on shared typed data. Team extends `src/data/team.ts` (the same identities Bookings, Schedule and Jobs
already use); the financial modules read one dataset, `src/data/financials.ts`, whose quotes, invoices and payments point at
each other and at the Customers, Services, Jobs, Bookings and Team fixtures by id. Every financial total is **derived** from
those records by selectors, never typed onto a screen.

### Reference screens used

| Module | Screens (folder under `bw/`) | Used for |
| --- | --- | --- |
| Team | **`team_main_list`**, `team_solo_owner_state` | List, summary tiles, filters, Resend, solo-owner message (`/team?state=solo`) |
| | **`team_member_detail_overview`**, `_schedule_availability`, `_permissions`, `_assigned_services`, `_activity` | The five member tabs |
| | **`add_team_member_flow`**, `add_team_member_invitation_sent` | Add team member (5 steps) and the Invitation sent state |
| | **`manage_roles`**, `role_detail_technician`, `create_custom_role` | Roles list, role detail, Create role |
| | **`deactivate_team_member_modal`**, `deactivate_team_member_no_upcoming_jobs` | Deactivate confirmation, with and without upcoming Jobs |
| Quotes & Invoices | **`quotes_invoices`**, `quote_qt_884_detail`, `create_invoice_from_approved_quote` | Lists, QT-884, Create invoice |
| | **`invoice_inv_1044_detail`**, `_paid_state`, `_unpaid_after_void` | One invoice page that renders all three states from the records |
| Payments | **`payments_main_list`**, `payments_outstanding_invoices`, `payments_empty_state` | Main list, Outstanding invoices tab, empty state (`/payments?state=empty`) |
| | **`record_payment_select_invoice`**, `record_payment_invoice_inv_1044` | Record payment, step 1 (choose invoice) and step 2 (amount, method, date) |
| | **`payment_pay_1001_detail`**, `_detail_voided_state`, `payment_pay_1001_voided_success`, `void_payment_pay_1001_modal` | Payment detail, Void payment, voided state |
| Baseline | `payments_interactive_states_1_to_5`, audit board | The post-#PAY-1008 numbers and the eight payment rows |

Ignored: the pre-#PAY-1008 variants of the Payments screens (6 payments, $1,845, 3 outstanding, $965), `payments_interactive_flow*`,
`payments_interactive_master`, and the Skin A chrome ("+ New" menu, Receivables & Cashflow shell on `record_payment_select_invoice`).

### Team: source-of-truth decisions

- **Three people, no fleet.** Alex Morgan (Operations Lead, access role Owner), Marcus Vance (Technician) and Samira Patel (Technician) are the
  only members, the same ids Bookings, Schedule and Jobs reference. Stitch's Team list also shows "Elena Rostova, Service Coordinator"; that is the stale
  spelling of customer Elena Rodriguez, so she is not a team member. More people arrive through Add team member.
- **Samira Patel is Active.** Stitch lists her as "Invitation pending", but the Schedule and Jobs (approved in Phase 3) have her completing and
  holding work. Operational history wins. The pending-invitation state (Resend, "Pending invites") is reached by inviting someone.
- **Contact details are only values the screens agree on.** Marcus: marcus.v@apexclimate.com, (512) 555-0144. Samira: samira.hvac@gmail.com,
  (512) 555-0199. Alex: (512) 555-0100 only. Stitch gives Alex two different emails (apexclimate@service.com, alex@apexclimate.com), so none is shown.
  Marcus's pro-domain email and (555) 382-9102 on the deactivate screens are stale.
- **Job title vs role.** `role` is the title Schedule and Jobs already show ("Operations Lead", "Technician"); `roleId` is the access role from the
  Roles screen; `title` is the longer title the Team list shows ("Senior HVAC Technician"). Alex's "Owner & Managing Director" is stale.
- **Roles.** Seven roles (6 system, 1 custom) with the descriptions on the Roles screen. Stitch only draws the Technician's access; the other
  levels are set from each role's description. Permissions use the 16-module grouping of the role screens (not the 13-row grouping on the
  member tab). They are demo configuration only: nothing authenticates or enforces them.
- **Assigned services** are ids from the six-service catalog; all three members are eligible for all six (Stitch: everything except Commercial).
  A test checks every booking and job is for a service its assignee is eligible for.
- **Availability** is a configuration (business hours / custom weekly hours with a break / set later, plus unavailable periods), not events. Marcus's
  custom hours are the dedicated screen's (Mon-Fri 8:00-4:30, 12:00-12:30 break); the list and Overview screens disagree.
- **Deactivate** blocks until the member's upcoming work has been reassigned *by hand* (View job / Reassign per assignment); it never reassigns
  automatically and never rewrites completed Jobs or past bookings, which keep showing the member's name. The owner can't be deactivated.
- **Activity** is a short list of representative entries (Marcus's are the Stitch ones, re-pointed at real Phase 3 jobs: JB-201 and JB-186 instead of
  JB-204 and JB-198), plus an entry for each change made in the session.

### Financial record relationships

```
Customer ──< Property        Service        Team member
    │            │              │               │
    ├── Quote ───┴─ job/booking ┤  recordedBy   │
    │     └── (invoice found via Invoice.quoteId)
    └── Invoice ──< Payment ──── recordedBy ────┘
Status of an invoice, its paid amount and balance = derived from its line items, previouslyPaid and its active (non-voided) payments
```

- `Quote`, `Invoice` carry exactly one of `customerId` / `contactName`, like bookings and jobs. Payments name only their invoice; the customer is
  read through it, so no identity is copied. Kevin Vance, Amanda Diaz, Marcus Bell, Robert Miller, Arthur Pendleton and Maya Lin are snapshots.
  David Chen, Elena Rodriguez and Sarah Mitchell link to their Customers records.
- Selectors: `getQuoteById`, `getInvoiceById`, `getPaymentById`, `getInvoiceBalance`, `getOutstandingInvoices`, `getPaymentsReceivedTotal`,
  `getRecordedPaymentsCount` (plus `getOutstandingBalance`, `getInvoiceStatus`, `getTotalInvoiced`). Each takes optional data so fixtures and the
  session copy share one implementation.
- Completing a Job still creates no quote, invoice or payment (Phase 3 behaviour is unchanged).

### Baseline financial invariants (all asserted by tests)

| Quantity | Canonical value | How it arises |
| --- | --- | --- |
| Payments recorded | **7** | PAY-1002 to PAY-1008 are Recorded; PAY-1001 is Voided and excluded |
| Amount received | **$2,130.00** | 285 + 400 + 180 + 210 + 450 + 320 + 285 |
| Outstanding invoices | **2** | INV-1050 and INV-1051 only |
| Outstanding balance | **$680.00** | $300 (INV-1050: $500 total, $200 previously paid) + $380 (INV-1051) |
| INV-1044 | Paid, balance $0 | Paid by PAY-1008 ($285); never offered in Record payment |
| Overview | $6,240 invoiced, $2,130 received, "7 recorded non-voided payments" | Payments are derived and equal the approved figures; $6,240 is a fixed approved baseline |

### `#PAY-1009` transition (stored since Phase 12)

Record payment (from Payments, the Outstanding tab, an invoice page or the Overview quick action; all open the same `RecordPaymentModal`):
choose `#INV-1050` (Arthur Pendleton, balance $300) → full payment defaults to $300, balance after $0 → Record payment creates **`#PAY-1009`**
(Check, dated Oct 25, 2024, Recorded) → `#INV-1050` becomes **Paid** with a $0 balance → after Close, Payments shows **8 recorded, $2,430.00 received,
1 outstanding invoice, $380.00** and the Outstanding tab lists only `#INV-1051`. `#PAY-1008` and the voided `#PAY-1001` are untouched.
**Phase 12:** the payment is no longer held in the page. The server records it in PostgreSQL (`payments`, one transaction that locks the invoice, checks the balance and
takes the business's next PAY- number) and answers with the financials as stored, so the totals above survive navigation, a reload and a new session; the earlier "a reload restores the baseline" behaviour is gone.
A partial payment leaves the invoice Partially paid and outstanding. Overview "Payments Received" and its payment count follow the same data. The void flow below is stored the same way: the voided payment stays in history and the reopened balance survives a reload. See `docs/saas-architecture.md` §25.

### Historical void flow (kept separate)

- `#PAY-1001` is the historical corrective payment: it is shown as **Voided** (reason "Payment entered by mistake", Oct 25, 2024, Alex Morgan),
  contributes nothing, and has no Void action. It is never reused for a new payment.
- **Void payment** is a separate flow on any *Recorded* payment's detail page: choose a reason, see the invoice impact, confirm, then a voided
  confirmation. It marks that payment Voided, reopens its invoice and recomputes every total; it never creates a payment. Voiding PAY-1008 in a
  session reproduces Stitch's earlier figures exactly (6 recorded, $1,845, 3 outstanding, $965), and INV-1044 then shows the Unpaid-after-void
  banner. Record payment never routes through the void screens.

### Create invoice from the approved quote

QT-884 (Sarah Mitchell, $285, Approved, Job JB-204) opens the Create invoice dialog showing the quote's three line items, terms and a billing
summary ("Invoice number: Assigned when created", initial status Unpaid). Creating adds **`#INV-1052`** (next number) to the session, linked to the
quote; the quote then reads "Invoice #INV-1052" and can't be invoiced again. No payment is created; the new invoice is simply outstanding
(Payments then shows 3 outstanding, $965.00), and the Overview's Total Invoiced becomes the approved $6,240 plus the session's new invoices.

### Source conflicts and how they were resolved

| Conflict in Stitch | Decision |
| --- | --- |
| INV-1044 is "From Quote #QT-884" on its screens, but the approved QT-884 screen says "No invoice created yet" and the brief requires the Create invoice flow from QT-884. | INV-1044 keeps its customer, job JB-204, booking and line items but has **no source-quote link**; QT-884 is ready for invoicing. The audit board only says both belong to job JB-204. |
| INV-1044 is Unpaid with PAY-1001 recorded in some variants, Unpaid after the void in another, and the record-payment variants offer it for payment. | Canonical baseline: **Paid** by PAY-1008 ($285, Oct 28). PAY-1001 is Voided history. The payable-INV-1044 screens are stale. |
| Pre-#PAY-1008 numbers (6 payments, $1,845, 3 outstanding, $965) on the Payments screens. | Post-#PAY-1008: 7, $2,130, 2, $680 (audit board and `payments_interactive_states_1_to_5`). |
| INV-1050 shows "$200 paid" but no payment record backs it, and the approved received total is exactly the seven recorded payments. | The $200 is `previouslyPaid` on the invoice (money received before payments were recorded). It counts toward the balance but is not a Payment, so "payments recorded" and "amount received" stay at the approved values. |
| Invoice totals: Stitch's list claims 16 invoices (12 paid, 4 unpaid) and the Overview says $6,240 invoiced; the invoices the screens actually show total $3,010. | The list shows the nine invoices that exist; the tiles are derived (7 paid, 2 unpaid). $6,240 stays the approved Overview aggregate (the audit board locks it), with session-created invoices added. |
| Quotes: Stitch counts 7 quotes (Open 3, Approved 2) but shows 5 rows; QT-866 is a commercial refrigeration quote for "Oakridge Hospitality / Cafe". | Four quotes (QT-884, 891, 893, 879). Oakridge is the commercial account Phase 2 and 3 already left out. The Expired status exists but has no record. Tiles are derived. |
| Quote and service names ("Heat Pump Repair", "Heat Pump Assessment", "Mini-Split Tune-Up", "Seasonal Heat Pump Tune-up"). | Mapped to the canonical service names where a service applies; neutral line items ("HVAC service visit") where the screens give none. |
| Customer name "Elena Rostova" on PAY-1006 / INV-1048; "Arthur Pendelton" on INV-1050. | Elena Rodriguez (linked to her record); Arthur Pendleton (the spelling Phase 3 and the brief use). |
| Invoice delivery state ("Sent"), email/SMS sent, Download PDF, Print, Send invoice, "Billed to RES-40921" account ids, license numbers, technician payout. | Not built: no sending, PDF, accounts or licensing. Invoice status is only Paid / Unpaid / Partially paid. |
| Sarah's address on the record-payment variant (1428 Elm Ridge Parkway) and phone (555-0193); "Eleanor Vance / 1084 Crestline Rd" on the void-success screen. | Canonical Sarah Mitchell, (512) 555-0194, 1402 Kinney Ave. |
| Payment dates (Oct 25-28, 2024) run past the Schedule's fixed "today" (Oct 25). | Financial dates are record data and nothing derives from today. The record-payment date defaults to the fixed today (Oct 25, 2024) and can be changed; payments sort by number. |
| Invoice dates for INV-1043, 1045-1049 are not shown anywhere. | Set to the payment date, or the day before for INV-1048 and INV-1049, so invoice numbers and dates ascend. |
| Stitch's "Ledger Timeline", "audit history", "settlement", "technician payout", "Payment allocation & balance reconciliation". | Reworded ("Activity", "history", "Operational notice"); a source scan rejects ledger, reconciliation engine, accounting sync and payment gateway wording. |

### Deliberately not built

- **Team:** Edit profile, Add credential and the credentials panel (licence numbers conflict with the no-fake-licensing rule), skills tags, ratings,
  completed-job and first-time-fix statistics, capacity and utilization, connected-device and security-score panels, service vehicle, GPS, travel buffer,
  daily job limits, the "Weekly calendar footprint" (it would duplicate the Schedule), profile photo upload, "Revoke invitation", role Deactivate
  and a "Pending setup" member (Samira is Active).
- **Quotes & Invoices:** Create quote, Edit quote, Send again, Send invoice, Download PDF, Print, the Date filter (no clock), line-item editing in the
  Create invoice dialog (shown read-only), custom due dates.
- **Payments:** CSV export, Print receipt, "Technician payout", any gateway, bank or card processing.

### Unresolved dependencies for later modules

1. **Total Invoiced ($6,240)** and the Analytics figures built on it: the nine invoices total $3,010, so the Overview total is a fixed baseline plus
   the invoices made since (Phase 12: stored invoices that are not `imported`). It is a reporting baseline, deliberately not backed by invented rows. **Phase 14:** Analytics now reads PostgreSQL, and the baseline is a signed imported adjustment (`analytics_imported_baselines`) added to the stored invoices, so a new invoice still moves the total by exactly its own amount.
2. ~~**Maintenance Plans** will create Bookings only.~~ **Done (Phase 5):** scheduling an included visit creates a Booking and nothing financial; no plan invoices exist.
3. **Settings** will own business hours, timezone and tax settings; Team's availability presets and the invoice "Tax $0.00" line stand in until then.
4. ~~**Customers** has no bookings, quotes or invoices view yet.~~ **Done (Phase 12):** the customer page lists the customer's quotes, invoices (with balance) and payments from the stored records.
5. People with a `contactName` snapshot in Bookings, Jobs and the financial records (Claire Dubois, Arthur Pendleton, Maya Lin…) have no Customers record.
6. Roles are configuration only. Real authorization needs sign-in, which no phase has introduced.

## 10. Phase 5: Maintenance Plans and Website

> **Phase 13 update.** Maintenance Plans are stored in PostgreSQL (plans, coverage, included visits; see [saas-architecture.md §26](saas-architecture.md#26-maintenance-plans-and-reviews)). Everything below that says "nothing persists" no longer holds for plans:
> a created plan and a scheduled visit survive a reload, BK-1048 is the one real booking the visit points at, and `lib/maintenance-plans-state.ts` was replaced by `lib/maintenance-rules.ts` and server actions. The Website part is unchanged.

Two modules on two new typed datasets, `src/data/maintenance-plans.ts` and `src/data/website.ts`, each with pure state
functions (`src/lib/maintenance-plans-state.ts`, `src/lib/website-state.ts`) and a client provider. All providers mount
together (`WorkspaceProviders`, mounted by the `(signed-in)` layout that holds both the workspace and the signed-in preview), because the customer-facing
website preview sits outside the workspace shell yet reads what was saved inside it. The published Sites and listings mount none. Nothing persists:
reload restores the baseline. The Phase 1 to 4 modules, tokens and tests are unchanged except where listed under
"Deliberate changes to earlier work".

### Reference screens used

- **Maintenance Plans:** `maintenance_plans_active_plans`, `_upcoming_service`, `_all_plans`, `_empty_state`, `maintenance_plan_detail_comfort_care`,
  `create_maintenance_plan_flow`, `schedule_included_maintenance_visit_flow_1/_2`.
- **Website:** `website_published`, `website_private_staging`, `website_empty_state`, `website_pages_content_overview_1/_2`,
  the five editors (`website_editor_home_page_*`, `_services_page_refined` and its unsaved / saved-unpublished / discard-modal states, About, Contact, Booking),
  `website_booking_request_appointment_journey`, `website_booking_instant_booking_journey`, the contact form success, `website_domain_connected`,
  `_domain_overflow_menu_open`, `_remove_custom_domain_modal_1/_2`, `_custom_domain_removed_restored_climvia`.

### Maintenance Plans: fixture relationships

- A plan holds `customerId` and `propertyId` (or a `contactName` / `propertyText` snapshot for people with no Customers record), its terms, its coverage
  and its visits. Coverage is two maintenance definitions, **Cooling maintenance** and **Heating maintenance**; they are not public Services, but each names
  the canonical Service its visit is booked as (`annual-cooling-tune-up`, `furnace-safety-inspection`).
- A visit that is scheduled holds `bookingId`; the Booking holds `planVisit: { planId, visitId }`. There is one appointment record, the Booking, which Bookings and
  Schedule already show. A visit's state (completed, scheduled, needs scheduling, not scheduled) is **derived** from its Booking, so cancelling the booking reopens the visit.
- The workspace totals are the approved aggregates, **14 active, 5 visits due, 3 upcoming renewals, 2 paused or ended (1 + 1)**, held as `PLAN_BASELINE`. The six plans in the
  dataset are a representative sample, not 24 invented records; plans created in a session add to the totals the way the approved ones do.
- Seeds: Sarah Mitchell and David Chen (Customers records), Kevin Vance and Arthur Pendleton (active, snapshots), Robert Miller (paused), James Thornton (ended).
- Customers reads the plan through `getCustomerPlanSummary`: the plan record when there is one, otherwise the older Customers-list label (Bradley Cooper's "Seasonal Maintenance").
  `maintenancePlan` was removed from Sarah and David so there is one source for them.

### Sarah Mitchell's Comfort Care (locked, asserted by tests)

1402 Kinney Ave, Austin, TX 78704 ("Home") · Comfort Care · **$189 / year** · **2 visits / year** · May 14, 2024 to May 14, 2025 · Active · coverage Cooling maintenance and Heating maintenance only.
Visit 1 (Heating maintenance) is recorded as fulfilled on May 22, 2024 with no Booking or Job link (see conflicts). Visit 2 (Cooling maintenance) is scheduled for November 2024 as BK-1048 (below); since Phase 13 a clean seed already stores that booking.

### BK-1048 integration

Schedule included visit (4 steps: Service, Date & time, Assignment, Review) creates one Booking in the shared operations store and links the visit to it:
**BK-1048 · Cooling maintenance (booked as Annual Cooling Tune-Up & Maintenance) · Visit 2 of 2 · Tue Nov 19, 2024 · 10:00 AM to 12:00 PM · Marcus Vance (Technician) · Confirmed**,
source "Maintenance plan". It appears in Bookings (Upcoming 6 to 7, labelled "Comfort Care · Visit 2 of 2"), in Schedule on Marcus Vance's Nov 19 row, and on the plan.
**No Job, Quote, Invoice or Payment is created**; the Phase 4 baselines ($6,240 total invoiced, $2,130 received, $680 outstanding, 7 payments) are untouched.
**Phase 13:** BK-1048 is part of the stored baseline (Upcoming 6 before anything is scheduled) rather than a number held for later: `RESERVED_BOOKING_NUMBERS` is gone, the visit points at the booking, the plan offers no second Schedule visit for it, and every other booking takes the next free number and skips 1048 (the sample counter still starts at 1043).

### Plan labels: resolved and omitted

- **Resolved:** the final Maintenance Plans screens win over the older Customers-list labels, so David Chen's plan is "Seasonal Maintenance" ($29 / month), not "Comfort Plus".
- **Kept:** Bradley Cooper's "Seasonal Maintenance" label has no detailed plan record behind it and stays as a legacy label.
- **Omitted rather than invented:** the commercial plan, plans for Elena Rodriguez / Maya Lin, and plans whose Stitch rows name Bookings that conflict with other records
  (BK-1055, BK-1058; BK-1014 is Hannah Wright's). Stitch's "Elena Rostova" is always **Elena Rodriguez**.

### Create maintenance plan

Five steps (Customer, Property, Coverage, Plan terms, Review) over the shared Customers and Properties (Sarah offers only her canonical Home). The success state offers View plan,
Schedule first visit and Close, shows no plan number, and creates no Booking, Job, Invoice or Payment. The Overview quick action opens this same flow at `/maintenance-plans?new=1`.
The empty state (`?state=empty`) has one primary action and no promotional cards.

### Website: data architecture and content ownership

- The site has exactly five pages: **Home, Services, About, Contact, Booking**, each a list of registered sections (Phase 15: stored per version from the default template, `saas-architecture.md` §28). There is no page builder, drag-and-drop, SEO or debug field.
- The Website stores only what it owns: section visibility and text, and which Services are shown and in what order (Service slugs). **Business name, phone, email, address and hours** are read from the organization's record; **every Service's** name, description, price, duration and booking method is read from the Services catalog. A "connected" section holds no text of its own.
  Tests assert that no business detail or Service text appears in the Website's own data.
- `WebsiteState` holds `published`, a saved `draft` and the `live` snapshot taken at the last publish (Phase 15: a Draft version and a Published version in PostgreSQL). Preview shows the draft, "View live website" opens the published site at `/sites/<slug>`. A page's status is derived:
  Published, Saved · unpublished changes, or Private. Pages that list Services also change when the shown Services change.
- The Website reads the **canonical** Services catalog. Services added during a demo session (Phase 2's in-memory catalog) belong to the Services module and are not shared with other modules.

### Website: editors, preview and booking

- **The Website Builder** (`/website/builder`, Phase 16; replaces the page editors, `/website/pages/[pageId]` redirects to it): inside the workspace shell, a bar (Back to Website, status, Discard, Save changes, Preview, View published site, Publish; Undo / Redo, Desktop / Tablet / Mobile, panel toggles), left the Pages and Sections panels (Add page, Add section, an actions menu per row, a drag handle per section), centre the canvas, right the inspector (a Page, a Section or the Site theme). States designed in the Climvia system: nothing selected, a section, a page, the theme, unsaved changes, saved and unpublished, an invalid field, the Add a section dialog, the delete-page and discard confirmations, a change of style that names what it would drop, a tab that is behind (an alert with Reload latest version), and a member's read-only view. Unsaved changes turn Preview and Publish off.
- **The Template Gallery** (`/website/templates`, Phase 17; no Stitch export exists for it, so it is designed in the Climvia system from the Builder's and the Website hub's patterns): inside the workspace shell, a back link to the Builder, the page heading, a note saying which Template the Draft is **based on** (and that after editing it may no longer match exactly), and four cards (Climvia Starter, Precision, Comfort, Airflow) each with a live miniature drawn by the real renderer, a style line and two tags, a description, a **Current template** badge where it applies, **Preview** and **Use this template**. A preview (`/website/templates/<key>`) shows one Template in a frame at Desktop, Tablet or Mobile width with a switch between its five pages and a note that it uses a made-up business and Services. **Use this template** asks first: a dialog titled "Replace your draft with <name>?" that says the draft's pages, sections and theme are replaced, the published website does not change, earlier versions are kept and the business's details, hours and Services stay, with **Keep my draft** and **Replace draft with <name>**; a tab that is behind sees the stale alert and **Reload latest version**. A member who may only look can browse everything and every control that replaces the Draft is off. The Builder's bar shows **Based on: <name>** and **Change template** (**View templates** for that member), and the Theme panel has a **Design style** control.
  The canvas is `inert`: it is a picture, not a working page. Services are shown, hidden and ordered with switches and Move up / Move down buttons in the section's inspector; sections are reordered by dragging the handle or by Move up / Move down.
- The customer-facing preview (`/website/preview…`) is a separate layout: no sidebar, no workspace header, no search. Its toolbar (Back to editor, address, Desktop / Mobile) is the only addition.
  Footer: "© 2025 Apex Climate Heating & Air. All rights reserved. | Powered by Climvia". Page sizes follow the frame (container queries), so Mobile is a real narrow layout.
- Booking journeys (`/website/preview/booking/[serviceSlug]` in the signed-in preview, `/sites/<slug>/booking/<serviceSlug>` for a visitor) follow the Service's booking method: **instant** (date and start time, confirmed straight away), **request appointment** (2-hour arrival window,
  pending) and **request quote** (consultation slot, pending). Each creates **one Booking** (source "Website", with the customer's name and contact details as a snapshot) and nothing else.
  Photo-upload intake questions are not offered. The contact form shows a confirmation and stores nothing.

### Website: domains

Baseline: **apexclimate.climvia.com** (Climvia, primary, cannot be removed) and **www.apexclimateair.com** (custom, *recorded* as Configured; Phase 15 stores it and nothing resolves or verifies it). Make primary swaps which is primary; the ⋮ menu offers Remove domain;
the Remove custom domain modal restores apexclimate.climvia.com as primary; Connect custom domain accepts any well-formed hostname. There is **no DNS, verification, certificate or registrar step**, and domain changes never
touch content or the published flag. Publishing needs no custom domain.

*Update (Phase 19D).* The Climvia address is no longer written `<address>.climvia.com`: the Website, Pages and Domain screens, the Business information card, the Marketplace listing and the booking link all write it from the deployment's configured origin, `<origin>/sites/<address>` (saas-architecture §39).

### Deliberate changes to earlier work

- `e2e/shell.spec.ts`: Create maintenance plan now goes to `/maintenance-plans?new=1`; `/maintenance-plans` and `/website` are no longer placeholders.
- Customers reads plans through `getCustomerPlanSummary` (David Chen: "Seasonal Maintenance"); Bookings gains the "Maintenance plan" source and the plan label under the service.
- The Bookings "Copy booking link" now uses the Website's Booking page path (`/booking`); it was `/book`.
- `createBooking` allocates numbers through `RESERVED_BOOKING_NUMBERS`; `nextId` accepts any prefix. (Phase 13: bookings are stored; the reservation was replaced by the stored BK-1048 and a counter that skips numbers in use.)

### Source conflicts and how they were resolved

| Conflict | Decision |
| --- | --- |
| Stitch contact numbers on Website screens ((512) 555-0194) and hours (8:00 AM) differ from the Business record. | The Business fixture wins everywhere: (555) 392-8100, service@apexclimate.com, 4820 East Riverside Dr, Suite 110, Mon to Fri 7:30 AM to 6:00 PM. |
| Stitch pages list booking at `/book`; the booking preview shows `/booking`. | `/booking`. |
| Journey screens use 2025 dates, "Jordan Miller" / "Elena Rostova", other addresses and a "REQ-89421-ATX" reference. | Slots follow the prototype calendar (today is Oct 25, 2024); the form starts empty; the reference is the new Booking's number. |
| Stitch Website shows "Licensed & Insured", "SSL Active · Auto-renews", "4.9 Star Verified", site brand/style, SEO and analytics. | Not built: no invented credentials, certificate or verification state, ratings, SEO or analytics (the Builder's Theme inspector edits a few real tokens, not a brand system). |
| Stitch Comfort Care visit 1 names a Booking and Job that conflict with other records. | Recorded as fulfilled (May 22, 2024) with no links. |
| The "Pages & content" Stitch screens say "Updated recently". | No timestamps are shown; there is no clock. |

### Deliberately not built

Edit plan, pause / end / renew actions, plan invoices or any billing, plan history beyond what is derived, page version history, SEO or meta fields (a Theme inspector and adding, removing and reordering pages and sections came with the Website Builder in Phase 16),
analytics or traffic, DNS or domain-verification states, and a real contact-form or email delivery. Marketplace, Reviews, Marketing, Analytics, Settings forms and Help remain placeholders.

### Unresolved dependencies for later modules

1. **Settings** will own the business record the Website reads (hours, phone, address); its "Edit source" links point at the Settings placeholder until then.
2. **Marketplace** will need to read the same Services and the same Business record; it should not copy either.
3. A website Booking is a snapshot (`contactName` + `contact`); matching it to a Customers record is a later, explicit step.
4. Plan renewal and end actions need a flow; the totals (3 renewals) are derived from end dates inside 60 days of the prototype date.

## 11. Phase 6: Marketplace, Reviews and Marketing

> **Phase 13 update.** Reviews are stored in PostgreSQL (reviews, one reply each, review requests; see [saas-architecture.md §26](saas-architecture.md#26-maintenance-plans-and-reviews)). A posted or edited reply and a recorded request survive a reload, a request is only a record
> (nothing is sent), and `lib/reviews-state.ts` is gone. Marketplace and Marketing are unchanged.
>
> **Phase 14 update.** Marketing is stored in PostgreSQL (campaigns, chosen customers and the recipients' snapshot taken when a campaign is scheduled or sent; see [saas-architecture.md §27](saas-architecture.md#27-marketing-and-analytics)). Save draft, Schedule, Send now, Cancel schedule (back to Draft) and Duplicate survive a reload, the campaign's time is the business's own, a Sent campaign is final, and nothing is delivered. `lib/marketing-state.ts` is gone. Marketplace is unchanged.

The three Growth modules, each on its own typed dataset (`src/data/marketplace.ts`, `reviews.ts`, `marketing.ts`), pure state
functions (`src/lib/marketplace-state.ts`, `reviews-state.ts`, `marketing-state.ts`) and a client provider. All three providers
mount with the others (`WorkspaceProviders`), so the signed-in directory preview, which sits outside
the workspace shell, shows what was saved inside it; the published listing mounts none. Nothing persists: reload restores the baseline. Phases 1 to 5 are unchanged
except where listed under "Deliberate changes to earlier work".

Routes: `/marketplace-listing`, `/marketplace-listing/edit` (also first-time setup with `?setup=1`), `/marketplace-listing/preview` (signed-in, no shell; they were `/marketplace…` before Phase 19B gave that address to the public Marketplace) ·
`/reviews`, `/reviews/[reviewId]` · `/marketing`, `/marketing/new`, `/marketing/[campaignId]`, `/marketing/[campaignId]/edit`.
`?state=empty` previews the approved empty state on the three list pages, as on earlier modules.

### Reference screens used

- **Marketplace:** `marketplace_published_listing`, `_listing_published_success_state` (the clean Published layout), `_hidden_listing_state`,
  `_first_time_empty_state`, `set_up_marketplace_listing_first_time`, `edit_marketplace_listing_published` / `_unsaved_changes` /
  `_hide_listing_modal`, `marketplace_public_listing_preview`.
- **Reviews:** `reviews_main_list`, `review_detail_awaiting_reply`, `review_detail_responded`, `reply_to_review` (the modal part only),
  `request_review` (the dialog only), `reviews_empty_state`.
- **Marketing:** `marketing_campaign_list`, `create_campaign_email`, `create_campaign_sms`, `campaign_review_schedule`,
  `scheduled_campaign_detail`, `cancel_scheduled_campaign_modal`, `sent_campaign_detail`, `marketing_empty_state`.

### Marketplace: ownership and source of truth

- The listing owns only: its description, a cover treatment, which eligible Services are shown and in what order, which contact
  details are visible, which customer actions are offered, and whether it is published or hidden. A test asserts its data contains no
  business detail and no Service text.
- **Business name, phone, email, address and hours** come from the Business fixture; the **website address** from the Website's primary
  domain (so making the custom domain primary on the Website changes it here); every **Service name, description, price, duration and
  booking method** from the Services catalog. Nothing in Marketplace can edit them.
- **Selected Services: exactly 5 of the 6.** Shown: AC Repair & Diagnostics, Annual Cooling Tune-Up & Maintenance, Heat Pump Diagnostics &
  Repair, Ductless Mini-Split Installation & Estimate, Furnace Safety Inspection & Tune-Up (catalog order). **Emergency No-Heat / No-Cool
  Service is "Not selected"**: it stays active in the catalog and can be added to the listing. Maintenance plan coverage ("Cooling
  maintenance", "Heating maintenance") is not a Service and is never offered (asserted on `/services`, the Website, and the Marketplace).
- Order is changed with Move up / Move down buttons over all six eligible Services (never by dragging), and Service selection is a
  labelled checkbox per Service.
- **States:** Published (baseline), Hidden (hiding keeps the saved configuration; publishing restores it), first-time setup (reached by
  `?state=empty` → Set up listing → Save & publish listing, which saves and publishes in one step). The Published success state is the page
  itself; nothing overlays the directory preview.
- **Unsaved changes:** a banner and badge, Discard (with a confirmation), and an in-app guard: while there are unsaved edits, following any
  link out of the page asks "Discard unsaved changes?" first. (Closing or reloading the tab is the browser's own and is not intercepted.)
  Preview listing is disabled until the edits are saved, as in the Website Builder.
- **Directory preview** (`/marketplace-listing/preview`) is its own layout: a Climvia Marketplace header, the listing and a footer, with a slim
  toolbar (Back to Marketplace, Desktop / Mobile). A hidden listing shows "This listing isn't available". Its buttons lead to the Website's
  real Booking, contact and per-Service booking pages. It is not the Website's component: the two previews share only primitives.
- **Cover:** there is no image upload, so a cover is a reference to one of three built-in CSS treatments (Teal horizon, Warm linen, Cool
  slate), or none.

### Reviews

- Dataset: id, source (always Climvia), customer or contact-name snapshot, related job id, rating, text, date, response, and an optional
  `replyDraft`. A review is awaiting a reply when it has no response; there is one response per review.
- Approved aggregates: **12 total, 4.7 average, 3 awaiting a reply, 5 review requests** (`REVIEW_BASELINE`). The four sample reviews are
  Sarah Mitchell (awaiting), David Chen (responded), Elena Rodriguez (awaiting) and Marcus Sterling (a contact snapshot, responded); the tabs
  show 12 / 3 / 9 and the list says "Showing N of M". Replying to an awaiting review moves one from Awaiting reply to Responded
  (3 → 2, 9 → 10); total and average do not move.
- **Sarah Mitchell's review:** Climvia, 5 stars, "The technician explained the repair clearly and completed the work as scheduled.", dated
  Oct 25, 2024, related to her Customers record and to **JB-204 · AC Repair & Diagnostics**. Detail shows only the review, the response and
  the two related records: no verification, equipment, tenure or location metadata.
- **Reply** opens the labelled dialog (its text starts as the approved response); **Post response** moves the same review to Responded
  with the response by Alex Morgan at the prototype time (Oct 25, 2024 at 10:45 AM). **Edit response** changes the same response (marked
  Edited); there is no second record, and a posted review cannot be replied to again.
- **Request review:** customer (default Sarah), optional related completed job, Email or SMS (the address or phone on the Customers
  record), an editable message, and "No incentives or rewards are included." It records the request, adds one to the request count, and
  sends nothing and creates nothing else (no campaign, no incentive, no gating). Nothing is published to or read from any outside review site.

### Marketing

- Dataset: id, name, channel, audience, recipients, subject (email only), message, status (Draft, Scheduled, Sent), scheduled or sent time,
  and delivery records for a sent campaign. Times are business-local wall-clock strings (America/Chicago) and never read the browser clock or timezone.
- Approved aggregates: **2 drafts, 1 scheduled, 8 sent, 146 recent recipients** (11 campaigns). The five sample campaigns are those the approved
  list shows. Changes move counts from one column to another; a campaign sent in the session adds its recipients to the recent recipients.
- **Create campaign** is one editor (`/marketing/new`, also reached from the Overview quick action) for email and SMS: Campaign details,
  Audience, Message, then Review & schedule. Email: Customers due for maintenance, **38** recipients, a subject, the first-name token
  `{{contact.first_name}}` ("Adds the customer's first name when available.") with an Insert token button and a Preview that fills in a first name
  (or "there"). SMS: Maintenance customers, **42** recipients, a 160-character counter. Review & schedule: "Pick a date and time to send this
  campaign." / "Uses your business local time." with a suggested Oct 30, 2024 at 9:00 AM; a past date or an already-passed time today is refused.
  Send now marks the campaign Sent in the session; nothing is delivered.
- **Scheduled campaign:** Fall maintenance reminder · Email · Customers due for maintenance · 38 · **Oct 30, 2024 · 9:00 AM** (Central Time).
  **Cancel scheduled campaign?** uses the approved copy and snapshot; confirming makes it a **Draft** (content and recipients intact, still
  editable and reschedulable), never a deletion.
- **Sent campaign:** Cooling tune-up reminder · SMS · Maintenance customers · **42 recipients, 42 sent, 40 delivered, 2 not delivered**, sent Oct 18, 2024 · 10:15 AM.
  Delivery records (customer, destination, status in words and an icon, time) are a sample of the 42, filterable by All / Delivered / Not delivered.
  Recipients with a Customers record (Sarah Mitchell, David Chen) take their name and phone from it; the others are deliberate contact snapshots.
- **Duplicate campaign** creates a new Draft ("… (copy)") and leaves the Sent campaign immutable; a sent campaign cannot be edited, re-sent or
  cancelled by any state function (asserted by tests).
- Audience sizes (All customers 146, Customers due for maintenance 38, Maintenance customers 42, Customers with active plans 18) are approved
  aggregates over the full customer base, not counts of the five Customers records.

### Session state

Marketplace (edit, hide, publish, set up), Reviews (reply, edit response, review requests) and Marketing (drafts, scheduling, sending,
cancelling, duplicating) live in memory and survive client navigation, including between the workspace and the public preview. A reload restores
the canonical baseline. No localStorage and no backend were added.

### Obsolete or conflicting Stitch content ignored

- **Marketplace:** the "HVAC LICENSED" badge, "Climvia Directory" search and "Sign in", a different business website (`apexclimate-atx.com`,
  `apexclimateair.com`), the Business logo / "Edit branding" row, "Category: HVAC Services", the 109-character description counter, service
  prices that differ from the catalog ($129 / $149 / $159 AC Repair, Annual Tune-Up, Heat Pump; Emergency $189), "request dispatch" wording, and a
  stock photograph (covers are CSS treatments).
- **Reviews:** `reply_to_review`'s page ("Review #REV-8842", verified badge, "Customer History", plan, visit count, equipment, address, Response
  Guidelines) and `request_review`'s page behind the dialog ("Verified Workflow", 4.92 rating from 328 ratings, 412 requests sent, Export CSV, public profile).
  The dialog's Sarah contact (sarah.m@mitchellhome.com, (555) 392-4819) conflicts with her record (sarah.m@gmail.com, (512) 555-0194); the record wins.
  "Elena Rostova" is Elena Rodriguez.
- **Marketing:** sending provider and SPF/DKIM, "Technician Dispatch Capacity" and expected booking conversion, 10DLC / carrier / gateway / throughput panels,
  the handset preview, the execution and automation timelines, queue engine, auto follow-up, estimated delivery, campaign asset preview and "EDT".
  "All customers" 146 versus the "All customers" send that reached 48 is left as the approved numbers.

### Source conflicts and how they were resolved

| Conflict | Decision |
| --- | --- |
| Stitch dates Sarah's review Oct 28 (and David's Oct 26) and JB-204 "Completed Oct 27", after the prototype's today (Oct 25, 2024). | Reviews are dated on or before Oct 25 (Sarah Oct 25, David Oct 24). The response time is the prototype time, Oct 25, 2024 at 10:45 AM. |
| **JB-204 is *In progress* in Jobs (Phase 3), but the Phase 6 brief calls it a completed job for Request Review.** | **Resolved in Phase 7 (§12 Part 0):** JB-204 is Completed in the one operational fixture, so Request Review offers it at once and the "isn't available yet" explanation is gone. (Phase 6 had left Phase 3's record alone and offered JB-142 until JB-204 was completed in Jobs.) |
| Stitch pages put the website at `apexclimateair.com` / `apexclimate-atx.com`. | The Website's primary domain (Phase 5) is used. |
| The Marketplace Services list orders Furnace before Mini-Split on one screen and after on others. | Catalog order, with Emergency left off. |
| The email builder says 146 customers in total; the Customers module lists five. | Audience sizes are approved aggregates (see above). |

### Deliberate changes to earlier work

- `e2e/shell.spec.ts`: Create campaign now goes to `/marketing/new`; `/marketplace`, `/reviews` and `/marketing` are no longer placeholders.
- The Overview quick-action card said "trigger marketing communications"; it now says "send marketing communications" (no triggers exist).
- `BOOKING_METHOD_ACTION` (Book a time / Request appointment / Request a quote) moved into `data/services.ts` so the Website and Marketplace share one set of labels.
- Two comments and one variable name that contained "trigger" were reworded so the Phase 6 source scan can be literal.

### Deliberately not built

Marketplace: image upload and branding, the directory itself (search, Sign in, Find service), analytics, badges, ranking and sponsorship.
Reviews: creating reviews, any outside review site, verification, scoring, AI replies, Export CSV, a request history list, incentives.
Marketing: automation, triggers or sequences, sender and provider setup, deliverability, scoring, funnels, attribution, charts, recipient-level
reports beyond the sampled delivery records, real sending, and rich-text or template editing. Analytics and Settings were built in Phase 7;
Help remains a placeholder.

### Unresolved dependencies for later modules

1. ~~**Settings** will own the business record Marketplace and the Website read.~~ **Done (Phase 7):** Settings is the one source for it (§12).
2. **Analytics** has no data from these modules by design: Marketplace has no analytics, Reviews no scoring, and Marketing no performance numbers.
3. The 12 / 4.7 reviews and the 146 / 38 / 42 audiences are aggregates over a customer base the Customers module only samples.
4. ~~JB-204's status decides whether Sarah's review can be matched to a completed job in Request Review.~~ **Resolved (Phase 7):** JB-204 is Completed.

## 12. Phase 7: JB-204 reconciliation, Analytics, Settings and the source-of-truth integration

Four pieces of work, in this order: one cross-module data correction (Part 0), **Analytics** (a read-only reporting view), **Settings**
(the editable business identity and workspace preferences) and the integration that makes Settings the one source for the business
record the rest of the app reads. Phases 1 to 6 are unchanged except where listed under "Deliberate changes to earlier work". Help is
not built.

> **Phase 14 update.** Analytics is computed on the server from PostgreSQL for the active business and the range in the URL (see [saas-architecture.md §27](saas-architecture.md#27-marketing-and-analytics)); the sample business's approved October 2024 figures are signed imported adjustments that a range includes only when it covers the whole month. The CSV and PDF are built from the same report. The static `data/analytics.ts` aggregates and `overviewMetrics` are gone.

Routes: `/analytics` (tab and date range in the URL: `?tab=bookings-jobs|financial|plans`, `?range=last-month|this-quarter`,
`?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`) · `/settings`, `/settings/hours`, `/settings/branding`, `/settings/preferences`,
`/settings/profile`.

### Part 0: JB-204 is Completed (a source-of-truth reconciliation, not a regression)

The Phase 3 fixture had **Job #JB-204** (Sarah Mitchell, AC Repair & Diagnostics, 1402 Kinney Ave, booking BK-1042) *In progress*. That
contradicted the rest of the data: Sarah's `lastService` is JB-204 on Oct 25, QT-884 is approved and INV-1044 (same job) is invoiced and
paid, Sarah's canonical review is about JB-204, and the Stitch Analytics screens list JB-204 as completed. The one operational fixture
(`src/data/operations.ts`) was corrected; nothing special-cases it anywhere else.

- **Fixture:** BK-1042 and JB-204 are `completed`; JB-204 carries a completion record (the prototype time, Oct 25, 2024 10:45 AM, with
  the technician's notes). The one photo timestamp that was after that time moved from 10:48 to 10:44. No other record changed. **Nothing in
  the baseline is in progress**; a scheduled job reaches In progress only by being started.
- **Request Review** is now generic: it offers the customer's completed jobs, newest first, and preselects the latest. For Sarah that is
  JB-204 straight away (options: No related job, JB-204, JB-142). The "isn't available yet" explanation and the link it carried are gone.
- **Every module simply reads the record:** Jobs Active 4 / Upcoming 2 / Completed 7 (was 5 / 2 / 6); Bookings Upcoming 5 / Past 6 (was
  6 / 5); JB-204 is in Completed with its completion time and no Start, Complete or Reassign action; BK-1042 is under Past, and its Schedule panel
  offers only "View job" like every completed booking; Sarah's Customers page has no "Current service" card and lists JB-204 as Completed
  in her visit history.
- **Aggregates do not move.** Completed Jobs stays **18** and Bookings **24** (Overview, sidebar badges, Analytics): the fixtures are a sample
  of them. Completing another job in a session leaves 18 where it is (as before).
- **Tests changed deliberately** (all in the direction of the new record, none weakened): `jobs.spec` (counts; start/complete/reassign/Work
  details/upload flows moved to the still-open JB-201; JB-204 is asserted read-only), `bookings.spec` (tab counts, search, filters, the Review
  panel now opened from Past), `customers.spec`, `operations.spec` (fixture statuses, BK-1039 as the booking with a job that cannot be
  cancelled, `assign` and `start/complete` on JB-201, JB-204 as a no-op), `schedule.spec` (Completed status; no booking-action row; the
  timezone variants read Past), `reviews.spec` (Request Review baseline; a job completed in the session becomes the default for its customer),
  `maintenance-plans.spec` and `website.spec` (Bookings tab counts, each one fewer Upcoming and one more Past). New: `jb204-reconciliation.spec`.

### Analytics

Reference screens: `analytics_overview`, `_bookings_jobs`, `_quotes_invoices_payments`, `_maintenance_plans_services`, `_empty_state`,
`export_analytics_report_modal`. Strictly a reporting view: it owns no records, stores nothing, calls no network and has no editing
control (a source scan asserts it).

**Architecture.** `data/analytics.ts` (the approved aggregates, the range presets, the export modules and formats) → `lib/analytics-state.ts`
(`buildAnalytics(financial, plans, operations)`, the range rules) → `lib/report-export.ts` + `lib/pdf.ts` (CSV and PDF built in the browser) →
`components/analytics/*`. The page reads the same stores the owning modules do (`useFinancials`, `useMaintenancePlans`, `useOperations`).

**Tabs:** Overview · Bookings & Jobs · Financial Records · Maintenance Plans & Services (URL-backed, roving keyboard focus). Every figure
links to, or names, the module that owns it.

| Figure | Baseline | Source in a session |
| --- | --- | --- |
| Bookings 24 · Jobs completed 18 | `overviewMetrics` | **Aggregate**: identical to the Overview and the sidebar badges, so they can never disagree |
| Booking statuses Confirmed 14 / Completed 6 / Pending confirmation 2 / Cancelled 2 | `BOOKING_BREAKDOWN` (sums to 24) | Aggregate |
| Job statuses Completed 18 / Scheduled 4 / In progress 2 | `JOB_BREAKDOWN` (sums to 24) | Aggregate |
| Quote value $4,820, approved $2,975; Approved 5 / Sent 3 / Draft 2 / Declined 1 / Expired 1 | `QUOTE_BASELINE` | Aggregate (quotes are never edited in a session) |
| Weekly chart (5 weeks, 24 / 18) and Service table (5 rows, 24 / 18) | `WEEKLY_ACTIVITY`, `SERVICE_ACTIVITY` | Aggregate |
| **Invoiced $6,240** | `getTotalInvoiced` | **Derived**: invoices created in the session are layered on $6,240 |
| **Payments received $2,130, 7 recorded, 1 voided; outstanding $680** | `getPaymentsReceivedTotal`, `getRecordedPaymentsCount`, `getOutstandingBalance`, voided list | **Derived** (PAY-1009 → $2,430, 8, $380) |
| **Invoice statuses Paid 12 / Unpaid 4 / Partially paid 2 (18)** | `INVOICE_BASELINE_COUNTS` | **Baseline + (current − canonical fixture)** per status: paying INV-1050 gives 13 / 4 / 1; a new invoice adds one Unpaid |
| **Active plans 14 · Visits due 5 · Upcoming renewals 3 · Paused or ended 2** | `getPlanMetrics` | **Derived**: the same selector the Maintenance Plans page uses |
| Recent booking records (5), recent completed Jobs (3), recent Payments (4) | records | **Read** from the operational and financial stores |

- **Recent records are canonical.** Stitch's rows (Highland Park, Oct 29, "Elena Rostova", JB-204 "Completed Oct 27") are stale, so the lists show
  the real records: bookings on or before the prototype's today and not pending, newest first; completed jobs by completion time (JB-204 first;
  a job completed in a session sorts by the later visit on a tie because completions share the prototype's fixed "now"); payments newest first.
- **Date range** (deterministic, no real clock): This month = Oct 1 – Oct 31, 2024 (the prototype's month), Last month = Sep 1 – 30, This quarter =
  Oct 1 – Dec 31, or a custom range of two calendar dates (validated; the end must not precede the start). Activity exists only in October 2024.
  A range that does not touch it shows the **approved empty state** ("No activity for this period"), zero totals, Change date range / Reset date
  range, a disabled Export, and no chart, table or tab (no fabricated values). A range that overlaps it (a custom week, this quarter) shows the whole
  October period, with a note saying so. The same range reads the same in every browser timezone.
- **Export report:** a dialog with the selected range (read-only), six modules (Summary KPIs, Bookings, Jobs, Quotes & Invoices, Payments, Maintenance
  Plans; Select all / Clear all; at least one required) and CSV or PDF; **neither is labelled Recommended**. The file is generated and saved by the
  browser (`Blob` + download), made from the figures on screen, so a payment recorded in the session is in it. CSV is one `Section,Metric,Value` table
  with plain numbers (money without symbols). The PDF is a small hand-written, uncompressed, text-only PDF (Letter, Helvetica, a checked cross-reference
  table). No scheduled reports, no email, no cloud save, no share link.
- **Deliberately omitted from the Stitch screens:** the Service / Customer / Technician filters; the Customers card (32 / 6); the duplicate Service
  activity card; Payment Methods and a method per payment; plan distribution (Comfort Care 10 / Commercial Seasonal Care 4, a plan type that is not canonical);
  Included Visit Status; the per-status quote dollar figures; the "Total Revenue / on-time dispatch / Avg ticket" cards of the export screen's backdrop; every
  percentage. Nothing added: no AI insights, forecasts, technician performance, marketing / Website / Marketplace analytics, saved views, sync or audit cards.

### Settings

Reference screens: `settings_business_information` (+ `_unsaved_changes`), `settings_business_hours`, `settings_branding`,
`settings_workspace_preferences`, `settings_my_profile`, `settings_discard_unsaved_changes_modal`.

**Architecture.** `data/settings.ts` (types, option lists, the baseline) → `lib/settings-state.ts` (validation, tidying, the pure saves) →
`components/settings/SettingsProvider` (mounted by `WorkspaceProviders` with the other stores) → the five forms in `components/settings/*`. There is **no second
dataset**: the baseline is built from the existing canonical records (`business`, `businessHoursByWeekday`, `BUSINESS_TIME_ZONE`, `currentUser`), and a
test asserts no component or page imports those directly any more. The data-only readers that remain (`data/customers`, `data/reviews`, `data/team`,
`lib/booking-slots`) read the *baseline* as fixture values or as a default parameter.

**Ownership boundaries.** Settings owns the business name, phone, email and address, the weekly hours, the logo and accent, the time zone / date / time style,
and the signed-in user's display name and photo. It does **not** own: Services (catalog, prices, booking methods), Team (people, roles, permissions and each
person's availability), the Website (page content, domains) or the Marketplace listing (description, cover, Services, visibility). Each of those reads Settings
and links back to it; none can edit it, and Settings cannot edit them.

| Was read from the static record | Now reads Settings |
| --- | --- |
| Top bar workspace name, user name, role | `useSettings` (client top bar; photo too) |
| Overview heading and Business information card (name, contact, address, hours); website line | `useBusiness`, `useHoursRows`; the website line is the Website's primary domain |
| Website header, footer, contact details, hours (public preview, editor canvas, overview card, Pages & content) | `useBusiness`, `useHoursRows`, `BrandMark` |
| Marketplace listing, editor contact choices, overview, public preview | same |
| Invoice "Billed by", Payment "Recorded by" | `useBusiness` |
| Booking-time slots (Create Booking, Schedule visit, Website booking) | saved weekly hours, passed to `getSlotGroup` |
| Schedule closed-day label, Team availability (business-hours mode), Team overview | saved hours; Team time zone line reads the saved zone |
| Schedule / Marketing time-zone labels | `useTimeZoneLabel` |
| Review responses signed "Alex Morgan" | the saved profile name |
| "Copy booking link" and the Overview website line (a copy of the Website's domain) | the Website's primary domain (`getPrimaryDomain`) |

- **Business information:** name, phone (any ten-digit US number, stored as `(555) 392-8100`), email, street, city, state (select), ZIP (5 digits). Nothing else
  (no hotline, headquarters, alternate office or verification). Errors sit on the field (`aria-invalid`), focus moves to the first one, and **Save** shows
  "Business information saved for this session". The side card shows what is saved.
- **Business hours:** one row per day (switch, opening and closing time in half-hour steps, "Closed all day"), **Copy Monday to weekdays**, a live preview.
  A closing time must follow the opening time. Consecutive days with the same hours are joined everywhere ("Mon–Fri", "Sat–Sun"). **Integration:** the booking
  times offered follow the saved hours (a closed day offers none; a shorter day disables the windows that no longer fit); the Schedule labels a day with no
  work Closed from them; the Website, Marketplace, Overview and Team read them. **Existing bookings, jobs and Schedule events are never moved or removed**
  when the hours change. Team availability stays its own thing: only members on "Uses business hours" follow, and per-member custom shifts are untouched.
  No shifts, on-call or holiday rules.
- **Branding:** the logo is a reference to one file: the baseline's `apex-climate-crest-revised.svg`, drawn as a built-in mark (the app has no such image), or a
  file chosen in the session (SVG, PNG or JPG up to 4 MB, shown from a local object URL, nothing uploaded); **Remove logo** falls back to the initials ("AC").
  The optional **accent** is a six-digit hex (swatches or typed) that must keep white button text readable (contrast 4.5:1). A saved accent re-points
  `--color-primary` only on customer-facing frames (the Website preview, the Builder's canvas and the overview picture, the Marketplace listing); the Climvia shell and
  the Marketplace's own Climvia header never change (asserted by computed style). No AI, theme builder or asset library.
- **Workspace preferences:** time zone (the seven US zones, default America/Chicago), currency (USD, read-only), date style (MMM D, YYYY · MM/DD/YYYY · DD/MM/YYYY ·
  YYYY-MM-DD, with the Oct 30, 2024 sample) and time style (12-hour or 24-hour). **The time zone names the zone the workspace's business-local times are in:
  saving a different one relabels them ("Eastern Time (ET)") and never converts a stored time**, so historical timestamps do not shift. The date and time
  styles are read by the hand-written formatters in `lib/format` and `lib/dates` (via `lib/display-preferences`, written only by the provider, only in the
  browser), so every client-rendered date and time follows them from the next screen on; the stored values are never touched. No NTP, server time, ledger or
  tax settings. Deterministic across browser timezones (asserted in three).
- **My profile:** full name and photo (PNG or JPG), the role shown and **not** editable ("Role access is managed with your Team record."), "Manage Team" opens `/team`.
  No email, password, account or sign-in control; there is no authentication.
- **Unsaved changes:** every form keeps a draft; an "Unsaved changes" notice names what is unsaved, Save and Discard changes are enabled only then, and the
  `UnsavedGuard` was extended (an optional description, and `confirmDiscard` for an in-page button). Following any link out (the sidebar, a Settings tab) or pressing
  **Discard changes** asks "Discard unsaved changes?" with the Stitch wording; Keep editing keeps the draft, Discard changes drops it. Reloading or closing the tab is
  the browser's own.
- **Session state:** edits live in memory, survive client navigation (including to the public previews) and reset on reload. No localStorage, no backend.

### Source conflicts and how they were resolved

| Conflict | Decision |
| --- | --- |
| Stitch Quotes "14 quotes" while its status breakdown is 5 + 3 + 2 + 1 + 1 = 12. | **12 quotes**, the sum of the approved statuses; the $4,820 and $2,975 are unchanged. |
| Stitch Invoices "2 unpaid/partial" outstanding while the counts are Unpaid 4 + Partially paid 2. | The count label is dropped; the **$680** outstanding is shown "across unpaid and partially paid invoices". |
| Jobs "In progress 2" at the baseline, but no fixture job is in progress (JB-204 is completed). | The breakdown is the approved aggregate (24 logged, 18 completed); the fixtures are a sample. |
| The Service table lists five services and omits Emergency, but BK-1009 / JB-184 are Emergency work. | The approved five rows are kept (they sum to 24 / 18); services with no bookings in the period are not listed. Flagged for the final report. |
| Stitch Analytics tab labels "Financials" and "Services & Plans". | The brief's "Financial Records" and "Maintenance Plans & Services". |
| Settings tabs are a top bar in the linen shell. | Section tabs inside the page (the Phase 1 shell is final). |
| Stitch Preferences: "Central Standard Time (CST)" beside America/Chicago, and a live "Active: 09:30 AM CDT". | "Central Time (CT)", and a fixed example derived from the prototype's time; no clock. |
| Stitch Branding: logo "Apex Climate HVAC", 420 × 420 px. | A built-in mark named by the reference file; no dimensions are invented for a file the app does not have. |
| Stitch buttons "Cancel" (My profile) and "Reset" (Preferences). | "Discard changes" on all five, so the confirmation is the same everywhere. |
| Stitch profile toast "saved to your workspace account". | "Profile updated." There is no account. |
| Stitch Business information `State` lists TX, OK, NM, LA. | All 50 states and DC. |

### Deliberate changes to earlier work

- `e2e/shell.spec.ts` and `e2e/growth-regression.spec.ts`: Analytics and Settings are real pages; **Help is the one placeholder left**.
- `lib/format.ts` and `lib/dates.ts` take the date and time style from `lib/display-preferences`; their output is byte-for-byte the old output at the defaults.
- `formatCityStateZip` (then in `data/fixtures.ts`, now `lib/format.ts`) accepts any address; `data/team.ts` re-exports the weekday constants from `data/settings.ts`, and
  `describeAvailability` / `weeklyFromBusinessHours` take the saved hours as an optional argument; `getSlotGroup` takes the weekly hours as an optional argument.
- `BusinessInfoCard`, `TopBar`, `ListingView`, the Website renderer and the other readers listed above became client components (or read the provider); two
  server-rendered dates on the Customers page use a small client `DisplayDate`.
- Two PDF dictionary entries use no `/Encoding` key so the Phase 6 literal source scan stays literal (the text is plain ASCII).

### Deliberately not built

Help. Analytics: filters, AI, forecasts, technician performance, saved views, scheduled or emailed reports, marketing / Website / Marketplace analytics. Settings:
sign-in, email or password, tax or accounting preferences, holiday or shift rules, a theme builder, an asset library, a second workspace.

### Unresolved contradictions and boundaries (for the final phase)

1. **Profile name versus the Team record.** Editing the name changes the top bar and the signature on review responses; the Team module's "Alex Morgan" member is
   Team's record and is not renamed, so the two can differ for a session. (Role and permissions are always the Team's.)
2. **Authored copy keeps its own text.** Website page text, message templates (the default review request, campaign messages) and the sent quote / invoice messages mention
   "Apex Climate Heating & Air" literally and are not rewritten when the business is renamed; the header, footer, contact card, hours and listing are live.
3. **Date and time style on server-rendered text.** A page rendered on the server cannot see the choice; the two server-rendered dates use `DisplayDate`. A new server-rendered
   date would show the default style until it does the same. A hard reload restores the defaults (as it does every demo edit).
4. **Booking-time windows are fixed** (arrival windows, instant start times, consultation slots); Settings only gates which of them fit inside the saved hours.
5. The Analytics aggregates (24 / 18 / 14 / 6 / 2 / 2 …) are approved baselines over history the representative fixtures sample; the Quotes & Invoices list counts and the
   Bookings and Jobs tab counts are the sample, as on the Overview.
6. The Service activity table omits Emergency (above); the custom-range picker accepts any dates but only October 2024 has activity.

### Remaining final-phase work

**Help** (no Stitch design; needs a product decision), the **onboarding flow** (outside the 16 modules), a real data source for the notification bell, and persistence and
authentication, which the whole demo deliberately lacks.

## 13. Phase 8: the final audit

No new business features. The whole product was audited and the findings fixed; the new tests are listed in [production-handoff.md](production-handoff.md#testing-status).
The comparison with the approved designs is in [final-visual-audit.md](final-visual-audit.md).

### Decisions

- **Help** (no Stitch screen) is a minimal landing page: the heading "Help", the line "Find the workspace area you need help with.", and one card per area (Bookings & Schedule,
  Customers & Services, Jobs, Team, Quotes, Invoices & Payments, Maintenance Plans, Website & Marketplace, Reviews & Marketing, Analytics, Settings), each a set of links using the
  sidebar's own names. It states no support contact, hours, SLA, article count or outside link, because none is part of the product. The placeholder component is gone.
- **The bell** opens a one-line panel ("No new notifications.") and closes with Escape or an outside click. It had no behaviour before. There is no unread dot because nothing produces a notification.
- **The top-bar search** was a field that returned nothing on every page. It now finds Customers (name, phone in any format, email, street), Jobs and Bookings (id with or without `#`, customer,
  Service, street) and Schedule entries (technician, day, blocked time) from the loaded records, so it follows the session. It is a combobox: arrow keys, Enter, Escape, and ⌘K / Ctrl+K to focus.
  Two characters minimum, four results per group. It is a pure function over data the modules already hold (`lib/global-search.ts`); there is no index and no new record.
- **Disabled Preview buttons** (Website Builder with unsaved changes; Marketplace editor with unsaved changes or a hidden listing) now say why to assistive technology.
- **Secondary text colour** `ink-muted` `#64748b` → `#5a687d`, because the original was under AA on the tinted surfaces (4.1–4.3 : 1). Nothing else in the palette changed.
- **Heading structure.** Every page has exactly one visible `h1` and no skipped level, including page-level "not found / not available" states, the public Marketplace listing (its business name is the
  `h1`), the public Website pages (Service cards and contact cards are `h2` where they follow the page title directly) and the Website Builder's canvas (inert, so it adds none).
  A root `not-found.tsx` puts the workspace shell around an address that matches no route.
- **Wording.** Back links read "Back to Marketing / Reviews / Roles"; the unsaved-session sentence on detail pages reads "…in this session are cleared when the page reloads."; the review-request
  toast ends "Nothing is sent."; no user-visible string names a phase, the design export, fixtures, a prototype or an implementation.

### Responsive fixes (768 – 1440 px)

- Top bar: the workspace switcher truncates, search keeps at least 200 px, the person's name is dropped below 1024 px (the link keeps its accessible name), nothing overlaps. Desktop geometry unchanged to the pixel.
- Tables sit in a `relative` scrolling wrapper: absolutely positioned screen-reader text inside an `overflow-x-auto` box used to escape it and widen the page.
- Grids with a breakpoint-only column template (Schedule day view, Bookings detail panel) now start from `minmax(0, 1fr)`, so a wide table cannot stretch the single column at narrow widths.

### Removed

Unused data accessors (`getQuotes`, `getInvoices`, `getPayments`, `getBookings`, `getJobs`, `getTeamMembers`, `getPlans`, `getCampaigns`, `getReviews`), `describeBookingTime`, `publicPath`, and the
`ModulePlaceholder` component with the `description` field of the navigation items it used. A scan found no other unreferenced module, no commented-out code, no console output, no work marker, and
no asset that is not used.

### Still outside the product

The onboarding flow (outside the 16 modules, no instruction to build it), any backend, authentication, delivery or processing, and everything in
[production-handoff.md](production-handoff.md#known-non-blocking-limitations).


## Phase 19C: the public entry, and which address is which

Added after the 16 modules; none of it is a Stitch screen (the export has no landing, review form or console), so it follows the product's own tokens and the rules in saas-architecture §38.

| Address | Who it is for | What it is |
| --- | --- | --- |
| `/` | a visitor, a platform administrator with no business | the public landing: two doors (Find a Service, List Your Business) and Sign in. A business member is sent to `/overview`; someone with no business is sent to `/onboarding` |
| `/marketplace` (+ Service, place and Service-in-place pages) | a visitor | the public Marketplace (Phase 19B) |
| `/listings/[listingSlug]` | a visitor | a provider's profile, with the public header and a separate invitation to businesses |
| `/review/[token]` | a customer holding a link | the review form (rating, words, an unchecked consent to show it publicly); noindex |
| `/signup` | a business owner | create an account, then `/onboarding` (set up the business) |
| `/login` | a business user | log in; returns only to a path on this site; never to the console |
| `/overview` | a business member | the workspace Overview (it was `/` before Phase 19C); a welcome with five optional next steps for a business with nothing in it |
| `/marketplace-listing` (+ `/edit`, `/preview`) | a business owner or admin | the business's own Marketplace screens, with a suspension notice, the platform's message and a request for a second look |
| `/platform-admin/login` | a platform administrator | the console's own sign-in |
| `/platform-admin`, `/organizations`, `/users`, `/marketplace`, `/reviews`, `/system` | a platform administrator | the console; Marketplace holds the suspension and its answers, Reviews holds hide and restore |
| `GET /api/session-state` | the public header | three booleans about the caller; not a page |
