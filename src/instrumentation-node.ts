import { describeConfigProblems, productionConfigProblems } from "@/lib/deployment";

/**
 * Print every way the environment is unfit for a production deployment (names and rules, never values) and EXIT with a failure.
 *
 * Throwing from the instrumentation hook is not enough: Next.js logs an unhandled rejection and the process keeps running, a server that is "up"
 * and half-prepared. A container must stop, so the orchestrator, the healthcheck and the deploy script all see a failed start. Nothing else is
 * checked here: outside a production deployment (CLIMVIA_ENV is not "production") the list is empty and this returns.
 */
export function refuseToStartOnBadConfiguration(): void {
  const problems = productionConfigProblems();
  if (problems.length === 0) return;
  console.error(describeConfigProblems(problems));
  process.exit(1);
}
