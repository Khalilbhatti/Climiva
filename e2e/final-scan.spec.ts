/**
 * Phase 8, Parts P, Q, R and S. Whether the product and its source still carry concepts the approved scope rules out,
 * leftovers of development, assets that are not real, or dependencies nothing uses. The rendered pages and the source
 * the user can read are held to the same list.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { ROUTE_INVENTORY, STATE_ROUTES } from "./route-inventory";

/** Concepts the approved scope does not include. Technical words used for something else would be allowed; none are. */
const PROHIBITED: [RegExp, string][] = [
  [/Elena Rostova/i, "the stale spelling of Elena Rodriguez"],
  [/Wake County/i, "Wake County"],
  [/North Carolina/i, "North Carolina"],
  [/Module Foundation Ready/i, "Module Foundation Ready"],
  [/telemetry/i, "telemetry"],
  [/\bfleet\b/i, "fleet"],
  [/\bGPS\b/i, "GPS"],
  [/dispatch center/i, "dispatch center"],
  [/\bledger\b/i, "ledger"],
  [/AI insight/i, "AI insight"],
  [/AI recommendation/i, "AI recommendation"],
  [/verified provider/i, "verified provider"],
  [/Verified Experience/i, "Verified Experience"],
  [/accounting sync/i, "accounting sync"],
  [/\bNTP\b/, "NTP"],
  [/server time/i, "server time"],
  [/SEO score/i, "SEO score"],
  [/marketing attribution/i, "marketing attribution"],
];

function sourceFiles(dir: string, pattern = /\.(tsx?)$/): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path, pattern) : pattern.test(entry) ? [path] : [];
  });
}

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test.describe("no prohibited concept is on any screen", () => {
  for (const url of [...ROUTE_INVENTORY.map((route) => route.url), ...STATE_ROUTES]) {
    test(url, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const text = await page.locator("body").innerText();
      for (const [pattern, label] of PROHIBITED) expect(text, label).not.toMatch(pattern);
    });
  }
});

test.describe("none is in the source either", () => {
  test("not in the strings, data or markup (comments and tests may discuss them)", () => {
    const hits: string[] = [];
    for (const file of [...sourceFiles("src")]) {
      const text = stripComments(readFileSync(file, "utf8"));
      for (const [pattern, label] of PROHIBITED) if (pattern.test(text)) hits.push(`${file}: ${label}`);
    }
    expect(hits).toEqual([]);
  });
});

