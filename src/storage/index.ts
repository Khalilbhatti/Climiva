/**
 * Which storage the application uses, from configuration, and how to get any driver by name.
 *
 *     ASSET_STORAGE_DRIVER   local | s3          where NEW uploads go. Required in production: there is no silent default there.
 *     ASSET_LOCAL_DIR        .data/assets        the local driver's directory (a mounted volume in a container)
 *     AWS_REGION, AWS_S3_BUCKET                  the s3 driver (credentials: the AWS default provider chain, an IAM role in production)
 *
 * Outside production the default is `local`, so development, the seed and the tests need no AWS account. An Asset records the driver it was
 * stored with, and `storageFor(driver)` reads it back through that driver, so changing where new uploads go does not strand the old ones.
 *
 * No `server-only` import on purpose (the seed and the tests use it); nothing under src/ that is a Client Component may import this file, and
 * a test holds that line.
 */
import { join } from "node:path";
import { createLocalStorage } from "./local";
import { createS3Storage } from "./s3";
import { StorageError, type AssetStorage, type StorageDriverName } from "./types";

export type { AssetStorage, StorageDriverName, StoredObject } from "./types";
export { StorageError } from "./types";
export { assetKey, isAssetId, parseAssetKey } from "./keys";
export { createLocalStorage } from "./local";
export { createS3Storage } from "./s3";

export const DEFAULT_LOCAL_DIRECTORY = join(".data", "assets");

/** The driver new uploads use. Production must say; anywhere else the answer is "local". */
export function configuredDriver(env: NodeJS.ProcessEnv = process.env): StorageDriverName {
  const value = env.ASSET_STORAGE_DRIVER?.trim();
  if (!value) {
    if (env.NODE_ENV === "production") throw new StorageError("ASSET_STORAGE_DRIVER must be set to local or s3 in production.");
    return "local";
  }
  if (value !== "local" && value !== "s3") throw new StorageError("ASSET_STORAGE_DRIVER must be local or s3.");
  return value;
}

const cache = new Map<string, AssetStorage>();

/** The driver `name`, built from configuration once per process. */
export function storageFor(driver: StorageDriverName, env: NodeJS.ProcessEnv = process.env): AssetStorage {
  const id = driver === "local" ? `local:${env.ASSET_LOCAL_DIR ?? DEFAULT_LOCAL_DIRECTORY}` : `s3:${env.AWS_S3_BUCKET ?? ""}:${env.AWS_REGION ?? ""}`;
  let storage = cache.get(id);
  if (!storage) {
    storage =
      driver === "local"
        ? createLocalStorage(env.ASSET_LOCAL_DIR?.trim() || DEFAULT_LOCAL_DIRECTORY)
        : createS3Storage({ bucket: env.AWS_S3_BUCKET?.trim() ?? "", region: env.AWS_REGION?.trim() ?? "" });
    cache.set(id, storage);
  }
  return storage;
}

/** The storage new uploads are written to. */
export const currentStorage = (env: NodeJS.ProcessEnv = process.env): AssetStorage => storageFor(configuredDriver(env), env);
