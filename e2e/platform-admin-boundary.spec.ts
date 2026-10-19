/**
 * Phase 19A, the platform console's boundary, held in the source tree rather than in a browser.
 *
 * The console (Climvia's own administration) and the workspace (a business's) must not be able to reach one another: the console reads no
 * workspace provider, no active organization and no tenant data access; the workspace, the public pages and the sign-in pages carry no link to,
 * import of, or word about the console. The console's database access is functions that check authority themselves, never a table. Every page
 * and Server Action asks for platform authority before it touches anything. And nothing in the code can become another person (no impersonation).
 * (platform-admin-routes.spec.ts holds the same lines at run time, against a server.)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { ROOT, SRC, chainOf, posix, reachable, walk } from "./import-graph";

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * The graph does not enter a Server Action (a Client Component calls one and never bundles it) or the application's own readiness check (the System page
 * shows what /health/ready answers; that module is shared by design and reads only the public functions).
 */
const followable = (file: string) => !posix(file).startsWith("src/server/actions/") && posix(file) !== "src/server/readiness.ts";

/** Every file that belongs to the console. */
const CONSOLE_FILES = [
  ...walk(join(SRC, "app", "(platform-admin)")),
  ...walk(join(SRC, "components", "platform-admin")),
  join(SRC, "server", "platform-admin.ts"),
  join(SRC, "server", "actions", "platform-admin.ts"),
  join(SRC, "db", "platform-queries.ts"),
  join(SRC, "db", "schema", "platform.ts"),
];
const isConsole = (path: string) => CONSOLE_FILES.map(posix).includes(posix(path));

test.describe("the console cannot reach the workspace", () => {
  test("nothing a console page imports, however deep, is a workspace provider, the active organization, the shell, a business's data access or fixture data", () => {
    const entries = [...walk(join(SRC, "app", "(platform-admin)")), ...walk(join(SRC, "components", "platform-admin"))];
    const seen = reachable(entries, followable);
    const forbidden = [
      /^src\/server\/(workspace|workspace-providers|core-data|authorize|marketing-data|reporting|preview-route|organizations|public-site|public-site-route|templates|branding)\.tsx?$/,
      /^src\/components\/providers\//,
      /Provider\.tsx$/,
      /^src\/components\/ui\/Toast\.tsx$/,
      /^src\/components\/shell\/(AppShell|TopBar|Sidebar|ShellMain|GlobalSearch|NotificationsMenu)\.tsx$/,
      /^src\/components\/workspace\//,
      /^src\/data\//,
      // Every data module of the database layer except the platform's own (and the connection and user-context helpers it is built on).
      /^src\/db\/(?!platform-queries\.ts$|tenant\.ts$|client\.ts$|index\.ts$|schema\/)[a-z0-9-]*\.ts$/,
    ];
    const offenders = [...seen.keys()].filter((file) => forbidden.some((pattern) => pattern.test(posix(file)))).map((file) => chainOf(seen, file));
    expect(offenders).toEqual([]);
  });

  test("the console's only database access is its own query module, which opens the user's context and calls functions", () => {
    const entries = [...walk(join(SRC, "app", "(platform-admin)")), ...walk(join(SRC, "components", "platform-admin")), join(SRC, "server", "platform-admin.ts"), join(SRC, "server", "actions", "platform-admin.ts")];
    const seen = reachable(entries, followable);
    const dbModules = [...seen.keys()].map(posix).filter((path) => path.startsWith("src/db/") && !path.startsWith("src/db/schema/")).sort();
    expect(dbModules.filter((path) => path !== "src/db/platform-queries.ts" && path !== "src/db/tenant.ts" && !/^src\/db\/(client|index)\.ts$/.test(path))).toEqual([]);
  });
});

