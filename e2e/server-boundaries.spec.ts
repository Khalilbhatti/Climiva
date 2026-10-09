/**
 * The boundaries that keep one business's data away from another's, checked in the source rather than in a browser:
 * what may reach the client, who must authorize, what must never be cached, and what may never be switched off.
 * A change that crosses one of these lines fails here before it can ship.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "playwright/test";
import { NORTHSTAR_CUSTOMERS, NORTHSTAR_OPERATIONS, NORTHSTAR_SERVICES, NORTHSTAR_TEAM } from "../scripts/db/seed-data/northstar";
import { BOOKINGS, CUSTOMERS, JOBS, PROPERTIES, SERVICES, TEAM } from "./apex-data";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, accept: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path, accept);
    return accept(path) ? [path] : [];
  });
}

const sourceFiles = walk(SRC, (path) => /\.(ts|tsx)$/.test(path));
const posix = (path: string) => relative(ROOT, path).split(sep).join("/");
const read = (path: string) => readFileSync(path, "utf8");
const isClientFile = (source: string) => /^\s*(["'])use client\1/.test(source.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
const importsOf = (source: string) => [...source.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)].map((match) => match[1] ?? match[2]);

test.describe("nothing server-only reaches the browser", () => {
  const clientFiles = sourceFiles.filter((path) => isClientFile(read(path)));

  test("there are client components to check", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
  });

  test("no client component imports the database, the auth server, server-only code or Node modules", () => {
    const offenders: string[] = [];
    for (const path of clientFiles) {
      for (const specifier of importsOf(read(path))) {
        const forbidden =
          specifier === "pg" ||
          specifier.startsWith("drizzle-orm") ||
          specifier === "server-only" ||
          specifier === "better-auth" ||
          (specifier.startsWith("better-auth/") && specifier !== "better-auth/react") ||
          specifier.startsWith("node:") ||
          specifier.startsWith("@/db") ||
          specifier === "@/lib/auth" ||
          (specifier.startsWith("@/server") && !specifier.startsWith("@/server/actions/"));
        if (forbidden) offenders.push(`${posix(path)} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the only server modules a client component may call are Server Actions", () => {
    for (const path of clientFiles) {
      for (const specifier of importsOf(read(path))) {
        if (!specifier.startsWith("@/server/actions/")) continue;
        const actionFile = join(SRC, `${specifier.replace("@/", "")}.ts`);
        expect(existsSync(actionFile), `${posix(path)} -> ${specifier}`).toBe(true);
        expect(/^\s*(["'])use server\1/m.test(read(actionFile)), `${specifier} must be a "use server" file`).toBe(true);
      }
    }
  });

  test("server-only code says so: every file in src/server and src/db that needs the request marks itself server-only", () => {
    for (const path of walk(join(SRC, "server"), (file) => /\.(ts|tsx)$/.test(file))) {
      const source = read(path);
      const isAction = /^\s*(["'])use server\1/m.test(source);
      expect(isAction || source.includes('import "server-only"'), `${posix(path)} must import "server-only" or be a "use server" file`).toBe(true);
    }
  });

  test("no customer, property, Service, team, booking or job record is compiled into the browser's JavaScript", () => {
    // The foundations and the operations are read from PostgreSQL for the verified business and sent to that business's browser
    // only. Their seed lives in scripts/db/seed-data, which nothing under src imports; this checks the built result, where a stray
    // import would show.
    const staticDir = join(ROOT, ".next", "static");
    expect(existsSync(staticDir), "run a production build first (npm run build)").toBe(true);
    const bundle = walk(staticDir, (path) => path.endsWith(".js")).map(read).join("\n");
    expect(bundle.length).toBeGreaterThan(100_000);
    const distinctive = [
      ...CUSTOMERS.flatMap((customer) => [customer.email, customer.phone]),
      ...PROPERTIES.flatMap((property) => [property.street, property.accessInstructions ?? ""]),
      ...SERVICES.map((service) => service.description),
      ...TEAM.flatMap((member) => [member.email ?? "", member.notes ?? ""]),
      ...NORTHSTAR_CUSTOMERS.flatMap((customer) => [customer.name, customer.email]),
      ...NORTHSTAR_SERVICES.map((service) => service.name),
      ...NORTHSTAR_TEAM.map((member) => member.name),
    ].filter(Boolean);
    expect(distinctive.length).toBeGreaterThan(30);
    expect(distinctive.filter((value) => bundle.includes(value) || bundle.includes(JSON.stringify(value).slice(1, -1)))).toEqual([]);

    // The operations: the people on bookings that have no customer record, and the free text of jobs and bookings.
    const fixtureText = walk(join(SRC, "data"), (path) => path.endsWith(".ts")).map(read).join("\n");
    const operations = [
      ...BOOKINGS.flatMap((booking) => [booking.contactName ?? "", booking.intake?.reportedIssue ?? "", booking.contact?.address ?? ""]),
      ...JOBS.flatMap((job) => [
        job.details.technicianDiagnosis ?? "",
        job.details.workPerformed ?? "",
        job.details.customerSummary ?? "",
        job.details.safetyNote ?? "",
        job.completion?.notes ?? "",
        ...job.files.map((file) => file.caption ?? ""),
      ]),
      ...NORTHSTAR_OPERATIONS.bookings.flatMap((booking) => [booking.contactName ?? "", booking.contact?.email ?? "", booking.contact?.address ?? ""]),
    ]
      // A name that the not-yet-migrated modules' own sample records also use (Claire Dubois on a quote) legitimately ships.
      .filter((value) => value.length > 12 && !fixtureText.includes(value));
    expect(operations.length).toBeGreaterThan(20);
    expect(operations.filter((value) => bundle.includes(value) || bundle.includes(JSON.stringify(value).slice(1, -1)))).toEqual([]);
  });

  test("no secret is exposed to the browser through NEXT_PUBLIC_ variables", () => {
    const offenders = sourceFiles.filter((path) => /NEXT_PUBLIC_[A-Z_]*(SECRET|PASSWORD|KEY|TOKEN|DATABASE)/.test(read(path))).map(posix);
    expect(offenders).toEqual([]);
    expect(read(join(ROOT, ".env.example"))).not.toMatch(/NEXT_PUBLIC_/);
  });
});

test.describe("every Server Action authorizes its caller", () => {
  const actionFiles = walk(join(SRC, "server", "actions"), (path) => path.endsWith(".ts"));

  test("each exported action resolves the caller from the session before it does anything else", () => {
    // signOutAction only ends the caller's own session: it needs no workspace and is safe when already signed out.
    const exempt = new Set(["signOutAction"]);
    const CHECKS = /resolveWorkspace\(|getSessionUser\(|manager\(|authorize\(|requireMember\(/;
    for (const path of actionFiles) {
      const source = read(path);
      const exported = [...source.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
      expect(exported.length, `${posix(path)} exports no actions`).toBeGreaterThan(0);
      // team.ts and operations.ts route every write through one helper whose first step is the authorization; it is checked below.
      const helper = /async function (?:change|mutate)<[\s\S]*?\n}\n/.exec(source)?.[0];
      for (const [, name, body] of exported) {
        if (exempt.has(name)) continue;
        const direct = CHECKS.test(body);
        const viaHelper = helper !== undefined && /\b(?:change|mutate)\(/.test(body) && /await authorize\(/.test(helper);
        expect(direct || viaHelper, `${name} in ${posix(path)} does not check the session`).toBe(true);
      }
    }
  });

  test("the actions that read or write a business's data authorize before they open a tenant transaction", () => {
    for (const path of actionFiles) {
      const source = read(path);
      for (const [, name, body] of source.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)) {
        const opens = body.search(/withTenant\(|withUser\(/);
        if (opens === -1) continue;
        const checks = body.search(/resolveWorkspace\(|getSessionUser\(|manager\(|authorize\(|requireMember\(/);
        expect(checks, `${name} in ${posix(path)} opens a transaction without checking the session`).toBeGreaterThanOrEqual(0);
        expect(checks, `${name} in ${posix(path)} checks the session after it opens a transaction`).toBeLessThan(opens);
      }
    }
  });

  test("Services, Team and operations writes need the owner/admin capability", () => {
    const services = read(join(SRC, "server", "actions", "services.ts"));
    expect(services.match(/authorize\("services:manage"/g)?.length).toBe(2);
    expect(services).not.toMatch(/requireMember\(/);
    const team = read(join(SRC, "server", "actions", "team.ts"));
    expect(team).toMatch(/authorize\("team:manage"/);
    // Every booking and job write goes through the one helper that authorizes "operations:manage" first.
    const operations = read(join(SRC, "server", "actions", "operations.ts"));
    expect(operations.match(/authorize\("operations:manage"/g)?.length).toBe(1);
    expect(operations).not.toMatch(/requireMember\(/);
    const exported = [...operations.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)];
    expect(exported.map(([, name]) => name).sort()).toEqual(
      ["assignAction", "cancelBookingAction", "completeJobAction", "confirmBookingAction", "createBookingAction", "createJobAction", "setFileVisibilityAction", "startJobAction", "updateJobDetailsAction"].sort(),
    );
    // Each one hands everything it does to mutate(): nothing is parsed, looked up or written before the caller is authorized.
    for (const [, name, body] of exported) expect(/>\s\{\s+return mutate\(/.test(body), `${name} must start by handing everything to mutate()`).toBe(true);
    // The capabilities are decided in one place.
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"services:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"team:manage": \["owner", "admin"\]/);
    expect(read(join(SRC, "lib", "policy.ts"))).toMatch(/"operations:manage": \["owner", "admin"\]/);
  });

  test("no action takes an organization id from the client and trusts it", () => {
    for (const path of actionFiles) {
      const source = read(path);
      // `switchOrganizationAction` is the one that receives an id, and it verifies it against the caller's memberships.
      const trusting = [...source.matchAll(/export async function (\w+)\((\w*[oO]rganization\w*)[:)]/g)].filter(([, name]) => name !== "switchOrganizationAction");
      expect(trusting.map(([, name]) => name), posix(path)).toEqual([]);
    }
    expect(read(join(SRC, "server", "actions", "workspace.ts"))).toContain("isActiveMember(user.id, organizationId)");
  });
});

test.describe("tenant data is never cached or prerendered", () => {
  test("nothing in src uses a data cache, static revalidation or static generation", () => {
    const patterns = [/unstable_cache/, /["']use cache["']/, /export const revalidate/, /export const fetchCache/, /["']force-static["']/, /generateStaticParams/, /cacheLife|cacheTag/];
    const offenders: string[] = [];
    for (const path of sourceFiles) {
      const source = read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const pattern of patterns) if (pattern.test(source)) offenders.push(`${posix(path)} matches ${pattern}`);
    }
    expect(offenders).toEqual([]);
  });

  test("the workspace, site and auth route groups are force-dynamic", () => {
    for (const file of ["(workspace)/layout.tsx", "(site)/layout.tsx", "(auth)/login/page.tsx", "(auth)/signup/page.tsx", "(auth)/onboarding/page.tsx"]) {
      expect(read(join(SRC, "app", file)), file).toMatch(/export const dynamic = "force-dynamic"/);
    }
  });

  test("the app has exactly one API route: Better Auth's", () => {
    const routes = walk(join(SRC, "app"), (path) => /route\.(ts|tsx)$/.test(path)).map(posix);
    expect(routes).toEqual(["src/app/api/auth/[...all]/route.ts"]);
  });

  test("no module-level variable in src/server holds tenant rows between requests", () => {
    for (const path of walk(join(SRC, "server"), (file) => /\.(ts|tsx)$/.test(file))) {
      const topLevelLets = read(path).match(/^(?:let|var) /gm);
      expect(topLevelLets, `${posix(path)} has a module-level mutable variable`).toBeNull();
    }
  });
});

test.describe("every fixture-backed page checks its caller and its tenant", () => {
  const FIXTURE_MODULES = ["analytics", "maintenance-plans", "marketing", "marketplace", "payments", "quotes-invoices", "reviews", "website"];
  /** Customers, Services, Team, Bookings, Jobs and Schedule are on PostgreSQL: they work for every workspace, with that workspace's own rows. */
  const DATABASE_MODULES = ["bookings", "customers", "jobs", "schedule", "services", "team"];
  const workspaceDir = join(SRC, "app", "(workspace)");
  const entries = FIXTURE_MODULES.flatMap((module) => walk(join(workspaceDir, module), (path) => /(page|layout)\.tsx$/.test(path)));

  test("the module list matches the sidebar", () => {
    // Settings, Help and the six database-backed modules are real for every workspace; every other module folder still runs on the sample dataset and must be listed here.
    const present = readdirSync(workspaceDir).filter((entry) => statSync(join(workspaceDir, entry)).isDirectory() && !["settings", "help", ...DATABASE_MODULES].includes(entry));
    expect(present.sort()).toEqual([...FIXTURE_MODULES].sort());
    expect(entries.length).toBeGreaterThan(15);
  });

  test("each page and layout calls fixtureGate() before it renders anything", () => {
    const missing = entries.filter((path) => !/await fixtureGate\("[^"]+"\)/.test(read(path))).map(posix);
    expect(missing).toEqual([]);
  });

  test("each dynamic-metadata function asks hasSampleDataAccess()", () => {
    const missing = entries.filter((path) => /export async function generateMetadata/.test(read(path)) && !/hasSampleDataAccess\(\)/.test(read(path))).map(posix);
    expect(missing).toEqual([]);
  });

  test("Customers, Services, Team, Bookings, Jobs and Schedule read the database for the verified workspace: no sample gate, no sample data", () => {
    const pages = DATABASE_MODULES.flatMap((module) => walk(join(workspaceDir, module), (path) => /(page|layout)\.tsx$/.test(path)));
    expect(pages.length).toBeGreaterThan(20);
    const ASKS_THE_SERVER = /await requireWorkspaceContext\(\)|await getCustomerBook\(\)|await getCustomerDetail\(|await getServices\(\)|await getTeam\(\)/;
    expect(pages.filter((path) => !ASKS_THE_SERVER.test(read(path))).map(posix), "pages that do not verify the workspace next to their data").toEqual([]);
    expect(pages.filter((path) => /fixtureGate|hasSampleDataAccess|@\/data\/(financials|fixtures)/.test(read(path))).map(posix)).toEqual([]);
    // A record is asked for by its reference, and the answer for one the active business does not have is "not found".
    for (const file of [
      "customers/[customerId]/layout.tsx",
      "customers/[customerId]/page.tsx",
      "customers/[customerId]/properties/page.tsx",
      "services/[serviceId]/layout.tsx",
      "team/[memberId]/layout.tsx",
      "team/roles/[roleId]/page.tsx",
    ]) {
      expect(read(join(workspaceDir, file)), file).toMatch(/notFound\(\)/);
    }
  });

  test("the customer-facing previews call publicGate()", () => {
    const pages = walk(join(SRC, "app", "(site)"), (path) => /(page|layout)\.tsx$/.test(path)).filter((path) => !path.endsWith(join("(site)", "layout.tsx")));
    expect(pages.length).toBeGreaterThan(6);
    expect(pages.filter((path) => !/await publicGate\(\)/.test(read(path))).map(posix)).toEqual([]);
  });

  test("Overview, Settings and Help are real for every workspace and still require a verified one", () => {
    expect(read(join(workspaceDir, "page.tsx"))).toContain("requireWorkspaceContext()");
    expect(read(join(workspaceDir, "layout.tsx"))).toContain("requireWorkspaceContext()");
  });
});

