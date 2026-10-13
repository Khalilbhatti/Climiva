/**
 * What a PRODUCTION deployment of the application must look like, checked from its environment.
 *
 * A container image sets `CLIMVIA_ENV=production`. That, and not `NODE_ENV`, marks a real deployment: the browser tests also run a production
 * BUILD (so `NODE_ENV` is "production" there) with a test DNS resolver, a plain-http address and a test asset directory, and they must go on
 * working. When the marker is set, `productionConfigProblems` lists every way the environment is unfit, and the application refuses to start
 * (src/instrumentation.ts) rather than run on a demo value, a weak secret, a test switch or the owner's database credential.
 *
 * Each problem NAMES the setting and the rule. It never contains the value: the list is written to the container's log.
 *
 * Pure: no database, no network, no file access. No `server-only` import on purpose (the instrumentation hook, the config check script and the
 * specs all read it).
 */
import { normalizeHostname } from "./hostname";

type Env = Record<string, string | undefined>;

/** Settings that exist only for development and the tests. A deployment must not carry any of them. */
const TEST_ONLY = ["DOMAIN_DNS_RESOLVER", "DOMAIN_DNS_FIXTURE_DIR", "TEST_ASSET_DIR", "TEST_DNS_DIR", "TEST_DATABASE_NAME", "ALLOW_SEED", "SEED_PASSWORD"] as const;

/** Credentials the running application must never hold: the owner's (it can bypass what Row Level Security protects) and long-lived AWS keys (the instance's IAM role supplies credentials). */
const NEVER_IN_THE_APP = ["DATABASE_ADMIN_URL", "POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"] as const;

/** The restricted runtime role (migration 0001's `climvia_app`), the one Row Level Security binds. */
export const RUNTIME_ROLE = "climvia_app";

const PLACEHOLDER = /^(replace|change|your[-_]|example|placeholder|todo|xxx)|change[-_]?me/i;

const present = (value: string | undefined): value is string => typeof value === "string" && value.trim() !== "";

/** A secret that is long enough, not a placeholder from an example file, and not one repeated character. */
function weakSecret(value: string, minimum: number): string | null {
  if (value.length < minimum) return `must be at least ${minimum} characters`;
  if (PLACEHOLDER.test(value)) return "is still a placeholder from an example file";
  if (new Set(value).size < 8) return "has too little variety to be random";
  return null;
}

