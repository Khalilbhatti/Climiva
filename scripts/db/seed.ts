/**
 * npm run db:seed
 *
 * Inserts the development data (see seed-lib.ts) into the database named by DATABASE_ADMIN_URL. Idempotent.
 * Refuses to run when NODE_ENV=production.
 */
import { loadEnv } from "./lib";
import { SEED_USERS, seedDevelopmentData } from "./seed-lib";

async function main() {
  loadEnv();
  const result = await seedDevelopmentData();
  console.log("Seeded.");
  console.log(`  Apex Climate Heating & Air   ${result.apexId}`);
  console.log(`  Northstar Heating & Cooling  ${result.northstarId}`);
  console.log("  Sign in with any of these (password: SEED_PASSWORD from your .env):");
  for (const user of Object.values(SEED_USERS)) console.log(`    ${user.email}  (${user.name})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
