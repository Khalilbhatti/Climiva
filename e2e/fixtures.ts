import { test as base, expect, request as playwrightRequest, type APIRequestContext, type Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { ensureTestTenant, resetTestTenant } from "../scripts/db/seed-lib";

type ConsoleGuard = {
  /** Declare a browser console message this test is expected to produce (e.g. the 404 on a not-found page). */
  allow: (pattern: RegExp) => void;
};

type StorageState = Awaited<ReturnType<APIRequestContext["storageState"]>>;
type TestTenant = {
  userId: string;
  organizationId: string;
  email: string;
  password: string;
  /** The public address of this copy's primary site (`/sites/<platformSlug>`) and of its Marketplace listing. */
  platformSlug: string;
  listingSlug: string;
};
type WorkerFixtures = {
  /** This worker's private copy of the Apex workspace, with its owner signed in. */
  workerTenant: TestTenant & { storageState: StorageState };
  /** Hands out a client address no other test uses, so login rate limiting never couples tests together. */
  clientAddresses: () => string;
};
type TestFixtures = { consoleGuard: ConsoleGuard; resetTenant: void };

const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://localhost:3460";

/** A Site's address as the screens write it: the configured origin, then `/sites/<platform slug>`. */
export const siteAddress = (platformSlug: string) => `${ORIGIN}/sites/${platformSlug}`;

/**
 * Resolves once React has taken over the page: the router is running and every control in the top bar and the main area has
 * been attached to. A click or key press that lands before that is silently lost, and a field typed into before it is reset,
 * which is what makes a test pass nine times in ten. Pages without such controls (an error page) resolve at once.
 *
 * Content the server streams after the page shell (a Suspense boundary) is not part of the page until React reveals it: until then its fallback
 * is a `template#B:n` and the finished content waits in a hidden `div#S:n`, outside `main`. Its elements can already be found by id, but a hidden
 * element cannot take focus (`locator.focus()` waits only for it to exist, and does nothing), so a key pressed then goes to the page body. The
 * page is not ready while any boundary is unrevealed.
 *
 * A hidden input is not a control anyone can click or type into, and React writes one into every form whose action is a Server Action (`$ACTION_ID_…`) as
 * plain HTML that never gets a fiber; waiting for it would make every page with such a form run out the whole timeout.
 */
export async function waitForHydration(page: Page, timeout = 10_000) {
  await page.waitForFunction(
    () => {
      const router = (window as unknown as { next?: { router?: unknown } }).next?.router;
      const unrevealed = document.querySelector('template[id^="B:"], div[hidden][id^="S:"]');
      const controls = [...document.querySelectorAll("header button, main button, main input:not([type=hidden]), main select, main textarea")];
      return Boolean(router) && !unrevealed && controls.every((control) => Object.keys(control).some((key) => key.startsWith("__reactFiber$")));
    },
    undefined,
    { timeout },
  );
}

/** Makes every `page.goto` on this page wait for hydration before it returns (see waitForHydration). */
export function waitsForHydration(page: Page): Page {
  const goto = page.goto.bind(page);
  page.goto = (async (url, options) => {
    const response = await goto(url, options);
    await waitForHydration(page).catch(() => undefined);
    return response;
  }) as typeof page.goto;
  return page;
}

/**
 * Signs in over HTTP (the same endpoint the Log in form calls) and returns the browser state that results.
 * `address` stands in for the visitor's IP: Better Auth rate-limits sign-in per address, and every test comes from this machine.
 */
export async function signInOverHttp(email: string, password: string, address: string): Promise<StorageState> {
  const api = await playwrightRequest.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { origin: ORIGIN, "x-forwarded-for": address } });
  try {
    const response = await api.post("/api/auth/sign-in/email", { data: { email, password } });
    if (!response.ok()) throw new Error(`Test sign-in for ${email} failed: ${response.status()} ${await response.text()}`);
    return await api.storageState();
  } finally {
    await api.dispose();
  }
}

/**
 * Every test fails if the page logs a console error/warning or throws. This is what catches React
 * hydration mismatches, which surface as console errors rather than failed assertions.
 *
 * Every test also starts signed in as the owner of its worker's own copy of the Apex workspace, restored to the
 * canonical record before each test, because Settings is stored in PostgreSQL now. A spec that needs to be signed out
 * or signed in as someone else says so with `test.use({ storageState })`.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  clientAddresses: [
    async ({}, use) => {
      let sequence = 0;
      // An IPv6 address whose first 64 bits are unique to this worker process and to this call (Better Auth keys rate limits on
      // the /64), so no two tests, workers or concurrent runs ever share a bucket.
      await use(() => {
        sequence += 1;
        return `fd00:${process.pid.toString(16)}:${sequence.toString(16)}::1`;
      });
    },
    { scope: "worker" },
  ],

  workerTenant: [
    async ({ clientAddresses }, use, workerInfo) => {
      const tenant = await ensureTestTenant(workerInfo.parallelIndex);
      const storageState = await signInOverHttp(tenant.email, tenant.password, clientAddresses());
      await use({ ...tenant, storageState });
    },
    { scope: "worker" },
  ],

  // Every navigation by address waits for the page to be live before the test touches it (see waitForHydration).
  page: async ({ page }, use) => {
    await use(waitsForHydration(page));
  },

  // Signed in unless the spec says otherwise.
  storageState: async ({ workerTenant }, use) => {
    await use(workerTenant.storageState);
  },

  // A different client address for every test (and so for every page it opens), see `clientAddresses`.
  extraHTTPHeaders: async ({ clientAddresses }, use) => {
    await use({ "x-forwarded-for": clientAddresses() });
  },

  resetTenant: [
    async ({ workerTenant }, use) => {
      const { pool, db } = adminDb();
      try {
        await resetTestTenant(db, workerTenant);
        await use();
      } finally {
        await pool.end();
      }
    },
    { auto: true },
  ],

  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      const allowed: RegExp[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(`[${message.type()}] ${message.text()}`);
      });
      page.on("pageerror", (error) => problems.push(`[pageerror] ${error.message}`));

      await use({ allow: (pattern) => allowed.push(pattern) });

      const unexpected = problems.filter((problem) => !allowed.some((pattern) => pattern.test(problem)));
      expect(unexpected, "console errors, warnings or uncaught exceptions").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
