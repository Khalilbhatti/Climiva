/**
 * The S3 storage driver: a PRIVATE bucket, reached by the application's own credentials. This is the only file that imports the AWS SDK.
 *
 *  - The bucket is private. Nothing here sets an ACL, `public-read` or a bucket policy, and nothing lists the bucket; the browser never
 *    gets an S3 address, because every byte is served through the application's own route (src/app/(public)/assets).
 *  - Credentials are the SDK's default provider chain: an IAM role on the instance in production (no keys in configuration), environment
 *    or a profile in a developer's shell. Nothing here reads or stores a secret.
 *  - The bucket and region come from configuration (src/storage/index), never from a request; and a key is parsed by src/storage/keys, so
 *    only a key this application generates reaches S3.
 *  - An object is written once (`If-None-Match: *`), so an Asset's content cannot be replaced under its id.
 *  - The SDK is loaded the first time S3 is used, so a process that only ever uses the local driver never loads it.
 *
 * The bucket itself (its creation, its encryption, its public-access block, the role's policy) is infrastructure and is provisioned outside the
 * application. Real S3 has not been exercised from this repository's development machine; the driver is tested against a fake client.
 */
import type { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import { parseAssetKey } from "./keys";
import { StorageError, type AssetStorage, type StoredObject } from "./types";

/** The slice of the SDK client this driver uses, so a test can stand in for it. */
export type S3Like = Pick<S3Client, "send">;

export type S3StorageOptions = { bucket: string; region: string; client?: S3Like; clientConfig?: S3ClientConfig };

const errorName = (error: unknown): string => (typeof error === "object" && error !== null && "name" in error ? String(error.name) : "");
const httpStatus = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "$metadata" in error ? (error.$metadata as { httpStatusCode?: number } | undefined)?.httpStatusCode : undefined;
const isNotFound = (error: unknown) => ["NoSuchKey", "NotFound"].includes(errorName(error)) || httpStatus(error) === 404;

export function createS3Storage(options: S3StorageOptions): AssetStorage {
  const { bucket } = options;
  if (!bucket) throw new StorageError("The S3 driver needs a bucket (AWS_S3_BUCKET).");
  if (!options.region) throw new StorageError("The S3 driver needs a region (AWS_REGION).");

  let loaded: Promise<{ sdk: typeof import("@aws-sdk/client-s3"); client: S3Like }> | undefined;
  /** The SDK and the client, made on first use. No credentials are passed: the default provider chain finds them (an IAM role in production). */
  const connect = () =>
    (loaded ??= import("@aws-sdk/client-s3").then((sdk) => ({ sdk, client: options.client ?? new sdk.S3Client({ region: options.region, ...options.clientConfig }) })));

  /** The object name for a key, or throws: a key this application did not generate is never sent to S3. */
  function keyOf(key: string): string {
    if (!parseAssetKey(key)) throw new StorageError("Not a storage key.");
    return key;
  }

  return {
    driver: "s3",

    async put(key, body, { contentType }) {
      const name = keyOf(key);
      try {
        const { sdk, client } = await connect();
        await client.send(
          new sdk.PutObjectCommand({
            Bucket: bucket,
            Key: name,
            Body: body,
            ContentType: contentType,
            // The bytes are served by the application, which sets the headers a browser sees; the object only needs to say what it is.
            CacheControl: "private, max-age=0",
            ContentDisposition: "inline",
            IfNoneMatch: "*",
          }),
        );
      } catch (error) {
        throw new StorageError("The object could not be written.", { cause: error });
      }
    },

    async get(key): Promise<StoredObject | null> {
      const name = keyOf(key);
      try {
        const { sdk, client } = await connect();
        const result = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: name }));
        if (!result.Body) return null;
        const body = await result.Body.transformToByteArray();
        return { body, size: body.byteLength };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw new StorageError("The object could not be read.", { cause: error });
      }
    },

    async exists(key) {
      const name = keyOf(key);
      try {
        const { sdk, client } = await connect();
        await client.send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: name }));
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw new StorageError("The object could not be checked.", { cause: error });
      }
    },

    async delete(key) {
      const name = keyOf(key);
      try {
        const { sdk, client } = await connect();
        await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: name }));
      } catch (error) {
        if (!isNotFound(error)) throw new StorageError("The object could not be removed.", { cause: error });
      }
    },
  };
}
