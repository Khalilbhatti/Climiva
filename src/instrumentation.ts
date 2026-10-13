/**
 * Runs once when the server process starts, before it serves anything. In a production deployment (the container image sets
 * CLIMVIA_ENV=production) it refuses to start on an unfit configuration: a missing or weak secret, the owner's database credential, a test
 * switch, an http address. The work is in src/instrumentation-node.ts, which lists what is wrong (never a value) and exits, so a misconfigured
 * container fails at once and loudly instead of serving with a demo value. Outside a deployment nothing is checked, so development and the
 * browser tests are unaffected.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { refuseToStartOnBadConfiguration } = await import("./instrumentation-node");
  refuseToStartOnBadConfiguration();
}
