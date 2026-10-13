/**
 * The storage seam. Business code asks for these four things and never knows whether the bytes are in a directory on this machine or in a
 * private S3 bucket: the AWS SDK is imported by src/storage/s3.ts alone.
 *
 * Keys are the application's (src/storage/keys), the bytes are small enough to hold in memory (a normalized logo), and an object is written
 * once: its key contains the Asset's own id, so content is never replaced under a name that has already been handed out.
 */

export type StorageDriverName = "local" | "s3";

export type StoredObject = { body: Uint8Array; size: number };

export interface AssetStorage {
  readonly driver: StorageDriverName;
  /** Store `body` under `key`. Refuses a key that is already stored, and a key that is not one the application generates. */
  put(key: string, body: Uint8Array, options: { contentType: string }): Promise<void>;
  /** The stored bytes, or null when there is no such object. Never throws for "not found". */
  get(key: string): Promise<StoredObject | null>;
  /** Whether the object is stored (without reading it). */
  exists(key: string): Promise<boolean>;
  /** Remove the object. Removing one that is not there is not an error. */
  delete(key: string): Promise<void>;
}

/** Something went wrong in the store (not "not found"). The message is for the server's log, never for a person: it may name a path or a bucket. */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}
