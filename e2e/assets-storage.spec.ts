/**
 * Phase 18A: the storage seam. What a key can be, how the local driver confines itself, how the S3 driver behaves (against a fake client: real
 * AWS S3 has not been exercised from this machine), and how the driver is chosen. Nothing here needs a browser or a server.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "playwright/test";
import { configuredDriver, currentStorage, DEFAULT_LOCAL_DIRECTORY, storageFor } from "../src/storage";
import { assetKey, isAssetId, parseAssetKey } from "../src/storage/keys";
import { createLocalStorage } from "../src/storage/local";
import { createS3Storage, type S3Like } from "../src/storage/s3";
import { StorageError } from "../src/storage/types";
import { walk, posix, SRC } from "./import-graph";

const org = randomUUID();
const asset = randomUUID();
const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);

/** Everything under `dir`, as relative paths, so a stray file anywhere shows up. */
async function listing(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listing(path)).map((inner) => join(entry.name, inner)));
    else out.push(entry.name);
  }
  return out.sort();
}

test.describe("storage keys", () => {
  test("a key is built from two ids and a variant, and parses back to exactly them", () => {
    const key = assetKey(org, asset);
    expect(key).toBe(`organizations/${org}/assets/${asset}/normalized`);
    expect(parseAssetKey(key)).toEqual({ organizationId: org, assetId: asset, variant: "normalized" });
  });

  test("a key cannot be built from anything that is not a lower-case UUID: a filename, a path, an encoded traversal", () => {
    const hostile = ["../x", "..", "/etc/passwd", "a/b", "%2e%2e%2f", `${org}/../${asset}`, org.toUpperCase(), `${org}\0`, "", " ", "logo.png", `${org}.png`];
    for (const value of hostile) {
      expect(() => assetKey(value, asset), JSON.stringify(value)).toThrow();
      expect(() => assetKey(org, value), JSON.stringify(value)).toThrow();
      expect(isAssetId(value), JSON.stringify(value)).toBe(false);
    }
    expect(() => assetKey(org, asset, "original" as never)).toThrow();
  });

  test("anything that is not exactly a key this application generates does not parse", () => {
    const good = assetKey(org, asset);
    const hostile = [
      "",
      "../" + good,
      "/" + good,
      good + "/",
      good + "/extra",
      good + "/../../..",
      good.replace("normalized", "../normalized"),
      good.replace("normalized", "..%2fnormalized"),
      good.replace("normalized", "Normalized"),
      good.replace(/\//g, "\\"),
      good.replace("organizations", "Organizations"),
      good.replace(org, org.toUpperCase()),
      good.replace(asset, "../" + asset.slice(3)),
      `organizations/${org}/assets/${asset}/normalized\0.png`,
      `organizations/${org}/${asset}/normalized`,
      `organizations/${org}/assets/${org}${asset}/normalized`,
      "x".repeat(500),
    ];
    for (const key of hostile) expect(parseAssetKey(key), JSON.stringify(key)).toBeNull();
    for (const notAString of [null, undefined, 7, {}, [], ["a"]]) expect(parseAssetKey(notAString)).toBeNull();
  });
});

test.describe("the local driver", () => {
  let root: string;
  test.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "climvia-assets-"));
  });
  test.afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("it stores, reads, checks and removes an object, and says so plainly when there is none", async () => {
    const storage = createLocalStorage(root);
    const key = assetKey(org, asset);
    expect(storage.driver).toBe("local");
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.get(key)).toBeNull();
    await storage.put(key, bytes, { contentType: "image/webp" });
    expect(await storage.exists(key)).toBe(true);
    const stored = await storage.get(key);
    expect(Array.from(stored!.body)).toEqual(Array.from(bytes));
    expect(stored!.size).toBe(bytes.byteLength);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await storage.delete(key); // removing what is not there is not an error
  });

  test("an object is written once: a key that is already stored is refused, and the first content stays", async () => {
    const storage = createLocalStorage(root);
    const key = assetKey(org, asset);
    await storage.put(key, bytes, { contentType: "image/webp" });
    await expect(storage.put(key, new Uint8Array([9, 9, 9]), { contentType: "image/webp" })).rejects.toBeInstanceOf(StorageError);
    expect(Array.from((await storage.get(key))!.body)).toEqual(Array.from(bytes));
  });

  test("the bytes are durable: a second driver on the same directory (a restarted process) reads what the first wrote", async () => {
    const key = assetKey(org, asset);
    await createLocalStorage(root).put(key, bytes, { contentType: "image/webp" });
    const restarted = createLocalStorage(root);
    expect(Array.from((await restarted.get(key))!.body)).toEqual(Array.from(bytes));
  });

  test("it leaves no temporary file behind, and writes only under its own directory, in the organization's and the Asset's folders", async () => {
    const storage = createLocalStorage(root);
    await storage.put(assetKey(org, asset), bytes, { contentType: "image/webp" });
    expect(await listing(root)).toEqual([join(org, asset, "normalized")]);
  });

  test("a key that is not one the application generates has no path: nothing is written, read, checked or removed, anywhere", async () => {
    // A sentinel next to the root, and a file in the parent, which a traversal would reach.
    const parent = await mkdtemp(join(tmpdir(), "climvia-parent-"));
    const inner = join(parent, "assets");
    await mkdir(inner);
    await writeFile(join(parent, "secret.txt"), "do not touch");
    const storage = createLocalStorage(inner);
    const hostile = [
      "../secret.txt",
      "../../secret.txt",
      `organizations/${org}/assets/${asset}/../../../../secret.txt`,
      `${org}/${asset}/normalized`,
      "/etc/passwd",
      `C:\\Windows\\win.ini`,
      "..%2fsecret.txt",
      `organizations/${org}/assets/${asset}/normalized\0`,
      "",
    ];
    for (const key of hostile) {
      await expect(storage.put(key, bytes, { contentType: "image/webp" }), JSON.stringify(key)).rejects.toBeInstanceOf(StorageError);
      await expect(storage.get(key), JSON.stringify(key)).rejects.toBeInstanceOf(StorageError);
      await expect(storage.exists(key), JSON.stringify(key)).rejects.toBeInstanceOf(StorageError);
      await expect(storage.delete(key), JSON.stringify(key)).rejects.toBeInstanceOf(StorageError);
    }
    expect(await readFile(join(parent, "secret.txt"), "utf8")).toBe("do not touch");
    expect(await listing(parent)).toEqual(["secret.txt"]);
    expect(await listing(inner)).toEqual([]);
    await rm(parent, { recursive: true, force: true });
  });

  test("two organizations' objects with the same asset id would still be two files in two folders", async () => {
    const storage = createLocalStorage(root);
    const other = randomUUID();
    await storage.put(assetKey(org, asset), bytes, { contentType: "image/webp" });
    await storage.put(assetKey(other, asset), new Uint8Array([7]), { contentType: "image/webp" });
    expect((await storage.get(assetKey(org, asset)))!.size).toBe(bytes.byteLength);
    expect((await storage.get(assetKey(other, asset)))!.size).toBe(1);
  });

  test("the default directory is not under public/, so nothing it holds is served by path", () => {
    expect(DEFAULT_LOCAL_DIRECTORY.split(/[\\/]/)[0]).toBe(".data");
    expect(resolve(DEFAULT_LOCAL_DIRECTORY).startsWith(resolve("public"))).toBe(false);
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.data\/$/m);
    expect(existsSync(join("public", ".data"))).toBe(false);
  });
});

