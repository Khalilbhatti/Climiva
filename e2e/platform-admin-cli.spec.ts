/**
 * Phase 19A, how platform authority is given and taken away: the command-line tools, run as an operator would run them (a real process, the
 * database owner's connection), and the proof that nothing else can do it: not the public signup, not a forged field, not a migration or a seed.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { anonymous, makeBusiness } from "./assets-helpers";
import { makeAccount, runTool } from "./platform-admin-helpers";

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

// The tools open a process each (npx tsx), which is slow on this machine: the specs in this file share the work.
test.describe.configure({ timeout: 180_000 });

const activeRows = async (userId: string) => (await owner.pool.query("select * from platform_admins where user_id = $1 and revoked_at is null", [userId])).rows;
const auditFor = async (userId: string) => (await owner.pool.query("select action, actor_kind, actor_user_id, actor_label, target_kind, metadata from platform_audit_events where target_id = $1 order by occurred_at, id", [userId])).rows;

test.describe("platform-admin:grant", () => {
  test("refuses an address that has no account, creates nothing, and records nothing", async () => {
    const unknown = `nobody-${randomBytes(4).toString("hex")}@example.test`;
    const result = runTool("grant", ["--email", unknown]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No account has that email address");
    expect(result.stdout).not.toContain("Granted");
    // (Other tests make people at the same time, so the checks are about this address, not about totals.)
    expect((await owner.pool.query("select count(*)::int as n from auth_user where lower(email) = $1", [unknown])).rows[0].n).toBe(0);
    expect((await owner.pool.query("select count(*)::int as n from platform_admins a join auth_user u on u.id = a.user_id where lower(u.email) = $1", [unknown])).rows[0].n).toBe(0);
    expect((await owner.pool.query("select count(*)::int as n from platform_audit_events where metadata->>'email' = $1", [unknown])).rows[0].n).toBe(0);
  });

  test("grants an existing person once, records who and how, and is safe to run again", async () => {
    const person = await makeAccount("p19cli", owner.db);
    const first = runTool("grant", ["--email", person.email]);
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain("Granted");

    const rows = await activeRows(person.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "super_admin", granted_via: "cli", revoked_at: null });
    expect(rows[0].granted_by).toMatch(/^cli:[A-Za-z0-9._@-]+$/);

    const second = runTool("grant", ["--email", person.email]);
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toContain("already");
    expect(second.stdout).toContain("Nothing changed");
    expect(await activeRows(person.userId)).toHaveLength(1);

    // One entry in the audit trail, for the one change; it names the operator and the person, and carries no secret.
    const trail = await auditFor(person.userId);
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ action: "platform_admin.granted", actor_kind: "cli", actor_user_id: null, target_kind: "user", metadata: { email: person.email, role: "super_admin" } });
    expect(trail[0].actor_label).toBe(rows[0].granted_by);
    expect(JSON.stringify(trail)).not.toContain(person.password);
    // Neither run printed a password, a hash or a token.
    const hash = (await owner.pool.query("select password from auth_account where user_id = $1 and password is not null", [person.userId])).rows[0].password as string;
    for (const output of [first.stdout, first.stderr, second.stdout, second.stderr]) {
      expect(output).not.toContain(hash);
      expect(output).not.toContain(person.password);
    }
  });

  test("matches the address exactly after trimming and lower-casing, in either argument form", async () => {
    const person = await makeAccount("p19case", owner.db);
    const shouted = `  ${person.email.toUpperCase()}  `;
    const result = runTool("grant", [`--email=${shouted.trim().toUpperCase()}`]);
    expect(result.code, result.stderr).toBe(0);
    expect(await activeRows(person.userId)).toHaveLength(1);
    // The audit record holds the normalized address.
    expect((await auditFor(person.userId))[0].metadata).toMatchObject({ email: person.email });
  });

  test("does not match a similar address: another tag, a longer name, a longer domain, a wildcard, a quoted fragment", async () => {
    const person = await makeAccount("p19exact", owner.db);
    const [local, domain] = person.email.split("@");
    for (const attempt of [`${local}+tag@${domain}`, `x${local}@${domain}`, `${local}@${domain}.evil`, `${local}@x${domain}`, "%@example.test", `${local.slice(0, 6)}%@${domain}`, `${local.slice(0, 6)}_@${domain}`, `'--@${domain}`, `a'or'1'='1@${domain}`]) {
      const result = runTool("grant", ["--email", attempt]);
      expect(result.code, `${attempt}: ${result.stdout} ${result.stderr}`).toBe(1);
    }
    expect(await activeRows(person.userId)).toEqual([]);
    expect((await owner.pool.query("select count(*)::int as n from auth_user")).rows[0].n).toBeGreaterThan(0);
  });

  test("refuses arguments it does not understand, and does nothing", async () => {
    const person = await makeAccount("p19args", owner.db);
    for (const args of [[], ["--email"], ["--email", "not-an-email"], ["--email", ""], ["--emial", person.email], [person.email], ["--email", person.email, "--role", "owner"], ["--email", person.email, "--force"], ["--email", `${"a".repeat(260)}@example.test`], ["--email", "two words@example.test"]]) {
      const result = runTool("grant", args);
      expect(result.code, JSON.stringify(args)).toBe(1);
      expect(result.stderr, JSON.stringify(args)).toMatch(/Usage|not an email|Unknown argument|Missing/);
    }
    // Even the runs that named this person (a typo in the flag, an extra flag) granted nothing.
    expect(await activeRows(person.userId)).toEqual([]);
    expect(await auditFor(person.userId)).toEqual([]);
  });

  test("a failed run leaves no grant without its audit entry, and the tool says what went wrong without a stack or a connection string", async () => {
    const person = await makeAccount("p19fail", owner.db);
    const result = runTool("grant", ["--email", person.email], { DATABASE_ADMIN_URL: "postgres://nobody:wrongpassword@127.0.0.1:1/none", DB_WAIT_SECONDS: "1" });
    expect(result.code).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain("wrongpassword");
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/postgres:\/\//);
    expect(await activeRows(person.userId)).toEqual([]);
  });
});

test.describe("platform-admin:revoke", () => {
  test("ends the authority, keeps the account, its businesses and the history, and says so once", async () => {
    const business = await makeBusiness("p19rev", owner.db);
    const person = business.owner;
    expect(runTool("grant", ["--email", person.email]).code).toBe(0);
    const revoke = runTool("revoke", ["--email", person.email]);
    expect(revoke.code, revoke.stderr).toBe(0);
    expect(revoke.stdout).toContain("Revoked");

    expect(await activeRows(person.userId)).toEqual([]);
    // The row stays, marked: history is not erased.
    const history = (await owner.pool.query("select revoked_at, revoked_by from platform_admins where user_id = $1", [person.userId])).rows;
    expect(history).toHaveLength(1);
    expect(history[0].revoked_at).not.toBeNull();
    expect(history[0].revoked_by).toMatch(/^cli:/);
    // The person and their business are exactly as they were.
    expect((await owner.pool.query("select count(*)::int as n from auth_user where id = $1", [person.userId])).rows[0].n).toBe(1);
    expect((await owner.pool.query("select role, status from organization_memberships where user_id = $1 and organization_id = $2", [person.userId, business.organizationId])).rows).toEqual([{ role: "owner", status: "active" }]);
    expect((await owner.pool.query("select count(*)::int as n from auth_account where user_id = $1", [person.userId])).rows[0].n).toBeGreaterThan(0);
    expect((await auditFor(person.userId)).map((event) => event.action)).toEqual(["platform_admin.granted", "platform_admin.revoked"]);

    // Again: nothing changes and nothing more is recorded.
    const again = runTool("revoke", ["--email", person.email]);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toContain("not a platform administrator");
    expect((await auditFor(person.userId))).toHaveLength(2);
  });

  test("can be granted again afterwards, as a new assignment", async () => {
    const person = await makeAccount("p19regrant", owner.db);
    for (const step of ["grant", "revoke", "grant"] as const) expect(runTool(step, ["--email", person.email]).code, step).toBe(0);
    expect(await activeRows(person.userId)).toHaveLength(1);
    expect((await owner.pool.query("select count(*)::int as n from platform_admins where user_id = $1", [person.userId])).rows[0].n).toBe(2);
    expect((await auditFor(person.userId)).map((event) => event.action)).toEqual(["platform_admin.granted", "platform_admin.revoked", "platform_admin.granted"]);
  });

  test("refuses an unknown address and a person who was never an administrator changes nothing", async () => {
    const unknown = runTool("revoke", ["--email", `nobody-${randomBytes(4).toString("hex")}@example.test`]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("No account");
    const plain = await makeAccount("p19never", owner.db);
    const result = runTool("revoke", ["--email", plain.email]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Nothing changed");
    expect(await auditFor(plain.userId)).toEqual([]);
    expect(runTool("revoke", []).code).toBe(1);
  });
});

test.describe("platform-admin:list", () => {
  test("names the current administrators and nobody who was revoked, and prints no secret", async () => {
    const kept = await makeAccount("p19listkept", owner.db);
    const dropped = await makeAccount("p19listdropped", owner.db);
    for (const person of [kept, dropped]) expect(runTool("grant", ["--email", person.email]).code).toBe(0);
    expect(runTool("revoke", ["--email", dropped.email]).code).toBe(0);
    const listed = runTool("list", []);
    expect(listed.code, listed.stderr).toBe(0);
    expect(listed.stdout).toContain(kept.email);
    expect(listed.stdout).not.toContain(dropped.email);
    const secrets = await owner.pool.query<{ secret: string }>("select password as secret from auth_account where password is not null union all select token from auth_session");
    for (const row of secrets.rows) expect(listed.stdout).not.toContain(row.secret);
  });
});

test.describe("nothing else can make a platform administrator", () => {
  test("a public signup is an ordinary account, whatever the request claims", async () => {
    const claims = { role: "super_admin", platformRole: "super_admin", isPlatformAdmin: true, platform_admin: true, superAdmin: true, admin: true, platformAdmin: { role: "super_admin" } };
    for (const [index, extra] of [{}, claims, { role: "owner" }].entries()) {
      const email = `p19signup${index}-${randomBytes(4).toString("hex")}@example.test`;
      const api = await anonymous(`fd00:${randomBytes(2).toString("hex")}:${index + 1}::1`);
      try {
        const response = await api.post("/api/auth/sign-up/email", { data: { email, password: "Correct-horse-9-battery", name: "Signup Probe", ...extra } });
        expect(response.status(), await response.text()).toBeLessThan(500);
        const created = await owner.pool.query("select id from auth_user where lower(email) = $1", [email]);
        if (created.rowCount === 1) {
          expect((await owner.pool.query("select count(*)::int as n from platform_admins where user_id = $1", [created.rows[0].id])).rows[0].n, JSON.stringify(extra)).toBe(0);
          // And the console does not open for them.
          const opened = await api.get("/platform-admin", { maxRedirects: 0 });
          expect([307, 404], `status ${opened.status()}`).toContain(opened.status());
          if (opened.status() === 307) expect(opened.headers().location).toContain("/platform-admin/login");
        }
      } finally {
        await api.dispose();
      }
    }
  });

  test("no migration, seed, schema, query or page writes the assignments: the tool is the only writer", async () => {
    const roots = ["drizzle", "scripts", "src"];
    const offenders: string[] = [];
    const walk = (directory: string): string[] =>
      readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) return entry === "meta" || entry === "node_modules" ? [] : walk(path);
        return /\.(ts|tsx|sql)$/.test(entry) ? [path] : [];
      });
    for (const root of roots) {
      for (const file of walk(root)) {
        const name = relative(process.cwd(), file).split("\\").join("/");
        if (name === "scripts/platform-admin/grant.ts" || name === "scripts/platform-admin/revoke.ts") continue;
        const text = readFileSync(file, "utf8");
        // Writing the table: SQL, or the query builder.
        if (/insert\s+into\s+(public\.)?"?platform_admins"?/i.test(text)) offenders.push(`${name}: inserts`);
        if (/update\s+(public\.)?"?platform_admins"?\s+set/i.test(text)) offenders.push(`${name}: updates`);
        if (/delete\s+from\s+(public\.)?"?platform_admins"?/i.test(text)) offenders.push(`${name}: deletes`);
        if (/\.(insert|update|delete)\(\s*platformAdmins\s*\)/.test(text)) offenders.push(`${name}: builder write`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no real person's address is written into the tools, the migrations or the schema", async () => {
    const files = ["scripts/platform-admin/lib.ts", "scripts/platform-admin/grant.ts", "scripts/platform-admin/revoke.ts", "scripts/platform-admin/list.ts", "drizzle/0022_platform_admin.sql", "drizzle/0023_platform_admin_rls.sql", "src/db/schema/platform.ts", "src/db/platform-queries.ts", "src/server/platform-admin.ts", "src/server/actions/platform-admin.ts"];
    for (const file of files) {
      const addresses = readFileSync(file, "utf8").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g) ?? [];
      expect(addresses.filter((address) => !/@(example\.(com|org|test)|domain\.test)$/i.test(address)), file).toEqual([]);
    }
  });
});