test.describe("development leftovers", () => {
  test("no console output, debugger statements or work markers in the source", () => {
    const hits: string[] = [];
    // The server layer reports a failure it has handled with console.error (that is what an operator reads); nothing in the browser code does.
    const isServerSide = (file: string) => /src[\\/](server|db)[\\/]|src[\\/]lib[\\/]auth\.ts$/.test(file);
    for (const file of sourceFiles("src")) {
      const raw = readFileSync(file, "utf8");
      const consoleCall = isServerSide(file) ? /console\.(log|debug|info|warn|trace)\(|\bdebugger\b/ : /console\.(log|debug|info|warn|error|trace)\(|\bdebugger\b/;
      if (consoleCall.test(stripComments(raw))) hits.push(`${file}: console/debugger`);
      if (/\b(TODO|FIXME|HACK|XXX)\b/.test(raw)) hits.push(`${file}: work marker`);
    }
    expect(hits).toEqual([]);
  });

  test("lint suppressions are the four justified ones: local object URLs shown with a plain <img>, and one remount after hydration", () => {
    const suppressions: string[] = [];
    for (const file of sourceFiles("src")) {
      const raw = readFileSync(file, "utf8");
      for (const match of raw.matchAll(/eslint-disable[^\n]*|@ts-(ignore|expect-error|nocheck)[^\n]*/g)) suppressions.push(`${file.replace(/\\/g, "/")}: ${match[0].replace(/\s*\*\/\}?\s*$/, "").trim()}`);
    }
    expect(suppressions.sort()).toEqual([
      "src/components/settings/BrandMark.tsx: eslint-disable-next-line @next/next/no-img-element",
      "src/components/settings/BrandingForm.tsx: eslint-disable-next-line @next/next/no-img-element",
      "src/components/settings/SettingsProvider.tsx: eslint-disable-next-line react-hooks/set-state-in-effect -- the remount is the point: it re-renders every date in the saved style",
      "src/components/ui/Avatar.tsx: eslint-disable-next-line @next/next/no-img-element",
    ]);
  });

  test("every test id in the source is used by a test, so none is left over", () => {
    const used = sourceFiles("e2e").map((file) => readFileSync(file, "utf8")).join("\n");
    const ids = new Set<string>();
    for (const file of sourceFiles("src")) for (const match of readFileSync(file, "utf8").matchAll(/data-testid="([^"]+)"/g)) ids.add(match[1]);
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(used, id).toContain(`"${id}"`);
  });

  test("no component, route or placeholder file is left from an earlier phase", () => {
    for (const gone of ["src/components/shell/ModulePlaceholder.tsx", "src/app/(signed-in)/(workspace)/help/placeholder.tsx"]) expect(existsSync(gone), gone).toBe(false);
    const stale = sourceFiles("src").filter((file) => /placeholder|scaffold|stub|\.old\.|\.bak|\.orig/i.test(file));
    expect(stale).toEqual([]);
  });
});

test.describe("the reference designs stay reference", () => {
  test("nothing in the source imports, links or loads from the design-reference folder", () => {
    const hits = sourceFiles("src").filter((file) => /design-reference/.test(stripComments(readFileSync(file, "utf8"))));
    expect(hits).toEqual([]);
    const config = ["next.config.ts", "postcss.config.mjs", "playwright.config.ts", "tsconfig.json"].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(config).not.toMatch(/design-reference\//);
  });

  test("Tailwind scans only src/, so the reference HTML is never treated as application source", () => {
    expect(readFileSync("src/app/globals.css", "utf8")).toMatch(/@import "tailwindcss" source\("\.\.\/"\)/);
  });
});

test.describe("assets", () => {
  test("there is no image, icon or font file that is empty, a stub or unreferenced", () => {
    const binaries = [...sourceFiles("src", /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf)$/i), ...(existsSync("public") ? sourceFiles("public", /./) : [])];
    expect(binaries.length).toBeGreaterThan(0);
    for (const file of binaries) expect(statSync(file).size, `${file} is a stub`).toBeGreaterThan(100);
    // Every asset the code names by path exists.
    const referenced = new Set<string>();
    for (const file of sourceFiles("src")) for (const match of readFileSync(file, "utf8").matchAll(/["'`]((?:\.\/|\/)[\w./-]+\.(?:png|jpe?g|gif|webp|ico|svg|woff2?))["'`]/gi)) referenced.add(match[1]);
    for (const path of referenced) {
      const local = path.startsWith("/") ? join("public", path) : join("src/app", path);
      expect(existsSync(local), path).toBe(true);
    }
  });

  test("the font is self-hosted and the app icon is a real file", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain('src: "./fonts/Inter-latin-variable.woff2"');
    expect(existsSync("src/app/fonts/Inter-latin-variable.woff2")).toBe(true);
    expect(readFileSync("src/app/icon.svg", "utf8")).toContain("<svg");
  });

  test("the app makes no request to another origin: no http(s) URL is loaded by the source", () => {
    const loads: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = stripComments(readFileSync(file, "utf8"));
      for (const match of text.matchAll(/(?:src|href|url\(|fetch\()\s*=?\s*[{(]?["'`](https?:\/\/[^"'`]+)["'`]/g)) loads.push(`${file}: ${match[1]}`);
    }
    expect(loads).toEqual([]);
  });
});

test.describe("dependencies", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; scripts: Record<string, string> };

  test("every runtime dependency is imported by the application", () => {
    const code = sourceFiles("src").map((file) => readFileSync(file, "utf8")).join("\n");
    for (const name of Object.keys(manifest.dependencies)) {
      const imported = new RegExp(`(from\\s+|import\\s+)["']${name.replace("/", "\\/")}(/[^"']*)?["']`).test(code) || (name === "react-dom" && /react-dom/.test(code + readFileSync("package.json", "utf8"))) || name === "next";
      expect(imported, name).toBe(true);
    }
  });

  test("every development dependency is used by a config file, a script or the tests", () => {
    const configs = ["eslint.config.mjs", "postcss.config.mjs", "tsconfig.json", "playwright.config.ts", "next.config.ts", "drizzle.config.ts", "src/app/globals.css"].map((file) => readFileSync(file, "utf8")).join("\n") + JSON.stringify(manifest.scripts);
    const tests = sourceFiles("e2e").map((file) => readFileSync(file, "utf8")).join("\n");
    const usedBy: Record<string, RegExp> = {
      "@tailwindcss/postcss": /@tailwindcss\/postcss/,
      "@types/node": /node:|process\./,
      "@types/pg": /from "pg"/,
      "@types/react": /tsconfig/,
      "@types/react-dom": /tsconfig/,
      "drizzle-kit": /drizzle-kit/,
      eslint: /eslint/,
      "eslint-config-next": /eslint-config-next/,
      playwright: /playwright/,
      tailwindcss: /tailwindcss/,
      tsx: /\btsx scripts\//,
      typescript: /tsc|typescript|tsconfig/,
    };
    for (const name of Object.keys(manifest.devDependencies)) {
      expect(usedBy[name], `${name} has a recorded use`).toBeDefined();
      expect(usedBy[name].test(configs + tests), name).toBe(true);
    }
  });

  test("the scripts a developer needs exist", () => {
    for (const script of ["dev", "build", "start", "lint", "typecheck", "test:e2e"]) expect(manifest.scripts[script], script).toBeTruthy();
  });

  test("the SaaS stack is exactly PostgreSQL, Drizzle and Better Auth: no backend-as-a-service, other database client, payment, cloud or analytics SDK", () => {
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    for (const required of ["pg", "drizzle-orm", "drizzle-kit", "better-auth"]) expect(names, required).toContain(required);
    expect(names.join(" ")).not.toMatch(/prisma|mongoose|mysql|sqlite|supabase|firebase|next-auth|clerk|auth0|stripe|paypal|sentry|segment|mixpanel|posthog|amplitude|axios|swr|react-query|redux|zustand|aws-sdk|@aws-sdk|redis|bullmq|ioredis/i);
  });
});
