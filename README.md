# Climvia Business Workspace

A workspace for an HVAC service business: bookings and scheduling, jobs, customers and services, the team,
quotes, invoices and payments, maintenance plans, the public website and marketplace listing, reviews, marketing
campaigns, analytics and settings. The business in the sample data is Apex Climate Heating & Air, Austin, TX.

## What this is, and what it is not

This is the **front end** of the product, complete and navigable. It runs entirely in the browser on sample data that
ships with the code.

- Everything you change (create a booking, record a payment, edit Settings…) lives **in memory for the session**
  and is gone when the page reloads. That is by design, not a bug.
- There is **no backend, no database, no sign-in, no payment processor, no email or SMS sending, and no real domain
  connection.** The screens that appear to do those things record the action and say so; nothing leaves the browser.
- Nothing here claims production services. See [docs/production-handoff.md](docs/production-handoff.md) for what a
  real backend would need to provide and where it would plug in.

## Stack

| | |
| --- | --- |
| Framework | Next.js 16.3.8 (App Router, typed routes) |
| UI | React 19.2.8, Tailwind CSS 4, lucide-react icons, Inter (self-hosted) |
| Language | TypeScript 5, strict |
| Tests | Playwright 1.63 (Chromium) against the production build |

No UI kit, state library, data-fetching library or analytics client is used. Runtime dependencies are `next`, `react`,
`react-dom` and `lucide-react`.

## Getting started

Requires Node.js 20.9 or newer (developed on 24) and npm.

```bash
npm install            # install dependencies
npm run dev            # development server at http://localhost:3000
```

Checks and production build:

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run build          # production build
npm run start          # serve the production build at http://localhost:3000
```

Tests:

```bash
npx playwright install chromium   # once, only if the Playwright browser is not installed yet
npm run test:e2e                  # builds, serves on port 3460, runs every spec, stops the server
```

`npm run test:e2e` reuses a server that is already listening on port 3460 (outside CI), which makes re-runs fast
after a build. Run a single spec with `npx playwright test e2e/payments.spec.ts`. The browser tests need no network:
the font is bundled and nothing calls out.

## How it is put together

```
src/
  app/
    (workspace)/    every module, inside the one shell (sidebar + top bar)
    (site)/         the customer-facing pages: Website preview and Marketplace listing, no shell
    layout.tsx      fonts, global styles, and the session providers
  components/       one folder per module, plus shell/ (layout) and ui/ (shared primitives)
  config/           navigation (the sidebar) and typed route helpers
  data/             the sample records and the selectors that read them, one file per module
  lib/              state transitions, date and display helpers
e2e/                Playwright specs and their helpers
docs/               design map, visual audit, production handoff
```

- **The shell.** `AppShell` (top bar, 240 px sidebar, content area) wraps every route in `(workspace)` and stays mounted
  as the user moves between modules. The public previews live in `(site)` so they never get the workspace chrome.
- **Session providers.** One provider per area (Settings, Team, Operations, Financial, Maintenance Plans, Website,
  Marketplace, Reviews, Marketing) is mounted once at the app root, so the public previews read the same session as
  the workspace.
- **Records and selectors.** `src/data/*` holds the sample records as typed objects and the pure selectors that
  derive everything shown (balances, counts, statuses). Nothing is stored twice.
- **Session-only changes.** Every action goes through a pure function in `src/lib/*-state.ts` that takes the current
  data and returns the next; the provider holds the result in React state. Reloading restores the sample data.
- **A fixed clock.** The product's "today" is Friday, October 25, 2024, in the business's time zone
  (America/Chicago). Nothing reads the system clock or the browser's time zone, so every visitor sees the same
  dates and times and the server and browser always render the same text.

### Which module owns which fact

| Fact | Owner | Read by |
| --- | --- | --- |
| Business name, phone, email, address | Settings → Business information | Overview, Website, Marketplace, invoices, public pages |
| Business hours | Settings → Business hours | Overview, Schedule, booking slots, Website, Marketplace, Team availability |
| Logo and accent | Settings → Branding | Website and Marketplace previews |
| Date, time and currency display | Settings → Workspace preferences | every date and time on every screen |
| Signed-in person's name | Settings → My profile | top bar, review responses |
| The Services offered | Services | Bookings, Website, Marketplace, Analytics, Team eligibility |
| Who can be assigned work | Team | Jobs, Schedule, Bookings, Maintenance Plans |
| Public site content | Website | the Website preview |
| Marketplace listing | Marketplace | the Marketplace preview |

Analytics owns nothing: it reads the other modules.

## Testing

The Playwright suite drives the production build in Chromium. It covers each module's screens and flows, then the
whole product: a crawl of every route and state (no console error, hydration warning or failed request), the
sidebar and Overview quick actions, the sample-data invariants, session changes followed across modules, five
screen sizes, accessibility and colour contrast, identical text under other time zones, languages and clocks, and a
scan for leftovers and out-of-scope concepts. At the last run all 1725 tests passed (37 spec files, about six minutes).
See [docs/production-handoff.md](docs/production-handoff.md#testing-status) for what each group covers.

## Deploying

The app is a standard Next.js build with no environment variables, no API routes, no middleware and no server
actions, so it deploys to Vercel (or any Node host) unchanged:

1. Import the repository in Vercel; the framework preset is detected as Next.js.
2. Build command `npm run build`, install command `npm install`, no environment variables.
3. Deploy. Every visitor gets the same sample data, and changes made in a visit do not persist or reach anyone else.

Deploying shows the workspace as a demonstration. It does not make it a hosted product: there is nowhere to store
what people do.

## More

- [docs/production-handoff.md](docs/production-handoff.md): modules, routes, data model, limits, and the seams a backend would use.
- [docs/final-visual-audit.md](docs/final-visual-audit.md): how the finished product compares with the approved designs.
- [docs/stitch-screen-map.md](docs/stitch-screen-map.md): the design export, screen by screen, and every decision made where it contradicted itself.