/** A stand-in for the SDK's client: it keeps objects in a map, answers like S3 does, and records what it was sent. */
function fakeS3() {
  const objects = new Map<string, { body: Uint8Array; input: Record<string, unknown> }>();
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const awsError = (name: string, status: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      const key = command.input.Key as string;
      switch (name) {
        case "PutObjectCommand":
          if (command.input.IfNoneMatch === "*" && objects.has(key)) throw awsError("PreconditionFailed", 412);
          objects.set(key, { body: command.input.Body as Uint8Array, input: command.input });
          return {};
        case "GetObjectCommand": {
          const found = objects.get(key);
          if (!found) throw awsError("NoSuchKey", 404);
          return { Body: { transformToByteArray: async () => found.body } };
        }
        case "HeadObjectCommand":
          if (!objects.has(key)) throw awsError("NotFound", 404);
          return {};
        case "DeleteObjectCommand":
          objects.delete(key);
          return {};
        default:
          throw new Error(`unexpected command ${name}`);
      }
    },
  };
  return { client: client as unknown as S3Like, sent, objects };
}

test.describe("the S3 driver (against a fake client; real AWS S3 was not used)", () => {
  test("it stores to the configured bucket under the application's key, as a private object that is written once", async () => {
    const { client, sent, objects } = fakeS3();
    const storage = createS3Storage({ bucket: "climvia-test-bucket", region: "us-east-2", client });
    const key = assetKey(org, asset);
    await storage.put(key, bytes, { contentType: "image/webp" });
    expect(storage.driver).toBe("s3");
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe("PutObjectCommand");
    expect(sent[0].input).toMatchObject({ Bucket: "climvia-test-bucket", Key: key, ContentType: "image/webp", IfNoneMatch: "*" });
    // Private: no ACL of any kind, no public-read, nothing that makes an object readable without the application.
    expect(Object.keys(sent[0].input).filter((name) => /acl|grant/i.test(name))).toEqual([]);
    expect(JSON.stringify(sent[0].input)).not.toMatch(/public/i);
    expect(objects.has(key)).toBe(true);
    await expect(storage.put(key, bytes, { contentType: "image/webp" })).rejects.toBeInstanceOf(StorageError);
  });

  test("it reads, checks and removes, answering 'not there' plainly", async () => {
    const { client } = fakeS3();
    const storage = createS3Storage({ bucket: "b", region: "us-east-2", client });
    const key = assetKey(org, asset);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.exists(key)).toBe(false);
    await storage.put(key, bytes, { contentType: "image/webp" });
    expect(await storage.exists(key)).toBe(true);
    expect(Array.from((await storage.get(key))!.body)).toEqual(Array.from(bytes));
    await storage.delete(key);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  test("a key the application did not generate never reaches S3: the client is not even called", async () => {
    const { client, sent } = fakeS3();
    const storage = createS3Storage({ bucket: "b", region: "us-east-2", client });
    for (const key of ["../x", "/abs", "organizations/x/assets/y/normalized", `organizations/${org}/assets/${asset}/normalized/../..`, ""]) {
      await expect(storage.put(key, bytes, { contentType: "image/webp" })).rejects.toBeInstanceOf(StorageError);
      await expect(storage.get(key)).rejects.toBeInstanceOf(StorageError);
      await expect(storage.exists(key)).rejects.toBeInstanceOf(StorageError);
      await expect(storage.delete(key)).rejects.toBeInstanceOf(StorageError);
    }
    expect(sent).toEqual([]);
  });

  test("other failures are a StorageError, not a raw AWS error, and the message names no bucket or key", async () => {
    const failing = { send: async () => Promise.reject(Object.assign(new Error("AccessDenied: arn:aws:s3:::secret-bucket/organizations/x"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } })) } as unknown as S3Like;
    const storage = createS3Storage({ bucket: "secret-bucket", region: "us-east-2", client: failing });
    for (const call of [() => storage.put(assetKey(org, asset), bytes, { contentType: "image/webp" }), () => storage.get(assetKey(org, asset)), () => storage.exists(assetKey(org, asset)), () => storage.delete(assetKey(org, asset))]) {
      const error = await call().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StorageError);
      expect((error as Error).message).not.toMatch(/secret-bucket|arn:aws|organizations\//);
    }
  });

  test("it needs a bucket and a region, and takes no credentials of its own", () => {
    expect(() => createS3Storage({ bucket: "", region: "us-east-2" })).toThrow(StorageError);
    expect(() => createS3Storage({ bucket: "b", region: "" })).toThrow(StorageError);
    // The code, not the comments that explain what it does not do.
    const source = readFileSync("src/storage/s3.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(source).not.toMatch(/accessKeyId|secretAccessKey|sessionToken|AWS_ACCESS_KEY|AWS_SECRET/);
    expect(source).not.toMatch(/\bACL\b|public-read|PutBucket|ListObjects|CreateBucket/);
  });
});

test.describe("choosing the driver", () => {
  test("outside production the default is local; production must say which driver it uses", () => {
    expect(configuredDriver({ NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv)).toBe("local");
    expect(configuredDriver({} as unknown as NodeJS.ProcessEnv)).toBe("local");
    expect(() => configuredDriver({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toThrow(StorageError);
    expect(configuredDriver({ NODE_ENV: "production", ASSET_STORAGE_DRIVER: "s3" } as unknown as NodeJS.ProcessEnv)).toBe("s3");
    expect(configuredDriver({ NODE_ENV: "production", ASSET_STORAGE_DRIVER: "local" } as unknown as NodeJS.ProcessEnv)).toBe("local");
  });

  test("anything but local or s3 is refused", () => {
    for (const value of ["ftp", "S3", "gcs", "../local", "local;s3"]) expect(() => configuredDriver({ ASSET_STORAGE_DRIVER: value } as unknown as NodeJS.ProcessEnv), value).toThrow(StorageError);
  });

  test("the local driver uses the configured directory, and an Asset is read through the driver it was stored with", async () => {
    const dir = await mkdtemp(join(tmpdir(), "climvia-config-"));
    try {
      const env = { ASSET_STORAGE_DRIVER: "local", ASSET_LOCAL_DIR: dir } as unknown as NodeJS.ProcessEnv;
      const storage = currentStorage(env);
      expect(storage.driver).toBe("local");
      await storage.put(assetKey(org, asset), bytes, { contentType: "image/webp" });
      expect((await stat(join(dir, org, asset, "normalized"))).isFile()).toBe(true);
      // The same directory, asked for by driver name, is the same store.
      expect(Array.from((await storageFor("local", env).get(assetKey(org, asset)))!.body)).toEqual(Array.from(bytes));
      // S3 without a bucket is a configuration error, not a silent fallback to disk.
      expect(() => storageFor("s3", { ASSET_STORAGE_DRIVER: "s3" } as unknown as NodeJS.ProcessEnv)).toThrow(StorageError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test.describe("what the source allows", () => {
  const sources = walk(SRC).map((file) => ({ path: posix(file), text: readFileSync(file, "utf8") }));

  test("only the S3 driver imports the AWS SDK, and only the local driver touches the disk for assets", () => {
    const awsImports = sources.filter((file) => /from\s+["']@aws-sdk|import\(["']@aws-sdk|require\(["']@aws-sdk/.test(file.text)).map((file) => file.path);
    expect(awsImports).toEqual(["src/storage/s3.ts"]);
    const diskWriters = sources.filter((file) => /\b(writeFile|writeFileSync|createWriteStream|appendFile|rename|mkdir|unlink|rmSync|rm)\b\s*\(/.test(file.text) && /node:fs/.test(file.text)).map((file) => file.path);
    expect(diskWriters).toEqual(["src/storage/local.ts"]);
  });

  test("the configuration documents both drivers, asks for no AWS credentials, mounts the local directory, and keeps uploads out of git and images", () => {
    const env = readFileSync(".env.example", "utf8");
    expect(env).toMatch(/^ASSET_STORAGE_DRIVER=local$/m);
    for (const documented of [/^# ASSET_LOCAL_DIR=/m, /^# ASSET_STORAGE_DRIVER=s3$/m, /^# AWS_REGION=/m, /^# AWS_S3_BUCKET=/m, /IAM role/, /PRIVATE/]) expect(env, String(documented)).toMatch(documented);
    // No credential is requested, suggested or shown, commented out or not.
    expect(env).not.toMatch(/^\s*#?\s*(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)\s*=/m);

    const dockerfile = readFileSync("Dockerfile", "utf8");
    const instructions = dockerfile.replace(/^\s*#.*$/gm, "");
    expect(instructions).toMatch(/ASSET_LOCAL_DIR=\/data\/assets/);
    // The directory exists for the unprivileged user, and the production compose file mounts a NAMED volume over it. (There is deliberately no VOLUME
    // instruction: a container started without a mount would get an anonymous volume and look healthy; container-config.spec.ts holds that.)
    expect(instructions).toMatch(/mkdir -p \/data\/assets && chown 10001:10001 \/data\/assets/);
    expect(readFileSync("docker-compose.production.yml", "utf8")).toContain("- assets:/data/assets");
    // The driver is deliberately not baked in (a comment may mention it): production has to choose.
    expect(instructions).not.toMatch(/ASSET_STORAGE_DRIVER/);
    expect(instructions).not.toMatch(/AWS_ACCESS_KEY|AWS_SECRET/);
    // And the files are kept on a named volume, which the production compose file declares.
    expect(readFileSync("docker-compose.production.yml", "utf8")).toMatch(/\n {2}assets:\n/);
    // The development compose file stays PostgreSQL only (server-boundaries.spec.ts holds that).
    expect(readFileSync("docker-compose.yml", "utf8")).not.toMatch(/AWS_ACCESS_KEY|AWS_SECRET|ASSET_/);

    expect(readFileSync(".dockerignore", "utf8")).toMatch(/^\.data$/m);
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.data\/$/m);
  });

  test("nothing under src names a bucket, a credential or an S3 address", () => {
    for (const file of sources) {
      if (file.path === "src/storage/s3.ts") continue;
      // The production configuration rules NAME the AWS key variables, to refuse a deployment that sets them (the instance's role supplies credentials).
      if (file.path === "src/lib/deployment.ts") continue;
      expect(file.text, file.path).not.toMatch(/s3\.amazonaws\.com|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|\.s3\./);
    }
  });
});