function listOf(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

/** An IPv4 address or CIDR range, or an IPv6 one: enough to tell a proxy's address from a typo. */
const ADDRESS = /^(\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?|[0-9a-fA-F:]+(\/\d{1,3})?)$/;

/** Whether this process is a real deployment (a container image sets the marker; nothing else should). */
export const isProductionDeployment = (env: Env = process.env): boolean => env.CLIMVIA_ENV === "production";

/** Every reason the environment is unfit for a production deployment. Empty means it may start. Applies only when the marker says so. */
export function productionConfigProblems(env: Env = process.env): string[] {
  if (!isProductionDeployment(env)) return [];
  const problems: string[] = [];
  const add = (name: string, rule: string) => problems.push(`${name} ${rule}.`);

  if (env.NODE_ENV !== "production") add("NODE_ENV", "must be production");

  // ── what the application connects as
  const databaseUrl = env.DATABASE_URL;
  if (!present(databaseUrl)) add("DATABASE_URL", "is not set");
  else {
    try {
      const url = new URL(databaseUrl);
      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") add("DATABASE_URL", "must be a postgres:// URL");
      else if (decodeURIComponent(url.username) !== RUNTIME_ROLE) add("DATABASE_URL", `must connect as the restricted role ${RUNTIME_ROLE}, never as the owner or a superuser`);
      else if (!url.password) add("DATABASE_URL", "has no password");
      else if (PLACEHOLDER.test(decodeURIComponent(url.password))) add("DATABASE_URL", "still has a placeholder password from an example file");
    } catch {
      add("DATABASE_URL", "is not a valid URL");
    }
  }
  for (const name of NEVER_IN_THE_APP) if (present(env[name])) add(name, "must not be set in the application's environment");
  if (present(env.DATABASE_POOL_MAX) && !/^[1-9]\d{0,2}$/.test(env.DATABASE_POOL_MAX)) add("DATABASE_POOL_MAX", "must be a whole number between 1 and 999");

  // ── sign-in
  if (!present(env.BETTER_AUTH_SECRET)) add("BETTER_AUTH_SECRET", "is not set");
  else {
    const weak = weakSecret(env.BETTER_AUTH_SECRET, 32);
    if (weak) add("BETTER_AUTH_SECRET", weak);
  }
  const origin = env.BETTER_AUTH_URL;
  let appHost: string | null = null;
  if (!present(origin)) add("BETTER_AUTH_URL", "is not set");
  else {
    try {
      const url = new URL(origin);
      const host = normalizeHostname(url.hostname);
      if (url.protocol !== "https:") add("BETTER_AUTH_URL", "must be an https:// address");
      else if (url.pathname !== "/" || url.search || url.hash || url.username) add("BETTER_AUTH_URL", "must be an origin only (scheme, host and optional port)");
      else if (!host.ok) add("BETTER_AUTH_URL", "must use a domain name, not an IP address or a single-label name");
      else appHost = host.hostname;
    } catch {
      add("BETTER_AUTH_URL", "is not a valid URL");
    }
  }
  const proxies = listOf(env.AUTH_TRUSTED_PROXIES);
  if (proxies.length === 0) add("AUTH_TRUSTED_PROXIES", "must list the reverse proxy's address or network, so sign-in rate limits see real clients");
  else if (proxies.some((item) => !ADDRESS.test(item))) add("AUTH_TRUSTED_PROXIES", "has an entry that is not an IP address or CIDR range");
  for (const item of listOf(env.AUTH_TRUSTED_ORIGINS)) {
    try {
      if (new URL(item).protocol !== "https:") add("AUTH_TRUSTED_ORIGINS", "may list only https:// origins");
    } catch {
      add("AUTH_TRUSTED_ORIGINS", "has an entry that is not a valid origin");
    }
  }

  // ── which names are ours, and how customers reach us
  for (const item of listOf(env.APP_HOSTS)) if (!normalizeHostname(item).ok) add("APP_HOSTS", "has an entry that is not a domain name");
  if (!present(env.CUSTOM_DOMAIN_TARGET)) add("CUSTOM_DOMAIN_TARGET", "is not set (customers are told to point their DNS at it)");
  else {
    const target = normalizeHostname(env.CUSTOM_DOMAIN_TARGET);
    if (!target.ok) add("CUSTOM_DOMAIN_TARGET", "must be a domain name");
    else if (appHost && target.hostname === appHost) add("CUSTOM_DOMAIN_TARGET", "must not be the same name as the application's own address");
  }
  if (present(env.CUSTOM_DOMAIN_URL_SCHEME) && env.CUSTOM_DOMAIN_URL_SCHEME !== "https") add("CUSTOM_DOMAIN_URL_SCHEME", "must be https (or unset)");
  if (!present(env.TLS_ASK_TOKEN)) add("TLS_ASK_TOKEN", "is not set (it protects the certificate-permission endpoint)");
  else {
    const weak = weakSecret(env.TLS_ASK_TOKEN, 24);
    if (weak) add("TLS_ASK_TOKEN", weak);
  }

  // ── where uploaded files go
  const driver = env.ASSET_STORAGE_DRIVER?.trim();
  if (!driver) add("ASSET_STORAGE_DRIVER", "must be set to local or s3 (there is no default in production)");
  else if (driver !== "local" && driver !== "s3") add("ASSET_STORAGE_DRIVER", "must be local or s3");
  else if (driver === "local") {
    const directory = env.ASSET_LOCAL_DIR?.trim();
    if (!directory) add("ASSET_LOCAL_DIR", "must be set to the mounted volume when ASSET_STORAGE_DRIVER=local");
    else if (!directory.startsWith("/")) add("ASSET_LOCAL_DIR", "must be an absolute path (the mounted volume)");
    else if (/assets-test|\.data/.test(directory)) add("ASSET_LOCAL_DIR", "must not be a development or test directory");
  } else {
    if (!present(env.AWS_REGION)) add("AWS_REGION", "must be set when ASSET_STORAGE_DRIVER=s3");
    else if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(env.AWS_REGION.trim())) add("AWS_REGION", "is not an AWS region name");
    if (!present(env.AWS_S3_BUCKET)) add("AWS_S3_BUCKET", "must be set when ASSET_STORAGE_DRIVER=s3");
    else if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.AWS_S3_BUCKET.trim())) add("AWS_S3_BUCKET", "is not a valid bucket name");
  }

  // ── nothing that exists only for development and tests
  if (env.DOMAIN_DNS_RESOLVER && env.DOMAIN_DNS_RESOLVER !== "system") add("DOMAIN_DNS_RESOLVER", "must not be set: the test resolver is for tests only");
  for (const name of TEST_ONLY) if (name !== "DOMAIN_DNS_RESOLVER" && present(env[name])) add(name, "is a development or test setting and must not be set in a deployment");

  return problems;
}

/** The text the process is stopped with: one line per problem, no values. */
export function describeConfigProblems(problems: readonly string[]): string {
  return `The production configuration is not fit to start with (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n${problems.map((problem) => `  - ${problem}`).join("\n")}`;
}
