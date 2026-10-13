/**
 * npm run db:reset
 *
 * DEVELOPMENT ONLY. Drops the database named by DATABASE_ADMIN_URL, recreates it, applies every migration and seeds it.
 * Use it to get back to a known state. Refuses to run when NODE_ENV=production.
 */
import { join } from "node:path";
import { adminUrl, clearLocalAssetDirectory, databaseName, loadEnv, migrateDatabase, recreateDatabase, requireEnv } from "./lib";
import { seedDevelopmentData } from "./seed-lib";

async function main() {
  loadEnv();
  if (process.env.NODE_ENV === "production") throw new Error("db:reset must never run in production.");
  const name = databaseName(adminUrl());
  // A rebuilt database must not find files that belong to rows it no longer has. Only a local directory inside .data/ is cleared; an S3 bucket never is.
  if ((process.env.ASSET_STORAGE_DRIVER ?? "local") === "local") await clearLocalAssetDirectory(process.env.ASSET_LOCAL_DIR?.trim() || join(".data", "assets"));
  await recreateDatabase(name);
  await migrateDatabase(adminUrl(), requireEnv("POSTGRES_APP_PASSWORD"));
  await seedDevelopmentData();
  console.log(`Database "${name}" was reset and seeded.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
