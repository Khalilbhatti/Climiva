/**
 * What a production env FILE (`.env.production`, read by docker-compose.production.yml and the deploy scripts) must look like, beyond what the
 * application checks about its own environment (src/lib/deployment.ts). Pure: no file, no network. `npm run config:check` and a spec apply it.
 *
 * The file holds settings for four services. Compose hands each service only the names it needs, so the application never receives the owner's
 * database password (see APP_ENVIRONMENT, which the compose file's `app` service must match exactly: a spec holds them together).
 */
import { RUNTIME_ROLE } from "../../src/lib/deployment";

type Env = Record<string, string | undefined>;

/** The settings the `app` container receives from the file, and nothing else (the image and compose add NODE_ENV, CLIMVIA_ENV, PORT, HOSTNAME and APP_VERSION). */
export const APP_ENVIRONMENT = [
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "AUTH_TRUSTED_PROXIES",
  "AUTH_TRUSTED_ORIGINS",
  "APP_HOSTS",
  "CUSTOM_DOMAIN_TARGET",
  "CUSTOM_DOMAIN_URL_SCHEME",
  "TLS_ASK_TOKEN",
  "ASSET_STORAGE_DRIVER",
  "ASSET_LOCAL_DIR",
  "AWS_REGION",
  "AWS_S3_BUCKET",
] as const;

/** The compose network the reverse proxy and the application share; the proxy is the only thing on it that may set a client's address. */
export const DEFAULT_EDGE_SUBNET = "172.30.0.0/24";

const PLACEHOLDER = /^(replace|change|your[-_]|example|placeholder|todo|xxx)|change[-_]?me/i;
const present = (value: string | undefined): value is string => typeof value === "string" && value.trim() !== "";

/** A database password is generated, long and URL-safe, so the connection strings need no escaping. */
function passwordProblem(name: string, value: string | undefined): string | null {
  if (!present(value)) return `${name} is not set.`;
  if (value.length < 24) return `${name} must be at least 24 characters (generate one: openssl rand -hex 24).`;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return `${name} may use letters, digits, - and _ only, so it can sit in a connection string unescaped.`;
  if (PLACEHOLDER.test(value)) return `${name} is still a placeholder from an example file.`;
  if (new Set(value).size < 8) return `${name} has too little variety to be random.`;
  return null;
}

type Parts = { user: string; password: string; host: string; port: string; database: string };

