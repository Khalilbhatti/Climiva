import "server-only";
import { access, constants } from "node:fs/promises";
import { isTlsEligible } from "@/db/public-queries";
import { isProductionDeployment, productionConfigProblems } from "@/lib/deployment";
import { DEFAULT_LOCAL_DIRECTORY, configuredDriver } from "@/storage";

/**
 * Can this process serve right now? Three narrow questions, each answered yes or no:
 *
 *   config     the environment is fit for what this is (in a production deployment: every rule in lib/deployment),
 *   database   the restricted runtime role can connect and run one of the public database functions (the newest migration's, so a database that
 *              is up but not migrated yet is not ready); the question asked is about a name that can not exist, so it reads nothing of anyone's,
 *   storage    uploaded files have somewhere to go (the local directory exists and is writable in a deployment; the S3 settings are present).
 *
 * The answer never says why: no error text, no path, no address and no name leaves this module, because it is served to anyone who can reach the
 * port. The reason goes to the log, once each time the answer changes (a poller asks every few seconds).
 *
 * "Alive" (the process runs) is a different, cheaper question and is answered by /health/live without asking the database anything.
 */

export type Check = "ok" | "fail";
export type Readiness = { ready: boolean; checks: { config: Check; database: Check; storage: Check } };

const TIMEOUT_MS = 3000;

/** The answer of `work`, or a failure after the time limit: a database that hangs must not hang the check. */
function within<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

async function databaseReady(): Promise<boolean> {
  try {
    await within(isTlsEligible("readiness.invalid"));
    return true;
  } catch {
    return false;
  }
}

async function storageReady(env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    if (configuredDriver(env) === "s3") return Boolean(env.AWS_S3_BUCKET?.trim() && env.AWS_REGION?.trim());
    const directory = env.ASSET_LOCAL_DIR?.trim() || DEFAULT_LOCAL_DIRECTORY;
    try {
      await access(directory, constants.W_OK);
      return true;
    } catch (error) {
      // The directory is created on the first upload when developing; in a deployment it is a mounted volume and must already be there.
      return !isProductionDeployment(env) && (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  } catch {
    return false;
  }
}

/** Which checks failed the last time anyone asked (names only, never tenant data), so the log says it when the answer changes and not at every poll. */
const last = { failing: "" };

export async function checkReadiness(env: NodeJS.ProcessEnv = process.env): Promise<Readiness> {
  const [database, storage] = await Promise.all([databaseReady(), storageReady(env)]);
  const config = productionConfigProblems(env).length === 0;
  const checks: Readiness["checks"] = { config: config ? "ok" : "fail", database: database ? "ok" : "fail", storage: storage ? "ok" : "fail" };
  const failing = Object.entries(checks).filter(([, answer]) => answer === "fail").map(([name]) => name).join(",");
  if (failing !== last.failing) {
    last.failing = failing;
    if (failing) console.error(`[health] not ready: ${failing}`);
    else console.error("[health] ready again");
  }
  return { ready: failing === "", checks };
}

/** The deployed version (a commit id the image was built from), or "development". Only a safe token ever leaves. */
export function deployedVersion(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.APP_VERSION?.trim();
  return value && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : "development";
}
