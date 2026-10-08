# Final visual audit

How the finished workspace compares with the approved designs, and every difference that is on purpose. Nothing
here is a defect waiting to be fixed: anything that was one has been fixed (the last section lists those).

## Method

- The 16 modules, each rendered at 1440 × 900 from the production build, set beside the reference screen chosen for it in
  [stitch-screen-map.md](stitch-screen-map.md) §4 (Overview, Bookings, Schedule, Jobs, Customers, Services, Team,
  Quotes & Invoices, Payments, Maintenance Plans, Website, Marketplace, Reviews, Marketing, Analytics, Settings).
  Help has no reference screen.
- Sub-pages, dialogs and states were checked in the phase that built them; this pass re-checked the front page of every module and the
  properties every page shares (measured below).
- Behaviour that a picture cannot show (tab order, contrast, focus, overflow at five widths) is covered by the test suite, not by eye:
  `accessibility.spec.ts`, `responsive.spec.ts`, `route-inventory.spec.ts`.

## What matches

- **The shell.** Top bar, 240 px sidebar with the six groups, active state, spacing and icon style are the approved Phase 1 shell on every
  module. The page header (title, one supporting line, primary action at the right) is the same component everywhere.
- **Tokens.** Colours, 8 px control radius and 12 px card radius, the low-contrast card shadow, Inter, and the status taxonomy
  (green confirmed / paid / recorded / published, amber scheduled / pending / awaiting, red cancelled / voided / declined, grey draft / completed / hidden,
  teal in progress) are taken from the design tokens and used through them. No page defines its own.
- **Layout vocabulary.** Four summary tiles over a tabbed list or table, a search and filter row, a bordered table with muted uppercase column
  heads, row actions at the right, a notice strip under the table, side panels for detail. The modules read as one product.

### Measured on all 17 pages at 1440 px

| Property | Value on every page |
| --- | --- |
| Page title | 24 px, weight 700, ink |
| Content column | starts at 272 px, 1136 px wide (240 px sidebar + 32 px page padding) |
| Card radius | 12 px |
| Text fields and selects | 37 – 38 px tall |
| Primary page action | 44 px tall |
| Contrast of every text element, every route and state | at least AA (4.5 : 1, or 3 : 1 for large text) |

## Differences that are on purpose

**One shell, not several.** The export draws modules in two shell skins. Every module uses the approved Phase 1 shell (the "C" mark,
Business switcher, white top bar). Reference screens in the other skin contributed their content only.
Differences inside the shell: no "Pro" pill; the bell opens a short "No new notifications" panel and has no unread dot; the workspace switcher and the
profile lead to Settings; Settings and Help stay pinned under the scrolling list; there is no "+ New" menu (each module has its own primary action).

**Overview.** The business card is titled "Business information" and reads from Settings (the reference calls it the canonical source of truth).
The design-primitives verification block under it is a development aid and is not product.

**Numbers that would be invented are not drawn.** Where a reference shows a total that no records back, the tile is either derived from the real
records or left out: Customers (142 customers / 38 plans / 168 properties / follow-up), Services (8 services), the Jobs status strip, the
Bookings status chips, the Customers and Services grid views. The approved workspace-level totals are kept as the baselines they are: Bookings 24,
Completed Jobs 18, $6,240 invoiced, $2,130 received, plans 14 / 5 / 3 / 2, Reviews 12 / 4.7 / 3 / 5, Marketing 2 / 1 / 8 / 146, Analytics.
Tab counts are derived from the records (Bookings Requests 2 / Upcoming 5 / Past 6), not copied from screens that disagree with their own rows.

**Canonical data over screen data.** Where screens contradict each other the more specific or later one wins, and the choices are recorded in
stitch-screen-map.md §7 – §12. The visible results: six Services (not eight), Elena **Rodriguez** (never the stale spelling) and no fourth Team
member under that name, Samira Patel Active (her work history says so), one Home property for Sarah Mitchell, JB-204 Completed, weekdays computed from
dates (so no "Tomorrow, Oct 25"), and "Comfort Care" rather than "Annual Comfort Care".

**Features without an approved flow are not built.** Quick Assign, drag-and-drop, Block time, map and route views, Message / Suggest another time,
customer notes, service media, tax rules, the intake question builder, deletion of records, any payment processing, email or SMS sending. The listings
are in the "Deliberately not built" part of each phase section of stitch-screen-map.md.

**No pictures taken from elsewhere.** The Marketplace cover is a built-in pattern, not a photograph; the booking detail shows the address as text, not a
map image. The font is self-hosted and no page loads anything from another origin.

**Help.** No reference exists. It is a plain landing page: one card per area of the workspace, each with links into it. It states no support contact,
hours or article count because none is part of the product.

**Customer-facing pages.** The Website and Marketplace previews are the visitor's page: no sidebar or workspace top bar, a slim toolbar above the
frame (Back, Desktop / Mobile) that a real visitor would not have, and the footer wording of the approved copy ("© 2025 …"), which is fixed text and not read from a clock.

**Reduced widths.** Below 1024 px the user's name next to the avatar is dropped (the control keeps its accessible name), the workspace switcher and
search shrink, and wide tables scroll inside their own box. The sidebar is not collapsed: the workspace is built for tablet width and up (768 px is
the smallest audited size). A phone-width workspace was not designed and is not claimed.

## What this pass changed

- **Secondary text colour** `ink-muted` `#64748b` → `#5a687d`. The original reads at 4.3 : 1 on the warm inset surface and 4.1 : 1 on the tinted
  surfaces, under AA; the new value passes on every surface it is used on (4.6 : 1 or better) and is not visibly different.
- Back links read "Back to Marketing", "Back to Reviews", "Back to Roles" (they were lower-case next to Title Case siblings).
- Top bar: nothing overlaps or overflows from 768 to 1440 px; desktop geometry is unchanged to the pixel (a test pins it).
- Wide tables no longer push the page sideways; the day Schedule and the Bookings detail panel no longer stretch their grid at narrow widths.
- Every page has exactly one visible `h1` and no skipped heading level, including the public pages and the not-found screen.
- Help became a page; the bell became a working panel; the top-bar search now finds Customers, Jobs, Bookings and Schedule entries (it drew nothing before); the notice and empty-state wording lost its development language.
