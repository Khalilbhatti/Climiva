/**
 * npm run config:check -- <env-file>
 *
 * Is this env file fit to deploy with? Two sets of rules, both applied before anything is built or started so a bad file is found in seconds,
 * with a list, and not in a container's crash log:
 *
 *   the application's own  src/lib/deployment, applied to exactly the settings the `app` container will receive (scripts/deploy/rules APP_ENVIRONMENT)
 *                          plus the deployment marker the image sets, the same check the application makes when it starts;
 *   the file's             scripts/deploy/rules, about the rest: the database passwords and the connection strings that must agree with them, the
 *                          proxy's name and email, the network the proxy and the application share.
 *
 * It prints each problem (a setting's NAME and the rule it breaks, never its value) and exits 1 if there is any; exit 0 means it may deploy.
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describeConfigProblems, productionConfigProblems } from "../src/lib/deployment";
import { applicationEnvironmentOf, deploymentFileProblems } from "./deploy/rules";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run config:check -- <env-file>");
  process.exit(2);
}

let parsed: Record<string, string | undefined>;
try {
  parsed = parseEnv(readFileSync(file, "utf8"));
} catch {
  console.error(`Could not read ${file}.`);
  process.exit(2);
}

const application = productionConfigProblems({ ...applicationEnvironmentOf(parsed), CLIMVIA_ENV: "production", NODE_ENV: "production" });
const fileProblems = deploymentFileProblems(parsed);
if (application.length > 0 || fileProblems.length > 0) {
  if (application.length > 0) console.error(describeConfigProblems(application));
  if (fileProblems.length > 0) console.error(`The deployment file is not fit (${fileProblems.length} problem${fileProblems.length === 1 ? "" : "s"}):\n${fileProblems.map((problem) => `  - ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("The configuration is fit for a production deployment.");
