/**
 * Phase 18C1: the container files, held to the rules the production runtime depends on. These read the files; they need no Docker. What the files
 * actually DO (the build, the stack, the proxy, the restarts, the backups) is proved against real containers by the Docker-side suite
 * (`npm run test:docker`, e2e-docker/), and this keeps them from drifting out of that shape unnoticed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { expect, test } from "playwright/test";
import { APP_ENVIRONMENT, applicationEnvironmentOf, deploymentFileProblems } from "../scripts/deploy/rules";
import { productionConfigProblems } from "../src/lib/deployment";
import { LOGO_MAX_BYTES } from "../src/lib/asset-rules";
import { ROOT } from "./import-graph";

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const lines = (text: string) => text.split("\n");

/** The text of each service in docker-compose.production.yml, by name (no YAML parser: the file is regular on purpose). */
function services(text: string): Record<string, string> {
  const body = text.slice(text.indexOf("\nservices:\n") + 11, text.indexOf("\nnetworks:\n"));
  const blocks: Record<string, string> = {};
  let current: string | null = null;
  for (const line of lines(body)) {
    const header = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
    if (header) {
      current = header[1];
      blocks[current] = "";
    } else if (current) blocks[current] += `${line}\n`;
  }
  return blocks;
}

const environmentKeys = (block: string): string[] => {
  const section = /\n {4}environment:\n((?: {6}.*\n)+)/.exec(`\n${block}`);
  return section ? [...section[1].matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]) : [];
};

