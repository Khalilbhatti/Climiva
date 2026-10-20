/**
 * Docker side, part 9 (it runs last, so it protects everything the other parts made): what happens to a running business when the stack is restarted,
 * recreated, rebuilt, starved of its database or given a bad configuration. Everything is done to the REAL containers; "survives" means the same rows
 * in EVERY table (a digest of the whole database, the Phase 19 Marketplace, review, moderation and platform tables included), the same files and the
 * same certificate afterwards.
 *
 *   restart the app / the database / the proxy · stop the database and bring it back · take the whole stack down and up (no volume removed) ·
 *   rebuild the image and recreate the app · stop the app gracefully · refuse to start on a bad configuration · refuse to be ready without its file
 *   volume · stop a deployment whose migration fails before the app is touched · reject a bad env file before anything is built.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { PASSWORD } from "../e2e/saas";
import { compose, composeResult, docker, get, handshake, multipart, one, sql, until, stack } from "./stack";

test.describe.configure({ mode: "serial", timeout: 300_000 });

// What 02 and 03 left behind. Read when the file starts running, not when it is loaded: on a new stack the files do not exist until they have run.
let state: { email: string; business: string; slug: string };
let logo: { id: string; sha: string };
let domain: { active: string; certificate: string };
test.beforeAll(() => {
  state = JSON.parse(readFileSync(".data/docker-state.json", "utf8"));
  logo = JSON.parse(readFileSync(".data/docker-logo.json", "utf8"));
  domain = JSON.parse(readFileSync(".data/docker-domain.json", "utf8"));
});

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const ready = async () => (await get(stack.publicHost, "/health/ready")).status === 200;
const waitReady = (seconds = 120) => until(ready, seconds, "the application to be ready");
const version = async () => (JSON.parse((await get(stack.publicHost, "/health/live")).body) as { version: string }).version;

/**
 * A digest of every table's rows, in one question to the database: the tables that change only because somebody signed in (sessions, one-time codes) are
 * the only ones left out. Asking it twice with nothing happening in between gives the same answer, so a difference is a change in what is stored.
 */
const DATABASE_DIGEST = `
  select md5(string_agg(t.table_name || ':' || (xpath('/row/c/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, E''\n'' order by x::text), '''')) as c from public.%I x', t.table_name), false, true, '')))[1]::text, ',' order by t.table_name)),
         count(*)
    from information_schema.tables t
   where t.table_schema = 'public' and t.table_type = 'BASE TABLE' and t.table_name not in ('auth_session', 'auth_verification')`;

/** Everything a restart must not change. */
async function snapshot() {
  const site = await get(domain.active, "/");
  const asset = await get(stack.publicHost, `/assets/${logo.id}`);
  const shake = await handshake(domain.active);
  return {
    database: sql(DATABASE_DIGEST)[0].join(" tables "),
    organizations: one("select count(*) from organizations"),
    users: one("select count(*) from auth_user"),
    bookings: one("select count(*) from bookings"),
    services: one("select count(*) from services"),
    domains: one("select string_agg(hostname || ':' || status, ',' order by hostname) from site_domains"),
    assets: one("select string_agg(id::text || ':' || status || ':' || byte_size, ',' order by id) from assets"),
    siteShowsBusiness: site.status === 200 && site.body.includes(state.business.replace("&", "&amp;")),
    logoSha: asset.status === 200 ? sha(asset.bytes) : `status ${asset.status}`,
    certificate: shake.ok ? shake.fingerprint : `no handshake: ${shake.error}`,
  };
}

/**
 * Can the person sign in? Sign-in is rate limited per client address (3 per 10 seconds; every request here comes from the proxy's view of this one
 * machine), so a 429 means "wait for the window", not "the account is broken": the limit working through the proxy is the point of AUTH_TRUSTED_PROXIES.
 */
async function signsIn(): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await get(stack.publicHost, "/api/auth/sign-in/email", { method: "POST", headers: { origin: stack.origin, "content-type": "application/json" }, body: JSON.stringify({ email: state.email, password: PASSWORD }) });
    if (response.status === 200) return true;
    if (response.status !== 429) return false;
    await new Promise((wait) => setTimeout(wait, 6000));
  }
  return false;
}

let before: Awaited<ReturnType<typeof snapshot>>;

