/**
 * The boundary between the signed-in workspace and everything else, held in the source tree.
 *
 * The workspace's providers (the verified person, the workspaces they belong to, the business's settings and its core data: customers, jobs,
 * financials, analytics, the team, the Website's Draft) are read and sent to the browser by exactly one server component,
 * `WorkspaceProviders`, which only the workspace, the signed-in Draft previews and the signed-in "not found" page mount. The root layout, the
 * published Sites and Marketplace listings (`app/(public)`) and Log in, Sign up and set-up (`app/(auth)`) must not be able to reach it, a
 * provider, the session, the workspace or the workspace's data access at all, however a signed-in visitor looks. This builds the import graph
 * from each of those entry points and holds it to that, so the separation is a property of the code and not of what a page happens to show.
 * (public-boundary.spec.ts holds the same line at run time, against a server that is only able to run the public database functions.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { ROOT, SRC, chainOf, posix, reachable, walk } from "./import-graph";

const forbiddenIn = (entries: string[], forbidden: (path: string) => boolean): string[] => {
  const seen = reachable(entries);
  return [...seen.keys()].filter((file) => forbidden(posix(file))).map((file) => chainOf(seen, file));
};

/** The signed-in workspace: its data, its providers, its session and its chrome. */
const WORKSPACE = [
  /^src\/server\/(workspace|workspace-providers|session|core-data|authorize|marketing-data|reporting|preview-route)\.tsx?$/,
  /^src\/server\/actions\/(?!public-)/,
  /^src\/components\/providers\//,
  /Provider\.tsx$/,
  /^src\/components\/ui\/Toast\.tsx$/,
  /^src\/components\/shell\/(AppShell|TopBar|Sidebar|ShellMain|GlobalSearch|NotificationsMenu)\.tsx$/,
  /^src\/components\/workspace\//,
  /^src\/lib\/auth\.ts$/,
];
/** The database as a tenant: anything that opens a transaction for a person or reads a business's own tables. */
const TENANT_DATA = [/^src\/db\/tenant\.ts$/, /^src\/db\/(?!public-queries\.ts$)[a-z0-9-]*queries\.ts$/];

const isAny = (patterns: RegExp[]) => (path: string) => patterns.some((pattern) => pattern.test(path));

test.describe("the root layout is only the document", () => {
  test("it imports nothing of the application: no session, no workspace, no provider, no data", () => {
    const entries = [join(SRC, "app", "layout.tsx"), join(SRC, "app", "global-error.tsx")];
    const modules = [...reachable(entries).keys()].map(posix).sort();
    expect(modules).toEqual(["src/app/global-error.tsx", "src/app/globals.css", "src/app/layout.tsx"]);
    const source = readFileSync(entries[0], "utf8");
    for (const word of ["resolveWorkspace", "getCoreSnapshot", "AppProviders", "WorkspaceProviders", "requireWorkspaceContext", "cookies(", "headers("]) expect(source, word).not.toContain(word);
  });

  test("so does the root's own not-found: a layout's not-found is sent with every response under it, so it must hold no session and no workspace", () => {
    const entry = join(SRC, "app", "not-found.tsx");
    expect([...reachable([entry]).keys()].map(posix).sort()).toEqual(["src/app/not-found.tsx", "src/components/shell/PlainNotFound.tsx"]);
  });
});