const COMPOSE = read("docker-compose.production.yml");
const compose = services(COMPOSE);
const DOCKERFILE = read("Dockerfile");
const CADDYFILE = read("deploy/caddy/Caddyfile");
/** Only the directives: the comments that explain them are allowed to name what they forbid. */
const CADDY_DIRECTIVES = CADDYFILE.replace(/^\s*#.*$/gm, "");
const stages = Object.fromEntries(DOCKERFILE.split(/^FROM /m).slice(1).map((stage) => [/ AS (\w+)/.exec(stage.split("\n")[0])?.[1] ?? "", stage]));

test.describe("the production compose file", () => {
  test("has exactly the four services, and only the proxy publishes a port", () => {
    expect(Object.keys(compose).sort()).toEqual(["app", "db", "migrate", "proxy"]);
    for (const name of ["app", "db", "migrate"]) expect(compose[name], name).not.toMatch(/^ {4}ports:/m);
    expect(compose.proxy).toMatch(/^ {4}ports:\n {6}- "\$\{HTTP_PORT:-80\}:80"\n {6}- "\$\{HTTPS_PORT:-443\}:443"\n/m);
    // Nothing is published on the host's loopback or any other address by a shorthand: the only mappings in the file are the proxy's two.
    expect([...COMPOSE.matchAll(/^\s+- "[^"]*:\d+(\/\w+)?"$/gm)].map((match) => match[0].trim())).toEqual(['- "${HTTP_PORT:-80}:80"', '- "${HTTPS_PORT:-443}:443"']);
  });

  test("each service is handed an explicit list of settings, never the whole env file", () => {
    expect(COMPOSE).not.toMatch(/^\s*env_file:/m);
    // The app receives exactly the application's environment: the same names the config check applies the application's rules to.
    expect(environmentKeys(compose.app).sort()).toEqual([...APP_ENVIRONMENT].sort());
    // The owner's credential and the database password go to the migration and the database only.
    for (const secret of ["DATABASE_ADMIN_URL", "POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) expect(compose.app, secret).not.toContain(secret);
    expect(environmentKeys(compose.migrate).sort()).toEqual(["DATABASE_ADMIN_URL", "DB_WAIT_SECONDS", "POSTGRES_APP_PASSWORD"]);
    expect(environmentKeys(compose.db).sort()).toEqual(["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"]);
    expect(environmentKeys(compose.proxy).sort()).toEqual(["ACME_EMAIL", "PUBLIC_HOST", "TLS_ASK_TOKEN"]);
    // Required settings fail the compose command itself when they are missing.
    for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]) expect(compose.app).toContain(`\${${name}:?`);
  });

  test("the startup order is database healthy, then the migration succeeds, then the app is healthy, then the proxy; and nothing seeds", () => {
    expect(compose.migrate).toMatch(/depends_on:\n {6}db:\n {8}condition: service_healthy/);
    expect(compose.app).toMatch(/depends_on:\n {6}migrate:\n {8}condition: service_completed_successfully/);
    expect(compose.proxy).toMatch(/depends_on:\n {6}app:\n {8}condition: service_healthy/);
    expect(compose.migrate).toMatch(/command: \["npm", "run", "db:migrate"\]/);
    expect(compose.db).toMatch(/healthcheck:/);
    expect(compose.migrate).toMatch(/restart: "no"/);
    expect(COMPOSE).not.toMatch(/db:seed|db:reset|prepare-test|ALLOW_SEED|SEED_PASSWORD|seed\.ts/);
  });

  test("the networks separate the layers: the proxy and the database never share one, and the database's has no way out", () => {
    expect(compose.db).toMatch(/networks:\n {6}- data\n/);
    expect(compose.proxy).toMatch(/networks:\n {6}- edge\n/);
    expect(compose.app).toMatch(/networks:\n {6}- edge\n {6}- data\n/);
    expect(compose.migrate).toMatch(/networks:\n {6}- data\n/);
    expect(COMPOSE).toMatch(/\n {2}data:\n {4}internal: true\n/);
    // The proxy's address range is fixed so the application can be told which hop may name a client's address.
    expect(COMPOSE).toContain("subnet: ${EDGE_SUBNET:-172.30.0.0/24}");
  });

  test("the application and the migration run read-only, unprivileged and with no capabilities; nothing mounts the Docker socket", () => {
    expect(COMPOSE).toMatch(/x-hardening: &hardening\n {2}security_opt:\n {4}- no-new-privileges:true\n {2}cap_drop:\n {4}- ALL\n/);
    for (const name of ["app", "migrate"]) {
      expect(compose[name], name).toContain("<<: *hardening");
      expect(compose[name], name).toMatch(/read_only: true/);
    }
    expect(compose.app).toMatch(/init: true/);
    expect(compose.app).toMatch(/stop_grace_period: 30s/);
    expect(compose.proxy).toMatch(/read_only: true/);
    expect(compose.proxy).toMatch(/cap_drop:\n {6}- ALL\n {4}cap_add:\n {6}- NET_BIND_SERVICE\n/);
    expect(COMPOSE).not.toMatch(/docker\.sock|privileged:|network_mode:\s*host|pid:\s*host|cap_add:\s*\n\s*- (SYS_ADMIN|ALL)/);
    // The only writable places the application has: the assets volume and two memory-backed directories.
    expect(compose.app).toMatch(/volumes:\n {6}- assets:\/data\/assets\n/);
    expect(compose.app).toMatch(/tmpfs:\n {6}- \/tmp:.*\n {6}- \/app\/\.next\/cache:/);
  });

  test("the data lives on named volumes, the images are pinned to a major version and the logs are rotated", () => {
    expect(COMPOSE).toMatch(/\nvolumes:\n(?: {2}[a-z-]+:.*\n|\s*#.*\n)+/);
    for (const volume of ["pgdata", "assets", "caddy-data", "caddy-config"]) expect(COMPOSE, volume).toMatch(new RegExp(`\\n {2}${volume}:\\n`));
    expect(compose.db).toContain("image: postgres:17-alpine");
    expect(compose.proxy).toContain("image: caddy:2-alpine");
    expect(compose.db).toContain("- pgdata:/var/lib/postgresql/data");
    expect(compose.proxy).toContain("- caddy-data:/data");
    expect(COMPOSE).toMatch(/max-size: "10m"/);
    expect(COMPOSE).not.toMatch(/image: \S+:latest/);
  });
});

test.describe("the image", () => {
  test("is built in stages, runs as a fixed unprivileged user, and starts the real production server, not a development one", () => {
    expect(Object.keys(stages)).toEqual(["base", "deps", "build", "tools", "runner"]);
    expect(stages.runner).toMatch(/^USER 10001:10001$/m);
    expect(stages.runner).toMatch(/^CMD \["node", "--require", "\.\/graceful-shutdown\.cjs", "server\.js"\]$/m);
    expect(DOCKERFILE).not.toMatch(/next dev|npm run dev|npm start|ts-node/);
    expect(stages.deps).toMatch(/npm ci/);
    expect(stages.deps).not.toMatch(/npm install/);
    expect(stages.build).toMatch(/NEXT_OUTPUT=standalone/);
    expect(read("scripts/graceful-shutdown.cjs")).toMatch(/SIGTERM/);
  });

  test("the deployment marker is set by the runtime image only: not by the build, the tools, or anything the browser tests run", () => {
    expect(stages.runner).toMatch(/CLIMVIA_ENV=production/);
    for (const stage of ["base", "deps", "build", "tools"]) expect(stages[stage], stage).not.toMatch(/CLIMVIA_ENV/);
    expect(read("playwright.config.ts")).not.toMatch(/CLIMVIA_ENV/);
    expect(read("package.json")).not.toMatch(/CLIMVIA_ENV/);
  });

  test("holds no secret, no environment file, no data and no demo business: nothing is copied in that could", () => {
    const copies = lines(DOCKERFILE).filter((line) => /^(COPY|ADD) /.test(line));
    for (const copy of copies) expect(copy, copy).not.toMatch(/\.env|\.data|backups|\.dump|e2e|test-results|playwright|seed-data|docs\b|\.git\b/);
    expect(DOCKERFILE).not.toMatch(/^ENV [^\n]*(PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|DATABASE_ADMIN_URL)/m);
    expect(DOCKERFILE).not.toMatch(/^ARG [^\n]*(PASSWORD|SECRET|TOKEN|KEY)/m);
    expect(DOCKERFILE).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
    // The tools image gets the migration, status, roles, fingerprint and configuration check, not the seed or any of its data.
    const toolsCopies = lines(stages.tools).filter((line) => line.startsWith("COPY "));
    expect(toolsCopies.join("\n")).toContain("scripts/db/lib.ts scripts/db/migrate.ts scripts/db/status.ts scripts/db/roles.ts scripts/db/fingerprint.ts");
    expect(toolsCopies.join("\n")).not.toMatch(/seed|reset|prepare-test|reporting/);
    // A directory the standalone build would need at run time must be copied; today there is none.
    if (existsSync(join(ROOT, "public"))) expect(stages.runner).toMatch(/COPY .*\/app\/public/);
  });

  test("uploaded files have a directory the application owns and no VOLUME instruction (a container started without a mount must not look healthy)", () => {
    expect(stages.runner).toMatch(/mkdir -p \/data\/assets && chown 10001:10001 \/data\/assets/);
    expect(DOCKERFILE).not.toMatch(/^VOLUME /m);
    expect(stages.runner).toMatch(/HEALTHCHECK [^\n]*\\\n\s+CMD wget -q -O \/dev\/null http:\/\/127\.0\.0\.1:3000\/health\/ready/);
  });

  test(".dockerignore keeps every secret, dump, upload, test artifact and the deployment tooling out of the build context", () => {
    const ignored = lines(read(".dockerignore")).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    for (const entry of [".env", ".env.*", ".data", "backups", "*.dump", "e2e", "e2e-docker", "test-results", "playwright-report", "playwright.docker.config.ts", ".git", "docs", "deploy", "node_modules", ".next"]) expect(ignored, entry).toContain(entry);
    expect(ignored).not.toContain("!.env.production.example");
  });

  test(".gitignore keeps real env files and every dump out of the repository, and lets the example in", () => {
    const ignored = lines(read(".gitignore")).map((line) => line.trim());
    expect(ignored).toContain(".env*");
    expect(ignored).toContain("!.env.production.example");
    for (const entry of ["/backups/", "*.dump", "*.dump.sha256", "*.assets.tar.gz", "/.data/"]) expect(ignored, entry).toContain(entry);
  });
});

test.describe("the reverse proxy configuration", () => {
  test("keeps the Host the browser sent, strips the headers a client could use to pretend otherwise, and trusts no proxy of its own", () => {
    expect(CADDY_DIRECTIVES).not.toMatch(/header_up\s+Host\b/i);
    expect(CADDY_DIRECTIVES).not.toMatch(/header_up\s+X-Forwarded-(For|Host|Proto)\s+\S/i);
    for (const header of ["Forwarded", "X-Original-Host", "X-Host", "X-Forwarded-Server"]) expect(CADDYFILE).toContain(`header_up -${header}`);
    expect(CADDY_DIRECTIVES).not.toMatch(/trusted_proxies/);
    expect(CADDYFILE).toMatch(/reverse_proxy app:3000/);
  });

  test("never forwards /internal, and asks the application before it requests a certificate for any name", () => {
    expect(CADDYFILE).toMatch(/@internal path \/internal \/internal\/\*\n\s+handle @internal \{\n\s+respond "Not found" 404/);
    expect(CADDYFILE).toMatch(/on_demand_tls \{\n\s+ask http:\/\/app:3000\/internal\/tls-allow\?token=\{\$TLS_ASK_TOKEN\}\n/);
    // On-demand certificates exist only on the catch-all block, never on the application's own name.
    expect([...CADDYFILE.matchAll(/^\s+on_demand\s*$/gm)]).toHaveLength(1);
    expect(CADDYFILE).toMatch(/https:\/\/ \{\n\s+tls \{\n\s+on_demand\n/);
    expect(CADDYFILE).toMatch(/\{\$PUBLIC_HOST\} \{/);
    // Every site block takes the same guards.
    expect([...CADDYFILE.matchAll(/^\s+import guards$/gm)]).toHaveLength(2);
  });

  test("limits request bodies above the logo size, sets timeouts, hides the server, and logs no cookie or credential", () => {
    const limit = /max_size (\d+)MB/.exec(CADDYFILE);
    expect(Number(limit?.[1]) * 1024 * 1024).toBeGreaterThan(LOGO_MAX_BYTES);
    expect(CADDYFILE).toMatch(/timeouts \{\n\s+read_header \d+s\n\s+read_body \d+s\n\s+write \d+s\n\s+idle /);
    expect(CADDYFILE).toMatch(/dial_timeout \d+s/);
    expect(CADDYFILE).toMatch(/request>headers>Cookie delete/);
    expect(CADDYFILE).toMatch(/request>headers>Authorization delete/);
    expect(CADDYFILE).toMatch(/resp_headers>Set-Cookie delete/);
    expect(CADDYFILE).toContain("-Server");
    // The application's own policy on the logo route is never overwritten: defaults only, one directive each.
    expect(CADDYFILE).toMatch(/header \?Strict-Transport-Security /);
    expect(CADDYFILE).toMatch(/header \?X-Content-Type-Options /);
    expect(CADDY_DIRECTIVES).not.toMatch(/Content-Security-Policy/i);
  });

  test("a local trial uses Caddy's own CA and a deployment uses the public one: the two modes are separate files and the default is the real one", () => {
    expect(read("deploy/caddy/mode.local.caddy")).toMatch(/^local_certs$/m);
    expect(read("deploy/caddy/mode.local.caddy")).toMatch(/^skip_install_trust$/m);
    expect(read("deploy/caddy/mode.public.caddy")).not.toMatch(/local_certs|internal|tls_/);
    expect(CADDY_DIRECTIVES).not.toMatch(/local_certs|acme_ca\s|tls internal/);
    expect(COMPOSE).toContain("${CADDY_MODE_FILE:-./deploy/caddy/mode.public.caddy}");
    // The platform's wildcard (needs DNS validation and DNS that does not exist yet) is described, not enabled.
    expect(CADDYFILE).toMatch(/^# \*\.climvia\.com \{/m);
    expect(CADDYFILE.replace(/^#.*$/gm, "")).not.toContain("*.climvia.com");
  });
});

test.describe("the env file and the deploy scripts", () => {
  const example = parseEnv(read(".env.production.example"));

  test("the example names every setting the stack needs, and holds no usable secret", () => {
    for (const name of [...APP_ENVIRONMENT.filter((name) => !["DATABASE_POOL_MAX", "AUTH_TRUSTED_ORIGINS", "APP_HOSTS", "AWS_REGION", "AWS_S3_BUCKET"].includes(name)), "POSTGRES_DB", "POSTGRES_OWNER_USER", "POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD", "DATABASE_ADMIN_URL", "PUBLIC_HOST", "ACME_EMAIL", "EDGE_SUBNET"]) {
      expect(example, name).toHaveProperty(name);
    }
    expect(productionConfigProblems({ ...applicationEnvironmentOf(example), CLIMVIA_ENV: "production", NODE_ENV: "production" }).length + deploymentFileProblems(example).length, "the example must fail the check until it is filled in").toBeGreaterThan(0);
    expect(read(".env.production.example")).not.toMatch(/AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)=/m);
    expect(example.ASSET_STORAGE_DRIVER).toBe("local");
    expect(example.CUSTOM_DOMAIN_URL_SCHEME).toBe("https");
  });

  test("a filled-in file passes both checks, and a file with the example's placeholders does not", () => {
    const owner = "Qm7Vx2Lp9Rk4Zt6Wc1Hb8NsDf3Ya5JgE0u";
    const app = "Ht3Bn8Rw5Xk2Pc7Zd9Fv4Lm1Sy6Qj0Aaz";
    const filled: Record<string, string> = {
      ...example,
      POSTGRES_OWNER_PASSWORD: owner,
      POSTGRES_APP_PASSWORD: app,
      DATABASE_URL: `postgres://climvia_app:${app}@db:5432/climvia`,
      DATABASE_ADMIN_URL: `postgres://climvia_owner:${owner}@db:5432/climvia`,
      BETTER_AUTH_SECRET: "Zq8vK2mT5xR9wY3nB6cH1jL4pS7dF0gA",
      TLS_ASK_TOKEN: "Hn4Rt8Xw2Qk6Vm9Zc3Bf7Ld1Ys5Pg0Ja",
      BETTER_AUTH_URL: "https://app.climvia-demo.com",
      PUBLIC_HOST: "app.climvia-demo.com",
      ACME_EMAIL: "ops@climvia-demo.com",
      CUSTOM_DOMAIN_TARGET: "sites.climvia-demo.com",
    };
    expect(deploymentFileProblems(filled)).toEqual([]);
    expect(productionConfigProblems({ ...applicationEnvironmentOf(filled), CLIMVIA_ENV: "production", NODE_ENV: "production" })).toEqual([]);
    // Each way the two connection strings can disagree with the passwords is caught.
    expect(deploymentFileProblems({ ...filled, DATABASE_URL: filled.DATABASE_URL.replace(app, owner) }).join(" ")).toContain("DATABASE_URL must use the password POSTGRES_APP_PASSWORD");
    expect(deploymentFileProblems({ ...filled, DATABASE_ADMIN_URL: filled.DATABASE_ADMIN_URL.replace("@db:", "@elsewhere:") }).join(" ")).toContain("DATABASE_ADMIN_URL must point at the compose service");
    expect(deploymentFileProblems({ ...filled, POSTGRES_APP_PASSWORD: owner, DATABASE_URL: `postgres://climvia_app:${owner}@db:5432/climvia` }).join(" ")).toContain("must differ");
    expect(deploymentFileProblems({ ...filled, PUBLIC_HOST: "other.climvia-demo.com" }).join(" ")).toContain("PUBLIC_HOST must be the host of BETTER_AUTH_URL");
    expect(deploymentFileProblems({ ...filled, AUTH_TRUSTED_PROXIES: "10.0.0.0/8" }).join(" ")).toContain("AUTH_TRUSTED_PROXIES must list the proxy network");
    expect(deploymentFileProblems({ ...filled, AWS_ACCESS_KEY_ID: "AKIAEXAMPLE" }).join(" ")).toContain("AWS_ACCESS_KEY_ID must not be set");
    expect(deploymentFileProblems({ ...filled, POSTGRES_OWNER_USER: "climvia_app" }).join(" ")).toContain("not be climvia_app");
  });

  test("the scripts are strict, never delete a volume, a backup or a database they did not create, and print no setting's value", () => {
    const scripts = readdirSync(join(ROOT, "deploy", "scripts")).filter((name) => name.endsWith(".sh"));
    expect(scripts.sort()).toEqual(["backup-assets.sh", "backup.sh", "common.sh", "deploy.sh", "restore-assets.sh", "restore-drill.sh", "restore.sh", "verify.sh"]);
    for (const name of scripts) {
      const text = read(`deploy/scripts/${name}`);
      expect(text, name).toMatch(/^#!\/usr\/bin\/env bash$/m);
      expect(text, name).not.toContain("\r");
      expect(text, name).not.toMatch(/down -v|--volumes|volume rm|volume prune|system prune|docker rm -f|rm -rf (\/|\$|~|\*)|--force-recreate/);
      expect(text, name).not.toMatch(/\bprintenv\b|\benv\s*\||cat "\$ENV_FILE"|echo "\$\{?(POSTGRES|DATABASE|BETTER_AUTH|TLS_ASK|AWS)/);
      if (name !== "common.sh") expect(text, name).toMatch(/common\.sh/);
    }
    expect(read("deploy/scripts/common.sh")).toMatch(/^set -euo pipefail$/m);
    // A backup is only removed while it is being made (the partial file), never afterwards.
    for (const name of ["backup.sh", "backup-assets.sh"]) expect([...read(`deploy/scripts/${name}`).matchAll(/\brm -f ([^\n;&]+)/g)].map((match) => match[1].trim()), name).toEqual(expect.arrayContaining([expect.stringContaining("partial")]));
    expect(read("deploy/scripts/backup.sh")).toMatch(/refusing to overwrite a backup/);
    expect(read("deploy/scripts/restore.sh")).toMatch(/a restore never overwrites/);
    expect(read("deploy/scripts/restore.sh")).toMatch(/--single-transaction --exit-on-error/);
    expect(read("deploy/scripts/restore.sh")).toMatch(/checksum does not match/);
    // The migration runs on its own, and must succeed, before the application is replaced.
    const deploy = read("deploy/scripts/deploy.sh");
    expect(deploy.indexOf("compose run --rm migrate\n")).toBeGreaterThan(deploy.indexOf("compose up -d --wait db"));
    expect(deploy.indexOf("compose run --rm migrate\n")).toBeLessThan(deploy.indexOf("compose up -d --wait --remove-orphans"));
    expect(deploy.indexOf("config:check")).toBeLessThan(deploy.indexOf("compose up -d"));
  });

  test("line endings: every file that runs in a Linux container or on a Linux host is LF only, and .gitattributes keeps it so", () => {
    for (const path of ["Dockerfile", "docker-compose.production.yml", "docker-compose.yml", ".dockerignore", ".env.production.example", "deploy/caddy/Caddyfile", "deploy/caddy/mode.local.caddy", "deploy/caddy/mode.public.caddy", "scripts/graceful-shutdown.cjs"]) {
      expect(read(path), path).not.toContain("\r");
    }
    const attributes = read(".gitattributes");
    for (const rule of ["*.sh text eol=lf", "Dockerfile text eol=lf", "docker-compose*.yml text eol=lf", "deploy/** text eol=lf", "*.caddy text eol=lf"]) expect(attributes, rule).toContain(rule);
  });

  test("production never seeds: the seed, the reset and the test preparation refuse under the deployment marker, and no start-up path calls them", () => {
    for (const file of ["scripts/db/seed-lib.ts", "scripts/db/reset.ts", "scripts/db/prepare-test.ts"]) expect(read(file), file).toContain('CLIMVIA_ENV === "production"');
    // No override can lift the deployment refusal (ALLOW_SEED lifts only the NODE_ENV one).
    expect(read("scripts/db/seed-lib.ts")).toMatch(/CLIMVIA_ENV === "production"\) throw new Error\("Refusing to seed development data in a production deployment\."\)/);
    const migrate = read("scripts/db/migrate.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(migrate).not.toMatch(/seed/i);
    expect(read("src/instrumentation-node.ts") + read("src/instrumentation.ts")).not.toMatch(/seed/i);
    for (const file of ["Dockerfile", "docker-compose.production.yml", "deploy/caddy/Caddyfile", ...readdirSync(join(ROOT, "deploy", "scripts")).map((name) => `deploy/scripts/${name}`)]) {
      expect(read(file).replace(/^\s*#.*$/gm, ""), file).not.toMatch(/db:seed|db:reset|seed\.ts|prepare-test/);
    }
  });
});
