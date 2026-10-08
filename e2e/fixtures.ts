import { test as base, expect } from "playwright/test";

type ConsoleGuard = {
  /** Declare a browser console message this test is expected to produce (e.g. the 404 on a not-found page). */
  allow: (pattern: RegExp) => void;
};

/**
 * Every test fails if the page logs a console error/warning or throws. This is what catches React
 * hydration mismatches, which surface as console errors rather than failed assertions.
 */
export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
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