function partsOf(name: string, value: string | undefined, problems: string[]): Parts | null {
  if (!present(value)) {
    problems.push(`${name} is not set.`);
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("protocol");
    return { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), host: url.hostname, port: url.port || "5432", database: url.pathname.replace(/^\//, "") };
  } catch {
    problems.push(`${name} is not a valid postgres:// URL.`);
    return null;
  }
}

/** Every way the file is unfit. Each entry names the setting and the rule; none contains a value. */
export function deploymentFileProblems(env: Env): string[] {
  const problems: string[] = [];
  const add = (text: string | null) => {
    if (text) problems.push(text);
  };

  if (!present(env.POSTGRES_DB) || !/^[a-z][a-z0-9_]{0,62}$/.test(env.POSTGRES_DB)) problems.push("POSTGRES_DB must be a lower-case identifier (letters, digits, underscore; not starting with a digit).");
  if (!present(env.POSTGRES_OWNER_USER) || !/^[a-z][a-z0-9_]{0,62}$/.test(env.POSTGRES_OWNER_USER)) problems.push("POSTGRES_OWNER_USER must be a lower-case identifier.");
  else if (env.POSTGRES_OWNER_USER === RUNTIME_ROLE) problems.push(`POSTGRES_OWNER_USER must not be ${RUNTIME_ROLE}: the owner and the restricted runtime role are two different roles.`);
  add(passwordProblem("POSTGRES_OWNER_PASSWORD", env.POSTGRES_OWNER_PASSWORD));
  add(passwordProblem("POSTGRES_APP_PASSWORD", env.POSTGRES_APP_PASSWORD));
  if (present(env.POSTGRES_OWNER_PASSWORD) && env.POSTGRES_OWNER_PASSWORD === env.POSTGRES_APP_PASSWORD) problems.push("POSTGRES_OWNER_PASSWORD and POSTGRES_APP_PASSWORD must differ.");

  // The two connection strings must say what the compose file builds: the application connects to the `db` service as the restricted role, the
  // migration as the owner, to the same database, with the passwords this file lists.
  const app = partsOf("DATABASE_URL", env.DATABASE_URL, problems);
  if (app) {
    if (app.host !== "db" || app.port !== "5432") problems.push("DATABASE_URL must point at the compose service: host db, port 5432.");
    if (app.user !== RUNTIME_ROLE) problems.push(`DATABASE_URL must connect as ${RUNTIME_ROLE}.`);
    if (app.database !== env.POSTGRES_DB) problems.push("DATABASE_URL must name the database POSTGRES_DB.");
    if (app.password !== env.POSTGRES_APP_PASSWORD) problems.push("DATABASE_URL must use the password POSTGRES_APP_PASSWORD.");
  }
  const admin = partsOf("DATABASE_ADMIN_URL", env.DATABASE_ADMIN_URL, problems);
  if (admin) {
    if (admin.host !== "db" || admin.port !== "5432") problems.push("DATABASE_ADMIN_URL must point at the compose service: host db, port 5432.");
    if (admin.user !== env.POSTGRES_OWNER_USER) problems.push("DATABASE_ADMIN_URL must connect as POSTGRES_OWNER_USER.");
    if (admin.database !== env.POSTGRES_DB) problems.push("DATABASE_ADMIN_URL must name the database POSTGRES_DB.");
    if (admin.password !== env.POSTGRES_OWNER_PASSWORD) problems.push("DATABASE_ADMIN_URL must use the password POSTGRES_OWNER_PASSWORD.");
  }

  // The reverse proxy serves the application's own name and must be the only thing the application trusts to name a client's address.
  let publicHost = "";
  try {
    publicHost = new URL(env.BETTER_AUTH_URL ?? "").hostname;
  } catch {
    // BETTER_AUTH_URL is the application's own rule; the proxy's name is then unknowable, and the comparison below reports it.
  }
  if (!present(env.PUBLIC_HOST) || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(env.PUBLIC_HOST)) problems.push("PUBLIC_HOST must be the application's domain name, in lower case.");
  else if (publicHost && env.PUBLIC_HOST !== publicHost) problems.push("PUBLIC_HOST must be the host of BETTER_AUTH_URL.");
  if (!present(env.ACME_EMAIL) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ACME_EMAIL) || /@example\./i.test(env.ACME_EMAIL)) problems.push("ACME_EMAIL must be a real address (the certificate authority writes to it about expiring certificates).");
  const subnet = env.EDGE_SUBNET?.trim() || DEFAULT_EDGE_SUBNET;
  if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(subnet)) problems.push("EDGE_SUBNET must be an IPv4 range such as 172.30.0.0/24.");
  else if (!(env.AUTH_TRUSTED_PROXIES ?? "").split(",").map((item) => item.trim()).includes(subnet)) problems.push(`AUTH_TRUSTED_PROXIES must list the proxy network ${subnet}, so sign-in rate limits see each real client.`);

  // Nothing in this file may be the kind of credential an instance role makes unnecessary.
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) if (present(env[name])) problems.push(`${name} must not be set: on AWS the instance's role supplies credentials.`);

  return problems;
}

/** The names of the file's settings the application receives, with their values: what the application would see. */
export function applicationEnvironmentOf(env: Env): Record<string, string | undefined> {
  return Object.fromEntries(APP_ENVIRONMENT.map((name) => [name, env[name]]));
}
