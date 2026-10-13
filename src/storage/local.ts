/**
 * The local storage driver: a directory on this machine. Development, the tests, and the Docker fallback when a volume is mounted.
 *
 * Durable (the files are on disk and survive a restart of the application), never served directly (the directory is not under `public/`
 * and no route reads it by path), and confined: a key is parsed by src/storage/keys, so the only path this file ever builds is
 * `<root>/<organization id>/<asset id>/<variant>` from two UUIDs and a fixed word, and it checks the result is still inside the root.
 * A file is written to a temporary name and renamed, so a reader never sees half of one.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseAssetKey } from "./keys";
import { StorageError, type AssetStorage, type StoredObject } from "./types";

export function createLocalStorage(directory: string): AssetStorage {
  const root = resolve(directory);

  /** The file for a key, or throws: a key this application did not generate has no path. */
  function pathOf(key: string): string {
    const parsed = parseAssetKey(key);
    if (!parsed) throw new StorageError("Not a storage key.");
    const path = resolve(join(root, parsed.organizationId, parsed.assetId, parsed.variant));
    const inside = relative(root, path);
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside) || inside.split(sep).includes("..")) throw new StorageError("A storage key resolved outside the storage directory.");
    return path;
  }

  const isMissing = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");

  return {
    driver: "local",

    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      if (await this.exists(key)) throw new StorageError("That object is already stored.");
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, body, { flag: "wx" });
        await rename(temporary, path);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw new StorageError("The object could not be written.", { cause: error });
      }
    },

    async get(key): Promise<StoredObject | null> {
      const path = pathOf(key);
      try {
        const body = await readFile(path);
        return { body, size: body.byteLength };
      } catch (error) {
        if (isMissing(error)) return null;
        throw new StorageError("The object could not be read.", { cause: error });
      }
    },

    async exists(key) {
      try {
        return (await stat(pathOf(key))).isFile();
      } catch (error) {
        if (isMissing(error)) return false;
        throw new StorageError("The object could not be checked.", { cause: error });
      }
    },

    async delete(key) {
      try {
        await unlink(pathOf(key));
      } catch (error) {
        if (!isMissing(error)) throw new StorageError("The object could not be removed.", { cause: error });
      }
    },
  };
}