test("the state to protect: a business with three logos, a published Site on a customer's name with a certificate, a listed Marketplace profile with its bookings and reviews, and the platform's trail", async () => {
  await waitReady(30);
  before = await snapshot();
  // Whatever the earlier parts made is here, and the digest says how much of it: every table of the schema, Phase 19's included.
  expect(before.database).toMatch(/^[0-9a-f]{32} tables [5-9]\d$/);
  expect(Number(before.organizations)).toBeGreaterThanOrEqual(1);
  expect(Number(before.users)).toBeGreaterThanOrEqual(1);
  expect(Number(before.bookings)).toBeGreaterThanOrEqual(1);
  for (const table of ["marketplace_listings", "marketplace_service_areas", "reviews", "review_requests", "platform_audit_events", "platform_admins", "platform_listing_moderation", "platform_review_moderation"]) {
    expect(Number(one(`select count(*) from ${table}`)), table).toBeGreaterThan(0);
  }
  expect(before.siteShowsBusiness).toBe(true);
  expect(before.logoSha).toBe(logo.sha);
  expect(before.certificate).toBe(domain.certificate);
  expect(await signsIn()).toBe(true);
});

test("the application container is restarted: the same rows, files and certificate, and the person can sign in", async () => {
  compose("restart", "app");
  await waitReady();
  expect(await snapshot()).toEqual(before);
  expect(await signsIn()).toBe(true);
});

test("the database container is restarted: the application finds it again by itself, with everything in it", async () => {
  compose("restart", "db");
  await waitReady(150);
  expect(await snapshot()).toEqual(before);
  expect(await signsIn()).toBe(true);
});