test.describe("a published Site or Marketplace listing cannot reach the workspace", () => {
  const publicEntries = walk(join(SRC, "app", "(public)"));

  test("the public group has its pages, its layout and its own not-found", () => {
    const names = publicEntries.map(posix).sort();
    expect(names).toContain("src/app/(public)/layout.tsx");
    expect(names).toContain("src/app/(public)/not-found.tsx");
    expect(names.filter((name) => /\/(sites|listings)(\/|$)/.test(name) && name.endsWith("page.tsx"))).toEqual([
      "src/app/(public)/listings/[listingSlug]/[...rest]/page.tsx",
      "src/app/(public)/listings/[listingSlug]/book/[serviceSlug]/page.tsx",
      "src/app/(public)/listings/[listingSlug]/page.tsx",
      "src/app/(public)/listings/page.tsx",
      "src/app/(public)/sites/[siteSlug]/[...slug]/page.tsx",
      "src/app/(public)/sites/[siteSlug]/page.tsx",
      "src/app/(public)/sites/page.tsx",
    ]);
    // Nothing that is signed-in-only lives in it.
    expect(names.filter((name) => /\/(preview|builder)\//.test(name))).toEqual([]);
  });

  test("nothing a public page imports, however deep, is a provider, the session, the workspace, the Draft's data access or the shell", () => {
    expect(forbiddenIn(publicEntries, isAny([...WORKSPACE, ...TENANT_DATA]))).toEqual([]);
  });

  test("a public page reaches the database only through the fourteen public functions", () => {
    const seen = reachable(publicEntries);
    // The connection, the table definitions it is built from, the public functions' own queries and the plain mappers they use: no tenant
    // transaction (`tenant.ts`) and no other business's queries.
    const touchesDatabase = [...seen.keys()].map(posix).filter((path) => path.startsWith("src/db/") && !path.startsWith("src/db/schema/"));
    expect(touchesDatabase.sort()).toEqual(["src/db/index.ts", "src/db/public-queries.ts", "src/db/settings-mappers.ts"]);
    const source = readFileSync(join(SRC, "db", "public-queries.ts"), "utf8");
    const calls = [...source.matchAll(/\bapp_[a-z_]+\b/g)].map((match) => match[0]);
    expect([...new Set(calls)].sort()).toEqual([
      "app_public_asset",
      "app_public_create_booking",
      "app_public_create_marketplace_booking",
      "app_public_domain",
      "app_public_listing",
      "app_public_listing_booking",
      "app_public_marketplace_facets",
      "app_public_marketplace_search",
      "app_public_marketplace_sitemap",
      "app_public_review_request",
      "app_public_site",
      "app_public_site_domain",
      "app_public_submit_review",
      "app_tls_eligible",
    ]);
  });

  test("no public file reads who is signed in", () => {
    for (const file of publicEntries) {
      expect(readFileSync(file, "utf8"), posix(file)).not.toMatch(/resolveWorkspace|requireWorkspaceContext|getSessionUser|getCoreSnapshot|WorkspaceProviders|AppProviders|cookies\(|headers\(/);
    }
  });
});

test.describe("Log in, Sign up and set-up mount only what they need", () => {
  test("no workspace provider, no workspace data and no shell (a new business's first Site is written by set-up, never read for a page)", () => {
    const entries = walk(join(SRC, "app", "(auth)"));
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const forbidden = isAny([
      /^src\/server\/(workspace-providers|core-data|preview-route|marketing-data|reporting)\.tsx?$/,
      /^src\/components\/providers\//,
      /Provider\.tsx$/,
      /^src\/components\/ui\/Toast\.tsx$/,
      /^src\/components\/shell\/(AppShell|TopBar|Sidebar|ShellMain)\.tsx$/,
    ]);
    expect(forbiddenIn(entries, forbidden)).toEqual([]);
  });
});

test.describe("the front door and the review page", () => {
  test("the landing and the public header reach no provider, no workspace data, no tenant query and no shell; `/` asks the session only through the entry module", () => {
    const forbidden = isAny([
      /^src\/server\/(workspace|workspace-providers|core-data|authorize|preview-route|marketing-data|reporting)\.tsx?$/,
      /^src\/server\/actions\/(?!public-)/,
      /^src\/components\/providers\//,
      /Provider\.tsx$/,
      /^src\/components\/ui\/Toast\.tsx$/,
      /^src\/components\/shell\/(AppShell|TopBar|Sidebar|ShellMain)\.tsx$/,
      /^src\/components\/workspace\//,
    ]);
    const entries = walk(join(SRC, "app", "(entry)"));
    expect(entries.map(posix).sort()).toEqual(["src/app/(entry)/layout.tsx", "src/app/(entry)/page.tsx"]);
    expect(forbiddenIn(entries, forbidden)).toEqual([]);
    // The only tenant-aware modules the page reaches are the entry module and what it asks: the session, the memberships and the administrator check.
    const tenantish = [...reachable(entries).keys()].map(posix).filter((path) => /^src\/(db|server)\//.test(path) && !path.startsWith("src/db/schema/")).sort();
    expect(tenantish).toEqual(["src/db/index.ts", "src/db/platform-queries.ts", "src/db/tenant.ts", "src/server/entry.ts", "src/server/session.ts"]);
    // The landing itself reads nothing: it is the same for everyone.
    const landing = reachable([join(SRC, "components", "landing", "Landing.tsx")]);
    expect([...landing.keys()].map(posix).filter((path) => /^src\/(db|server)\//.test(path))).toEqual([]);
  });

  test("the review page and its form reach the database only through the two review functions and write no tenant record by themselves", () => {
    const entries = [join(SRC, "app", "(public)", "review", "[token]", "page.tsx")];
    expect(forbiddenIn(entries, isAny([...WORKSPACE, ...TENANT_DATA]))).toEqual([]);
    const source = readFileSync(entries[0], "utf8");
    expect(source).not.toMatch(/cookies\(|headers\(|getSessionUser|resolveWorkspace|organizationId/);
  });
});

test.describe("what mounts the workspace's providers", () => {
  const files = walk(SRC).filter((file) => !/server\/workspace-providers\.tsx$|components\/providers\/AppProviders\.tsx$/.test(posix(file)));
  const mentions = (word: string) => files.filter((file) => new RegExp(`\\b${word}\\b`).test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))).map(posix).sort();

  test("WorkspaceProviders is used by the signed-in layout (the workspace and the Draft previews) and the unmatched-address page for someone signed in, and nothing else", () => {
    expect(mentions("WorkspaceProviders")).toEqual(["src/app/(signed-in)/layout.tsx", "src/app/(unmatched)/not-found.tsx"]);
  });

  test("a not-found that reads the session or the workspace exists only where the routes it serves are already the workspace's or are no route at all", () => {
    const notFounds = walk(join(SRC, "app")).filter((file) => file.endsWith("not-found.tsx")).map(posix).sort();
    expect(notFounds).toEqual(["src/app/(public)/not-found.tsx", "src/app/(signed-in)/(preview)/not-found.tsx", "src/app/(signed-in)/(workspace)/not-found.tsx", "src/app/(unmatched)/not-found.tsx", "src/app/not-found.tsx"]);
    const readsWorkspace = notFounds.filter((file) => /resolveWorkspace|WorkspaceProviders|getSessionUser|getCoreSnapshot/.test(readFileSync(join(ROOT, file), "utf8")));
    expect(readsWorkspace).toEqual(["src/app/(unmatched)/not-found.tsx"]);
    // The pages that exist only to give a not found do nothing else.
    for (const file of ["(unmatched)/[...unknown]/page.tsx", "(public)/sites/page.tsx", "(public)/listings/page.tsx", "(public)/listings/[listingSlug]/[...rest]/page.tsx"]) {
      const source = readFileSync(join(SRC, "app", file), "utf8");
      expect(source, file).toContain("notFound();");
      expect(source, file).not.toMatch(/@\/server|@\/db|resolveWorkspace|cookies\(|headers\(/);
    }
  });

  test("AppProviders is mounted only by WorkspaceProviders", () => {
    expect(mentions("AppProviders")).toEqual([]);
    expect(readFileSync(join(SRC, "server", "workspace-providers.tsx"), "utf8")).toContain("<AppProviders");
  });

  test("the Draft previews and the workspace verify the caller before anything is read", () => {
    const source = readFileSync(join(SRC, "server", "workspace-providers.tsx"), "utf8");
    expect(source.indexOf("await requireWorkspaceContext()")).toBeGreaterThan(-1);
    expect(source.indexOf("await requireWorkspaceContext()")).toBeLessThan(source.indexOf("await getCoreSnapshot()"));
    // The signed-in not-found page mounts them only when the workspace is verified.
    const notFound = readFileSync(join(SRC, "app", "(unmatched)", "not-found.tsx"), "utf8");
    expect(notFound.indexOf('state.status !== "ready"')).toBeGreaterThan(-1);
    expect(notFound.indexOf('state.status !== "ready"')).toBeLessThan(notFound.indexOf("<WorkspaceProviders>"));
  });
});

test.describe("the boundary is written down", () => {
  test("section 30 of the architecture notes documents the groups, the public rule, the not-found carrier and the proof", () => {
    const text = readFileSync(join(ROOT, "docs", "saas-architecture.md"), "utf8");
    const start = text.indexOf("## 30. Route groups and the provider boundary");
    expect(start).toBeGreaterThan(0);
    const section = text.slice(start);
    for (const expected of ["WorkspaceProviders", "(public)", "(preview)", "(unmatched)", "(workspace)", "(signed-in)", "not-found.tsx", "byte for byte", "app_public_site", "provider-boundary.spec.ts", "public-boundary.spec.ts", "can do exactly one thing"]) {
      expect(section, expected).toContain(expected);
    }
    const headings = section.split(/\r?\n/).filter((line) => /^### /.test(line));
    for (const heading of [/The tree/, /The public route rule/, /What stays private/, /Proof/]) expect(headings.some((line) => heading.test(line)), String(heading)).toBe(true);
  });
});