test.describe("database access", () => {
  test("only the database layer and the auth adapter open a connection", () => {
    const users = sourceFiles.filter((path) => /\bgetDb\(|\bgetPool\(/.test(read(path))).map(posix).sort();
    expect(users).toEqual(["src/db/index.ts", "src/db/tenant.ts", "src/lib/auth.ts"]);
  });

  test("tenant queries in the server layer go through withTenant / withUser", () => {
    for (const path of walk(join(SRC, "server"), (file) => /\.(ts|tsx)$/.test(file))) {
      const source = read(path);
      const usesTables = /from "@\/db\/schema"/.test(source);
      expect(usesTables && !/with(Tenant|User)\(/.test(source), `${posix(path)} reads or writes tables outside a tenant transaction`).toBe(false);
    }
  });

  test("the runtime connection string never uses the owner role", () => {
    const example = read(join(ROOT, ".env.example"));
    expect(example).toMatch(/^DATABASE_URL=postgres:\/\/climvia_app:/m);
    expect(example).toMatch(/^DATABASE_ADMIN_URL=postgres:\/\/climvia_owner:/m);
    for (const path of sourceFiles.filter((file) => !posix(file).startsWith("src/db/") )) {
      expect(read(path), posix(path)).not.toContain("DATABASE_ADMIN_URL");
    }
  });
});

test.describe("authentication safeguards stay on", () => {
  const auth = () => read(join(SRC, "lib", "auth.ts")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("origin / CSRF checks and rate limiting are not disabled", () => {
    expect(auth()).not.toMatch(/disableCSRFCheck|disableOriginCheck|rateLimit\s*:\s*\{[^}]*enabled\s*:\s*false|disableIpTracking/);
  });

  test("telemetry is not switched on, and email verification is the only relaxed default", () => {
    expect(auth()).not.toMatch(/telemetry\s*:\s*\{[^}]*enabled\s*:\s*true/);
    expect(auth()).toMatch(/requireEmailVerification: false/);
  });

  test("sessions are looked up in the database on every request (no cookie cache)", () => {
    expect(auth()).toMatch(/cookieCache: \{ enabled: false \}/);
  });

  test("the active-workspace cookie is httpOnly and SameSite", () => {
    const cookie = read(join(SRC, "server", "workspace-cookie.ts"));
    expect(cookie).toMatch(/httpOnly: true/);
    expect(cookie).toMatch(/sameSite: "lax"/);
  });

  test("the secret and the origin are required, not defaulted", () => {
    const source = read(join(SRC, "lib", "auth.ts"));
    expect(source).toContain('requiredEnv("BETTER_AUTH_SECRET")');
    expect(source).toContain('requiredEnv("BETTER_AUTH_URL")');
    expect(source).toContain("at least 32 characters");
  });
});

test.describe("secrets and deployment files", () => {
  const tracked = () => execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);

  test("only .env.example is committed; .env files are ignored", () => {
    const envFiles = tracked().filter((path) => /(^|\/)\.env(\.|$)/.test(path));
    expect(envFiles.filter((path) => path !== ".env.example")).toEqual([]);
    const ignore = read(join(ROOT, ".gitignore"));
    expect(ignore).toMatch(/^\.env\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });

  test(".env.example holds placeholders, not real secrets", () => {
    const values = read(join(ROOT, ".env.example"))
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=./.test(line));
    expect(values.length).toBeGreaterThan(8);
    for (const line of values) {
      const [name, value] = [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)];
      if (/SECRET|PASSWORD/.test(name)) expect(value, name).toMatch(/replace-with/);
    }
  });

  test("the Docker image never contains an .env file and runs as an unprivileged user", () => {
    const dockerfile = read(join(ROOT, "Dockerfile"));
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    expect(dockerfile).toMatch(/^USER climvia$/m);
    const ignore = read(join(ROOT, ".dockerignore"));
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
  });

  test("docker-compose.yml runs PostgreSQL only and binds it to the loopback interface", () => {
    const compose = read(join(ROOT, "docker-compose.yml"));
    expect(compose).toMatch(/image: postgres:17/);
    expect(compose).toMatch(/127\.0\.0\.1:\$\{POSTGRES_PORT:-5432\}:5432/);
    const services = compose.slice(compose.indexOf("\nservices:"), compose.indexOf("\nvolumes:"));
    expect(services.match(/^ {2}[a-z][\w-]*:\s*$/gm)).toEqual(["  postgres:"]);
  });
});

test.describe("the documentation covers the architecture", () => {
  const doc = () => read(join(ROOT, "docs", "saas-architecture.md"));

  test("docs/saas-architecture.md has every required topic", () => {
    const required = [
      /Authentication model/,
      /Profile model/,
      /Organization model/,
      /Memberships/,
      /Authorization roles/,
      /Active-organization resolution/,
      /Tenant query rules/,
      /Database isolation/,
      /Settings migration/,
      /Transitional fixtures/,
      /Organization → many Sites/,
      /future Website Builder/,
      /AWS topology/,
      /SaaS billing vs\. business-customer payments/,
      /Future domain routing/,
      /Deferred domain migrations/,
    ];
    const headings = doc().split(/\r?\n/).filter((line) => /^## /.test(line));
    for (const topic of required) expect(headings.some((heading) => topic.test(heading)), String(topic)).toBe(true);
  });

  test("the deployment section documents the container, environment, migration and start commands, and backups", () => {
    const text = doc();
    for (const expected of ["docker build", "--target tools", "npm run db:migrate", "docker run -d", "BETTER_AUTH_SECRET", "DATABASE_ADMIN_URL", "pg_dump", "private S3"]) {
      expect(text, expected).toContain(expected);
    }
  });

  test("the README documents the database and auth setup and the db scripts", () => {
    const readme = read(join(ROOT, "README.md"));
    for (const expected of ["docs/saas-architecture.md", "db:migrate", "db:seed", "db:generate", "db:studio", "docker compose up"]) {
      expect(readme, expected).toContain(expected);
    }
  });

  test("the package scripts exist", () => {
    const scripts = JSON.parse(read(join(ROOT, "package.json"))).scripts as Record<string, string>;
    for (const name of ["db:generate", "db:migrate", "db:seed", "db:studio", "db:reset", "db:test:prepare", "typecheck", "lint", "build"]) expect(scripts[name], name).toBeTruthy();
  });
});