test("with the database stopped the application stays up and says it is not ready; it recovers when the database returns, without a restart", async () => {
  const container = compose("ps", "-q", "app").trim();
  const restarts = () => docker("inspect", "--format", "{{.RestartCount}} {{.State.StartedAt}}", container).out.trim();
  const started = restarts();
  compose("stop", "db");
  await until(async () => (await get(stack.publicHost, "/health/ready")).status === 503, 60, "readiness to fail");
  const down = await get(stack.publicHost, "/health/ready");
  expect(JSON.parse(down.body)).toEqual({ status: "unavailable", version: await version(), checks: { config: "ok", database: "fail", storage: "ok" } });
  expect(down.body).not.toMatch(/ECONNREFUSED|ENOTFOUND|postgres|climvia_app|password|db:5432/i);
  // Liveness does not ask the database, so the container is not killed for a problem it can not fix.
  expect((await get(stack.publicHost, "/health/live")).status).toBe(200);
  // A page that needs the database fails cleanly: no data, no stack trace.
  const page = await get(domain.active, "/");
  expect(page.status).not.toBe(200);
  expect(page.body).not.toMatch(/ECONNREFUSED|at \w+ \(|node_modules|postgres:\/\//);

  compose("start", "db");
  await waitReady(120);
  expect(restarts(), "the application container was not restarted").toBe(started);
  expect(await snapshot()).toEqual(before);
});

test("the proxy is restarted: it serves again at once with the SAME certificate (its state is on a volume)", async () => {
  compose("restart", "proxy");
  await until(async () => (await get(stack.publicHost, "/health/ready")).status === 200, 60, "the proxy to serve");
  const after = await snapshot();
  expect(after.certificate).toBe(before.certificate);
  expect(after).toEqual(before);
});

test("the whole stack goes down and comes up (no volume removed): nothing is lost", async () => {
  compose("down");
  const volumes = docker("volume", "ls", "--format", "{{.Name}}").out.split(/\r?\n/);
  for (const name of ["pgdata", "assets", "caddy-data"]) expect(volumes, name).toContain(`${stack.project}_${name}`);
  compose("up", "-d", "--wait");
  await waitReady();
  expect(await snapshot()).toEqual(before);
  expect(await signsIn()).toBe(true);
});

test("the image is rebuilt and the app container recreated: a new build, the same data", async () => {
  const original = process.env.APP_VERSION;
  const rebuilt = `rebuilt-${randomBytes(2).toString("hex")}`;
  expect(await version()).toBe(original);
  process.env.APP_VERSION = rebuilt;
  try {
    compose("up", "-d", "--build", "--wait", "app");
    await waitReady();
    expect(await version()).toBe(rebuilt);
    expect(await snapshot()).toEqual(before);
    expect(await signsIn()).toBe(true);
    const labels = docker("image", "inspect", `climvia-web:${rebuilt}`, "--format", "{{index .Config.Labels \"org.opencontainers.image.revision\"}}");
    expect(labels.out.trim()).toBe(rebuilt);
  } finally {
    process.env.APP_VERSION = original;
  }
  // Back to the original tag, rebuilt from the working tree (the tag may have been built from an older tree).
  compose("up", "-d", "--build", "--wait", "app");
  await waitReady();
  expect(await version()).toBe(original);
  expect(await snapshot()).toEqual(before);
});

test("stopping the app is graceful: a request in progress is finished, the process exits on its own with success inside the grace period, and is never killed", async () => {
  // A person who is signed in, uploading something slowly: the first part of the body now, the rest after the stop has been asked for.
  const signIn = await get(stack.publicHost, "/api/auth/sign-in/email", { method: "POST", headers: { origin: stack.origin, "content-type": "application/json" }, body: JSON.stringify({ email: state.email, password: PASSWORD }) });
  const cookie = ([] as string[]).concat((signIn.headers["set-cookie"] as string[] | string | undefined) ?? []).map((line) => line.split(";")[0]).join("; ");
  const form = multipart({ accent: "" }, { field: "logo", name: "slow.png", type: "image/png", bytes: Buffer.from("this is not an image, and it arrives slowly") });
  const container = compose("ps", "-q", "app").trim();

  const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpsRequest(
      { host: "127.0.0.1", port: stack.httpsPort, path: "/api/branding", method: "POST", servername: stack.publicHost, rejectUnauthorized: false, headers: { host: `${stack.publicHost}:${stack.httpsPort}`, cookie, origin: stack.origin, "content-type": form.contentType, "content-length": String(form.body.length) } },
      (reply) => {
        const chunks: Buffer[] = [];
        reply.on("data", (chunk: Buffer) => chunks.push(chunk));
        reply.on("end", () => resolve({ status: reply.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    request.on("error", reject);
    request.write(form.body.subarray(0, 60));
    // The stop is asked for while the request is half sent; the rest arrives four seconds later.
    setTimeout(() => request.end(form.body.subarray(60)), 4000);
  });
  await new Promise((wait) => setTimeout(wait, 500));
  const t0 = Date.now();
  const stopped = new Promise<number>((resolve) => {
    const child = spawn("docker", ["compose", "-f", stack.composeFile, "--env-file", stack.envFile, "stop", "app"], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code ?? -1));
  });

  const answered = await response;
  expect(answered.status, "the request in progress was answered, not cut off").toBeGreaterThanOrEqual(400);
  expect(answered.status).toBeLessThan(500);
  expect(JSON.parse(answered.body)).toMatchObject({ ok: false });
  expect(await stopped).toBe(0);
  const seconds = (Date.now() - t0) / 1000;
  const inspected = docker("inspect", "--format", "{{.State.ExitCode}} {{.State.OOMKilled}}", container).out.trim();
  expect(inspected, "exit code and OOM flag").toBe("0 false");
  expect(seconds, "stopped after the request, well inside the 30 s grace period").toBeLessThan(25);
  const logs = compose("logs", "app", "--no-log-prefix", "--tail", "20");
  expect(logs).toMatch(/\[shutdown\] SIGTERM/);
  expect(logs).toMatch(/\[shutdown\] done/);
  compose("start", "app");
  await waitReady();
  expect(await snapshot()).toEqual(before);
});

test("an image started with a bad configuration refuses to start, says what is wrong, and never prints a value", async () => {
  const sentinel = "Sentinel-Secret-Value-Do-Not-Print-123456";
  const run = docker("run", "--rm", "-e", `DATABASE_URL=postgres://postgres:${sentinel}@db:5432/x`, "-e", "BETTER_AUTH_SECRET=short", "-e", "BETTER_AUTH_URL=http://insecure.example", "-e", `DATABASE_ADMIN_URL=postgres://climvia_owner:${sentinel}@db/x`, "-e", `AWS_SECRET_ACCESS_KEY=${sentinel}`, "-e", "DOMAIN_DNS_RESOLVER=fixture", `climvia-web:${await version()}`);
  expect(run.code).toBe(1);
  expect(run.out).toContain("The production configuration is not fit to start with");
  for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DATABASE_ADMIN_URL", "AWS_SECRET_ACCESS_KEY", "DOMAIN_DNS_RESOLVER", "TLS_ASK_TOKEN", "ASSET_STORAGE_DRIVER"]) expect(run.out, name).toContain(name);
  expect(run.out).not.toContain(sentinel);
  expect(run.out).not.toContain("short");
});

test("an application whose file volume is missing is alive but not ready, so no traffic is sent to it", async () => {
  const env = (JSON.parse(compose("config", "--format", "json")) as { services: { app: { environment: Record<string, string> } } }).services.app.environment;
  const args = ["run", "-d", "--name", `${stack.project}-novolume`, "--read-only", "--tmpfs", "/tmp", "--network", `${stack.project}_data`, "--cap-drop", "ALL"];
  for (const [name, value] of Object.entries(env)) args.push("-e", `${name}=${value}`);
  args.push("-e", `CLIMVIA_ENV=production`, `climvia-web:${await version()}`);
  const started = docker(...args);
  expect(started.code, started.out).toBe(0);
  try {
    await until(() => docker("exec", `${stack.project}-novolume`, "node", "-e", "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))").code === 0, 60, "the container to answer");
    const answer = docker("exec", `${stack.project}-novolume`, "node", "-e", "fetch('http://127.0.0.1:3000/health/ready').then(async r=>console.log(r.status+' '+(await r.text()))).catch(e=>console.log('ERR'))");
    const [status, body] = [answer.out.trim().split(" ")[0], answer.out.trim().slice(4)];
    expect(status).toBe("503");
    expect(JSON.parse(body).checks).toEqual({ config: "ok", database: "ok", storage: "fail" });
  } finally {
    docker("rm", "-f", `${stack.project}-novolume`);
  }
});

test("a deployment whose migration fails stops there: the running application is not touched", async () => {
  const container = compose("ps", "-q", "app").trim();
  const wrong = `postgres://${stack.env.POSTGRES_OWNER_USER}:not-the-password@db:5432/${stack.env.POSTGRES_DB}`;
  // deploy.sh runs the migration on its own BEFORE it replaces the application (compose would replace the container first and start it after the
  // migration, leaving it down when the migration fails). So a failing migration is a failing command and nothing else has happened.
  const migration = composeResult("run", "--rm", "-e", `DATABASE_ADMIN_URL=${wrong}`, "migrate");
  expect(migration.code).not.toBe(0);
  expect(migration.out).not.toContain("not-the-password");
  expect(migration.out).toMatch(/password authentication failed/);
  const script = readFileSync("deploy/scripts/deploy.sh", "utf8");
  expect(script.indexOf("compose run --rm migrate\n")).toBeGreaterThan(-1);
  expect(script.indexOf("compose run --rm migrate\n")).toBeLessThan(script.indexOf("compose up -d --wait --remove-orphans"));
  await waitReady();
  expect(compose("ps", "-q", "app").trim(), "the application container was left alone").toBe(container);
  expect(await snapshot()).toEqual(before);
});

test("a bad env file is rejected before anything is built, with the names of what is wrong and no values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "climvia-env-"));
  const file = join(dir, "bad.env");
  const password = "Sentinel-Password-Never-Printed-9988776655";
  const lines = readFileSync(stack.envFile, "utf8")
    .split(/\r?\n/)
    .map((line) => (line.startsWith("BETTER_AUTH_SECRET=") ? "BETTER_AUTH_SECRET=short" : line.startsWith("POSTGRES_OWNER_PASSWORD=") ? `POSTGRES_OWNER_PASSWORD=${password}` : line.startsWith("TLS_ASK_TOKEN=") ? "TLS_ASK_TOKEN=change-me" : line.startsWith("BETTER_AUTH_URL=") ? "BETTER_AUTH_URL=http://app.example.com" : line));
  writeFileSync(file, lines.join("\n"));
  const result = composeResult("run", "--rm", "--no-deps", "-v", `${file}:/app/.bad.env:ro`, "migrate", "npm", "run", "--silent", "config:check", "--", "/app/.bad.env");
  expect(result.code).toBe(1);
  for (const name of ["BETTER_AUTH_SECRET", "TLS_ASK_TOKEN", "BETTER_AUTH_URL", "DATABASE_ADMIN_URL"]) expect(result.out, name).toContain(name);
  expect(result.out).not.toContain(password);
  // The file the stack actually runs on passes the same check.
  const good = composeResult("run", "--rm", "--no-deps", "-v", `${join(process.cwd(), stack.envFile)}:/app/.good.env:ro`, "migrate", "npm", "run", "--silent", "config:check", "--", "/app/.good.env");
  expect(good.code, good.out).toBe(0);
});

test("sign-in is rate limited by the REAL client address: a forged X-Forwarded-For does not buy a fresh allowance", async () => {
  await new Promise((wait) => setTimeout(wait, 11_000)); // let the 10-second window empty
  const statuses: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    const response = await get(stack.publicHost, "/api/auth/sign-in/email", {
      method: "POST",
      // Each attempt claims to come from a different address. The proxy replaces the header with the address it saw, so they all count against one.
      headers: { origin: stack.origin, "content-type": "application/json", "x-forwarded-for": `203.0.113.${index + 10}` },
      body: JSON.stringify({ email: "nobody@example.test", password: "Wrong-horse-9" }),
    });
    statuses.push(response.status);
  }
  expect(statuses.slice(0, 3).every((status) => status >= 400 && status < 429), JSON.stringify(statuses)).toBe(true);
  expect(statuses.slice(3), JSON.stringify(statuses)).toContain(429);
  await new Promise((wait) => setTimeout(wait, 11_000));
  expect(await signsIn()).toBe(true);
});
