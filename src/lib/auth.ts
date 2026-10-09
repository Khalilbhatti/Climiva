/**
 * Authentication: Better Auth with email + password, sessions in PostgreSQL.
 *
 * Climvia does not hash passwords, mint tokens or manage cookies itself. Better Auth does, and this file only
 * configures it. What it provides here: sign up, sign in, sign out and database-backed sessions (a signed, httpOnly,
 * SameSite=Lax cookie that maps to a row in `auth_session`; Secure automatically when the app is served over https).
 * Its built-in protections stay ON: the origin / fetch-metadata (CSRF) checks, and rate limiting on the auth endpoints.
 * Anonymous usage reporting is off by default and is never switched on.
 *
 * A session says WHO someone is. It says nothing about which business they may enter: that is a membership, checked
 * on every request by the server code in src/server (see docs/saas-architecture.md, "Authorization").
 *
 * `createAuth` takes its connection and secrets as arguments so the seed script and tests can build an instance of
 * their own; the app uses the memoised `getAuth()`. Nothing here may be imported by a Client Component.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, type Database } from "@/db";
import { authAccount, authSession, authUser, authVerification, profiles } from "@/db/schema";
import { runAsUser } from "@/db/tenant";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./auth-rules";

export type AuthConfig = {
  db: Database;
  secret: string;
  /** The public origin, e.g. https://app.example.com. Auth endpoints only accept requests from here (and `trustedOrigins`). */
  baseURL: string;
  trustedOrigins?: string[];
  /**
   * Reverse proxies in front of the app (IPs or CIDR ranges), so rate limiting can tell real clients apart. Behind a
   * proxy that appends to X-Forwarded-For, list it here; without this a multi-hop header cannot be trusted and every
   * client shares one rate-limit bucket. Leave empty when the app is reached directly.
   */
  trustedProxies?: string[];
  /** Scripts (the seed) have no Next.js request to set cookies on; the app leaves this on. */
  nextCookies?: boolean;
};

export function createAuth(config: AuthConfig) {
  const development = process.env.NODE_ENV !== "production";
  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    // Any port on localhost is fine while developing (the port varies by machine); production allows only what is configured.
    trustedOrigins: [config.baseURL, ...(config.trustedOrigins ?? []), ...(development ? ["http://localhost:*"] : [])],
    advanced: { ipAddress: { trustedProxies: config.trustedProxies?.length ? config.trustedProxies : undefined } },
    // Better Auth gets plain table objects; its model names (user, session, account, verification) map onto ours.
    database: drizzleAdapter(config.db, {
      provider: "pg",
      schema: { user: authUser, session: authSession, account: authAccount, verification: authVerification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // No email can be sent yet, so an address cannot be confirmed. Revisit when email (SES) is added.
      requireEmailVerification: false,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // No cookie cache: the database row is the single source of truth, so a sign-out or expiry takes effect at once.
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      user: {
        create: {
          // Every account gets its Climvia profile (display name only). The server also creates a missing one on demand.
          after: async (user) => {
            try {
              await runAsUser(config.db, user.id, (tx) =>
                tx.insert(profiles).values({ userId: user.id, fullName: user.name.trim().slice(0, 80) || "New user" }).onConflictDoNothing(),
              );
            } catch (error) {
              console.error("[auth] could not create the profile for a new user:", error instanceof Error ? error.message : error);
            }
          },
        },
      },
    },
    // Must be last: lets server actions that call auth.api.* set or clear the session cookie.
    plugins: config.nextCookies === false ? [] : [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { climviaAuth?: Auth };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

/** The application's single Better Auth instance, created on first use. */
export function getAuth(): Auth {
  if (!globalForAuth.climviaAuth) {
    const secret = requiredEnv("BETTER_AUTH_SECRET");
    if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
    globalForAuth.climviaAuth = createAuth({
      db: getDb(),
      secret,
      baseURL: requiredEnv("BETTER_AUTH_URL"),
      trustedOrigins: listFromEnv("AUTH_TRUSTED_ORIGINS"),
      trustedProxies: listFromEnv("AUTH_TRUSTED_PROXIES"),
    });
  }
  return globalForAuth.climviaAuth;
}