test.describe("the workspace, the public pages and the sign-in pages know nothing of the console", () => {
  test("no file outside the console imports a console module or names the console, its tables or its functions", () => {
    const allowed = new Set(["src/proxy.ts", "src/db/schema/index.ts"]);
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const name = posix(file);
      if (isConsole(file) || allowed.has(name)) continue;
      const code = strip(readFileSync(file, "utf8"));
      if (/platform-admin|platform-queries|platform_admin|platformAdmin|PlatformAdmin|app_platform_|app_is_platform_admin|super_admin|platform_listing_moderation|platform_audit_events/.test(code)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  test("the only files that mention the console outside it are the proxy's route rules and the schema's export", () => {
    const proxy = strip(read("src/proxy.ts"));
    expect(proxy).toContain('PLATFORM_ROOT = "/platform-admin"');
    expect(proxy).toContain('PLATFORM_LOGIN = "/platform-admin/login"');
    expect(strip(read("src/db/schema/index.ts"))).toContain('export * from "./platform";');
  });

  test("no API route offers anything of the platform: authority is not exposed over HTTP", () => {
    const api = walk(join(SRC, "app", "api"));
    expect(api.length).toBeGreaterThan(0);
    for (const file of api) expect(strip(readFileSync(file, "utf8")), posix(file)).not.toMatch(/platform|super_admin/i);
  });
});

test.describe("the console's database access", () => {
  const source = read("src/db/platform-queries.ts");

  test("is functions only: every statement is `select <platform function>(...)`, and no table is named", () => {
    const statements = [...source.matchAll(/sql`([^`]*)`/g)].map((match) => match[1].trim());
    expect(statements.length).toBeGreaterThan(8);
    for (const statement of statements) expect(statement, statement).toMatch(/^select (app_platform_[a-z_]+|app_is_platform_admin)\(/);
    const code = strip(source);
    for (const word of ["platform_admins", "platform_listing_moderation", "platform_audit_events", "auth_user", "auth_session", "from organizations", "getDb(", "getPool(", ".insert(", ".update(", ".delete("]) expect(code, word).not.toContain(word);
    // Each statement runs as the verified person, in a transaction that sets who they are.
    expect(code).toContain("withUser(administratorId");
  });

  test("the table of assignments is named in the schema and the tools, and nowhere else in the application", () => {
    for (const file of walk(SRC)) {
      const name = posix(file);
      if (name === "src/db/schema/platform.ts") continue;
      expect(strip(readFileSync(file, "utf8")), name).not.toMatch(/platform_admins|platformAdmins/);
    }
  });

  test("the SQL functions never change who the caller is, and never write the assignments", () => {
    const sql = read("drizzle/0023_platform_admin_rls.sql");
    expect(sql).not.toMatch(/set_config\s*\(/i);
    expect(sql).not.toMatch(/(insert\s+into|update|delete\s+from)\s+(public\.)?platform_admins/i);
    // Every function that is not a trigger body is SECURITY DEFINER with a fixed search path, except the one pure text helper.
    const functions = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+([a-z_]+)\(([\s\S]*?)(?=\n\$\$;|\n\$[a-z]*\$;)/gi)];
    expect(functions.length).toBeGreaterThanOrEqual(12);
    for (const match of functions) {
      const header = match[0].slice(0, match[0].search(/\bAS\s+\$/i) === -1 ? 400 : match[0].search(/\bAS\s+\$/i));
      if (["app_platform_like", "platform_audit_events_refuse"].includes(match[1])) continue;
      expect(header, match[1]).toMatch(/SET search_path = public, pg_temp/);
    }
  });
});

test.describe("every page, layout and Server Action asks for platform authority first", () => {
  const consolePages = walk(join(SRC, "app", "(platform-admin)")).filter((file) => /(page|layout)\.tsx$/.test(file));

  test("the pages and layouts of the console", () => {
    expect(consolePages.map(posix).sort()).toEqual([
      "src/app/(platform-admin)/layout.tsx",
      "src/app/(platform-admin)/platform-admin/(console)/layout.tsx",
      "src/app/(platform-admin)/platform-admin/(console)/marketplace/page.tsx",
      "src/app/(platform-admin)/platform-admin/(console)/organizations/[organizationId]/page.tsx",
      "src/app/(platform-admin)/platform-admin/(console)/organizations/page.tsx",
      "src/app/(platform-admin)/platform-admin/(console)/page.tsx",
      "src/app/(platform-admin)/platform-admin/(console)/reviews/page.tsx",
      "src/app/(platform-admin)/platform-admin/(console)/system/page.tsx",
      "src/app/(platform-admin)/platform-admin/(console)/users/page.tsx",
      "src/app/(platform-admin)/platform-admin/login/page.tsx",
    ]);
  });

  test("each page of the console calls requirePlatformAdmin before any query or data call", () => {
    for (const file of consolePages) {
      const name = posix(file);
      if (name.endsWith("login/page.tsx") || name === "src/app/(platform-admin)/layout.tsx") continue;
      const code = strip(readFileSync(file, "utf8"));
      const guard = code.indexOf("await requirePlatformAdmin()");
      expect(guard, `${name} asks for authority`).toBeGreaterThan(-1);
      const firstData = code.search(/\bawait (platform[A-Z]\w*|checkReadiness|isPlatformAdmin)\(|Promise\.all\(\[\s*(checkReadiness|platform)/);
      if (firstData !== -1) expect(guard, `${name} asks before reading`).toBeLessThan(firstData);
    }
  });

  test("the sign-in page asks who is signed in, and only then whether they are an administrator, and says nothing about either", () => {
    const code = strip(read("src/app/(platform-admin)/platform-admin/login/page.tsx"));
    expect(code.indexOf("getSessionUser()")).toBeGreaterThan(-1);
    expect(code.indexOf("getSessionUser()")).toBeLessThan(code.indexOf("isPlatformAdmin("));
    expect(code).not.toMatch(/notFound\(|forbidden|not allowed|denied/i);
  });

  test("the moderation Server Action is 'use server', asks for authority before it reads the form, never revalidates, and returns only to the console", () => {
    const file = read("src/server/actions/platform-admin.ts");
    expect(file.trimStart().startsWith('"use server"')).toBe(true);
    const code = strip(file);
    expect(code.indexOf("await requirePlatformAdmin()")).toBeGreaterThan(-1);
    expect(code.indexOf("await requirePlatformAdmin()")).toBeLessThan(code.indexOf("formData.get("));
    expect(code).not.toMatch(/revalidate/);
    expect(code).toMatch(/\^\\\/platform-admin/);
    // Everything this file exports is an async function: a Server Action file may export nothing else.
    for (const exported of code.matchAll(/export\s+(?:async\s+)?(function|const|class|let|var|type|interface)\s+(\w+)/g)) {
      if (exported[1] === "type" || exported[1] === "interface") continue;
      expect(exported[0], exported[2]).toMatch(/export async function/);
    }
  });
});

test.describe("no way to become someone else", () => {
  test("nothing in the console, the tools or the platform functions creates a session, signs in as another person, or sets a login cookie", () => {
    const files = [...CONSOLE_FILES, ...walk(join(ROOT, "scripts", "platform-admin"))];
    for (const file of files) {
      const code = strip(readFileSync(file, "utf8"));
      expect(code, posix(file)).not.toMatch(/impersonat|signInAs|loginAs|createSession|setSessionCookie|auth\.api\.(signIn|createSession)|insert\s+into\s+auth_session|session_token|better-auth\.session/i);
    }
  });

  test("the pages have no 'log in as', 'view as' or 'switch to' control for a business or a person", () => {
    for (const file of walk(join(SRC, "app", "(platform-admin)")).concat(walk(join(SRC, "components", "platform-admin")))) {
      expect(strip(readFileSync(file, "utf8")), posix(file)).not.toMatch(/log in as|sign in as|view as|switch to (this )?business|act as/i);
    }
  });
});

test.describe("the tools", () => {
  test("are npm scripts that run the command-line files, and nothing else writes the assignments", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["platform-admin:grant"]).toBe("tsx scripts/platform-admin/grant.ts");
    expect(scripts["platform-admin:revoke"]).toBe("tsx scripts/platform-admin/revoke.ts");
    expect(scripts["platform-admin:list"]).toBe("tsx scripts/platform-admin/list.ts");
    for (const name of ["grant", "revoke", "list"]) expect(existsSync(join(ROOT, "scripts", "platform-admin", `${name}.ts`))).toBe(true);
  });

  test("use the owner connection and the exact-match lookup, take no password and create no account", () => {
    for (const name of ["grant", "revoke"]) {
      const code = strip(read(`scripts/platform-admin/${name}.ts`));
      expect(code).toContain("adminDb(");
      expect(code).toContain("where lower(email) = $1");
      expect(code).not.toMatch(/insert\s+into\s+auth_(user|account|session)|password|signUp|createUser|ensureUser/i);
      expect(code).not.toMatch(/delete\s+from\s+auth_user/i);
    }
  });
});

test.describe("the documentation", () => {
  const architecture = read("docs/saas-architecture.md");
  const section = architecture.slice(architecture.indexOf("## 36. Platform administration"));
  const runbook = read("docs/deployment-runbook.md");
  const readme = read("README.md");
  const readmePart = readme.slice(readme.indexOf("### Platform administrators"), readme.indexOf("### Development accounts"));

  test("section 36 says Platform Super Admin != Organization Owner, how the first administrator is granted, what is moderated and what Phase 19B must change", () => {
    expect(architecture).toContain("36. [Platform administration](#36-platform-administration-phase-19a)");
    for (const expected of [
      "Platform Super Admin != Organization Owner",
      "npm run platform-admin:grant",
      "npm run platform-admin:revoke",
      "platform_admins",
      "platform_listing_moderation",
      "platform_audit_events",
      "app_is_platform_admin",
      "requirePlatformAdmin",
      "no impersonation",
      "Review moderation: not built",
      "Phase 19B",
      "Business signup",
      "Business login",
    ]) expect(section, expected).toContain(expected);
    for (const heading of [/The rule/, /The data/, /Granting and revoking/, /Route and authentication boundary/, /Row Level Security/, /Marketplace moderation/, /The audit trail/, /What this does not do/, /What Phase 19B must change/]) {
      expect(section.split(/\r?\n/).filter((line) => /^### /.test(line)).some((line) => heading.test(line)), String(heading)).toBe(true);
    }
    // The route-group table of section 30 lists the new group.
    expect(architecture).toContain("| `(platform-admin)` |");
  });

  test("the runbook and README tell an operator how to grant the first administrator through the tools image", () => {
    expect(runbook).toContain("## 9. The platform console and its first administrator");
    expect(runbook).toContain("npm run platform-admin:grant  -- --email");
    expect(runbook).toContain("run --rm migrate npm run platform-admin:list");
    expect(readmePart).toContain("npm run platform-admin:grant -- --email <address>");
    expect(readmePart).toContain("not an Organization owner");
  });

  test("no real person's address is in the platform documentation", () => {
    const handoff = read("docs/production-handoff.md");
    const handoffPart = handoff.slice(handoff.indexOf("> **Phase 19A update.**"), handoff.indexOf("## Contents"));
    const runbookPart = runbook.slice(runbook.indexOf("## 9. The platform console"), runbook.indexOf("## 10. Not covered here"));
    for (const [name, text] of [["architecture", section], ["runbook", runbookPart], ["README", readmePart], ["handoff", handoffPart]] as const) {
      expect(text.length, name).toBeGreaterThan(200);
      expect(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g) ?? [], name).toEqual([]);
    }
  });
});
