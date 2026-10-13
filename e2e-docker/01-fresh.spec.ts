/**
 * Docker side, part 1: the production-shaped stack as it is the first time it starts, on an EMPTY database. Real containers, real requests through
 * the proxy; nothing here reads the source to learn what the stack does.
 *
 *   - it answers, through the proxy, over https, as ready, with the version it was built from;
 *   - the database holds the schema and the product's four Website Templates and NOT ONE business: no Apex, no Northstar, no sample data, no user;
 *   - the application connects as the restricted role, which Row Level Security binds, and the owner's credential is not in its environment;
 *   - only the proxy is reachable from outside, the database is reachable only from the application, and the application can not read or write the
 *     image it runs from;
 *   - the sample-data command does not exist in the images, and what the migration does and does not do is as documented.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";
import { compose, composeResult, docker, get, one, sql, stack } from "./stack";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] };

test.describe("the stack, started for the first time", () => {
  test("the application is ready through the proxy, over https, and says which build it is", async () => {
    const live = await get(stack.publicHost, "/health/live");
    expect(live.status).toBe(200);
    expect(JSON.parse(live.body)).toMatchObject({ status: "ok", version: expect.stringMatching(/^[A-Za-z0-9._-]+$/) });
    const ready = await get(stack.publicHost, "/health/ready");
    expect(ready.status).toBe(200);
    expect(JSON.parse(ready.body)).toMatchObject({ status: "ready", checks: { config: "ok", database: "ok", storage: "ok" } });
    expect(ready.headers["strict-transport-security"]).toContain("max-age=");
    expect(ready.headers["server"]).toBeUndefined();
    expect(ready.headers["x-powered-by"]).toBeUndefined();
  });

  test("plain http is sent to https, and the proxy is the only listener", async () => {
    const response = await fetch(`http://127.0.0.1:${stack.httpPort}/login`, { redirect: "manual", headers: { host: stack.publicHost } });
    expect([301, 308]).toContain(response.status);
    expect(response.headers.get("location")).toMatch(/^https:\/\//);
    const services = JSON.parse(`[${compose("ps", "--format", "json").trim().split(/\r?\n/).filter(Boolean).join(",")}]`) as { Service: string; Publishers?: { PublishedPort: number }[] }[];
    for (const service of services) {
      const published = (service.Publishers ?? []).filter((port) => port.PublishedPort > 0);
      if (service.Service === "proxy") expect(published.map((port) => port.PublishedPort).sort()).toEqual([stack.httpPort, stack.httpPort, stack.httpsPort, stack.httpsPort].sort());
      else expect(published, `${service.Service} publishes a port`).toEqual([]);
    }
    // Nothing answers on the application's own port from this machine, nor on PostgreSQL's from the stack.
    await expect(fetch("http://127.0.0.1:3000/health/live", { signal: AbortSignal.timeout(3000) })).rejects.toThrow();
  });

  test("the database holds the schema and the product's Templates, and not one business, user or sample record", async () => {
    expect(Number(one("select count(*) from drizzle.__drizzle_migrations"))).toBe(journal.entries.length);
    expect(Number(one("select count(*) from site_templates"))).toBe(4);
    const empty = ["organizations", "auth_user", "auth_session", "customers", "bookings", "jobs", "quotes", "invoices", "payments", "sites", "site_versions", "site_domains", "assets", "organization_branding", "services", "team_members", "organization_memberships"];
    for (const table of empty) expect(Number(one(`select count(*) from ${table}`)), table).toBe(0);
    expect(one("select count(*) from organizations where name ilike '%apex%' or name ilike '%northstar%' or slug in ('apex-climate-heating-air', 'northstar-heating-cooling')")).toBe("0");
    // Every table in the public schema, so a module added later can not hide a sample row from this check.
    const populated = sql("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")
      .map(([name]) => name)
      .filter((name) => name !== "site_templates")
      .filter((name) => Number(one(`select count(*) from "${name}"`)) > 0);
    expect(populated, "tables that hold rows on a database nobody has used").toEqual([]);
  });

  test("the application's role is the restricted one, and Row Level Security binds it", async () => {
    const [row] = sql("select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'climvia_app'");
    expect(row).toEqual(["f", "f", "f", "f"]);
    expect(Number(one("select count(*) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relrowsecurity"))).toBeGreaterThan(40);
    // The role the app uses owns nothing in the schema, which is what makes the policies apply to it.
    expect(one("select count(*) from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'climvia_app' and c.relnamespace = 'public'::regnamespace")).toBe("0");
    // Asked as the application would: with no tenant context it sees no row of a business's table.
    const asApp = compose("exec", "-T", "app", "node", "-e", `const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,max:1});p.query('select current_user as u, (select count(*) from organizations) as o').then(r=>{console.log(JSON.stringify(r.rows[0]));return p.end()}).catch(e=>{console.log('ERR '+e.code);process.exit(1)})`);
    expect(JSON.parse(asApp.trim())).toEqual({ u: "climvia_app", o: "0" });
  });

  test("the application runs as an unprivileged user from a read-only image with no capabilities, and holds no owner or AWS credential", async () => {
    expect(compose("exec", "-T", "app", "id", "-u").trim()).toBe("10001");
    const write = composeResult("exec", "-T", "app", "touch", "/app/should-not-exist");
    expect(write.code).not.toBe(0);
    expect(write.out).toMatch(/Read-only file system/i);
    expect(compose("exec", "-T", "app", "cat", "/proc/1/status")).toMatch(/CapEff:\s+0{16}/);
    expect(composeResult("exec", "-T", "app", "test", "-w", "/data/assets").code).toBe(0);
    const names = compose("exec", "-T", "app", "env").split(/\r?\n/).map((line) => line.split("=")[0]);
    for (const forbidden of ["DATABASE_ADMIN_URL", "POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "DOMAIN_DNS_RESOLVER", "SEED_PASSWORD"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
    expect(compose("exec", "-T", "app", "printenv", "CLIMVIA_ENV").trim()).toBe("production");
  });

  test("the networks separate the layers: the proxy can not name the database, the database has no way out, the application reaches both", async () => {
    expect(composeResult("exec", "-T", "proxy", "nslookup", "db").out).toMatch(/can't find|NXDOMAIN|no answer/i);
    expect(composeResult("exec", "-T", "proxy", "nc", "-z", "-w", "2", "app", "3000").code).toBe(0);
    expect(composeResult("exec", "-T", "app", "node", "-e", "require('net').connect(5432,'db').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))").code).toBe(0);
    expect(composeResult("exec", "-T", "db", "wget", "-q", "-T", "3", "-O", "/dev/null", "http://1.1.1.1").code).not.toBe(0);
  });

  test("the sample-data command is not in the images, and running it creates nothing", async () => {
    const tools = `climvia-tools:${stack.env.APP_VERSION ?? process.env.APP_VERSION}`;
    const listing = docker("run", "--rm", "--entrypoint", "ls", tools, "scripts/db");
    expect(listing.out).toContain("migrate.ts");
    expect(listing.out).not.toMatch(/seed/);
    const seed = composeResult("run", "--rm", "--no-deps", "migrate", "npm", "run", "db:seed");
    expect(seed.code).not.toBe(0);
    expect(Number(one("select count(*) from organizations"))).toBe(0);
    // Nothing the stack starts runs a seed: not the migration's command, not the app's.
    const config = compose("config", "--format", "json");
    expect(config).not.toMatch(/db:seed|seed\.ts|prepare-test|ALLOW_SEED/);
  });

  test("running the migration again changes nothing: it is safe on every deploy", async () => {
    const before = one("select md5(string_agg(created_at::text || hash, ',' order by created_at)) from drizzle.__drizzle_migrations");
    const again = composeResult("run", "--rm", "migrate");
    expect(again.code).toBe(0);
    expect(again.out).toContain("is up to date");
    expect(one("select md5(string_agg(created_at::text || hash, ',' order by created_at)) from drizzle.__drizzle_migrations")).toBe(before);
    const status = composeResult("run", "--rm", "migrate", "npm", "run", "--silent", "db:status");
    expect(status.code).toBe(0);
    expect(JSON.parse(status.out.split(/\r?\n/).filter((line) => line.startsWith("{")).pop() ?? "{}")).toMatchObject({ current: true, expected: journal.entries.length, applied: journal.entries.length });
  });
});
