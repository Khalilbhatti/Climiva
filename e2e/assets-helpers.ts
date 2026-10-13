/**
 * Helpers for the specs that exercise Assets and Branding (assets-upload, branding-settings, assets-public, website-logo, assets-durability).
 *
 * A spec must not change the standing Apex or Northstar businesses (other workers read them in parallel), so the ones that upload make a
 * business of their own: an organization, an owner, an admin and a member, written through the same seed functions the standing ones use.
 * Pictures are made with sharp, so a test uploads a real PNG, JPEG or WebP and not a pretend one.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createDeflate } from "node:zlib";
import type { Pool } from "pg";
import { request as playwrightRequest, type APIRequestContext } from "playwright/test";
import sharp from "sharp";
import { APEX, ensureMembership, ensureOrganization, ensureUser, seedAuth } from "../scripts/db/seed-lib";
import { assetKey } from "../src/storage";
import { createLocalStorage } from "../src/storage/local";
import { normalizeLogo } from "../src/storage/logo-image";
import { signInOverHttp } from "./fixtures";

export const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://localhost:3460";
const PASSWORD = process.env.SEED_PASSWORD ?? "";

/** A picture of a given size and colour, in a given format. */
export async function picture(format: "png" | "jpeg" | "webp" = "png", width = 96, height = 64, color = { r: 13, g: 92, b: 99 }): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 4, background: { ...color, alpha: 1 } } });
  return format === "png" ? image.png().toBuffer() : format === "jpeg" ? image.jpeg().toBuffer() : image.webp().toBuffer();
}

/* PNG files built by hand, so a test can make a file that lies about itself or carries text. */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: Buffer) => {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A VALID grayscale PNG of `width` x `height` that is all one shade, so it deflates to almost nothing: a few hundred KB can stand for hundreds
 * of megabytes of pixels. That is a decompression bomb, and the only defence is to read the header and refuse before decoding.
 */
export async function grayPng(width: number, height: number): Promise<Buffer> {
  const deflate = createDeflate({ level: 9 });
  const parts: Buffer[] = [];
  deflate.on("data", (part: Buffer) => parts.push(part));
  const finished = new Promise<void>((resolve, reject) => {
    deflate.on("end", resolve);
    deflate.on("error", reject);
  });
  const row = Buffer.alloc(1 + width); // a filter byte and the pixels
  for (let y = 0; y < height; y++) if (!deflate.write(row)) await once(deflate, "drain");
  deflate.end();
  await finished;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", Buffer.concat(parts)), pngChunk("IEND", Buffer.alloc(0))]);
}

export type Person = { userId: string; email: string };
export type Business = { organizationId: string; slug: string; platformSlug: string; owner: Person; admin: Person; member: Person };

/** A business of its own with an owner, an admin and a member. It starts with no logo and no accent. */
export async function makeBusiness(label: string, db: Parameters<typeof ensureOrganization>[0]): Promise<Business> {
  const suffix = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const { auth, close } = seedAuth();
  try {
    const slug = `${label}-${suffix}`;
    const organizationId = await ensureOrganization(db, {
      ...APEX,
      name: `Logo Test ${label} ${suffix}`,
      slug,
      fixtureSet: null,
      website: undefined,
      sites: [{ name: "Main", slug: "main", platformSlug: `${label}-${suffix}-site`, isPrimary: true }],
    });
    const people = {} as Record<"owner" | "admin" | "member", Person>;
    for (const role of ["owner", "admin", "member"] as const) {
      const email = `${label}-${role}-${suffix}@example.test`;
      const userId = await ensureUser(auth, db, { email, name: `${role[0].toUpperCase()}${role.slice(1)} ${label}` }, PASSWORD);
      await ensureMembership(db, { organizationId, userId, role });
      people[role] = { userId, email };
    }
    return { organizationId, slug, platformSlug: `${label}-${suffix}-site`, ...people };
  } finally {
    await close();
  }
}

/** A client signed in as `email` (each call comes from an address of its own, so sign-in rate limits never get in the way). */
export async function signedIn(email: string, address: string, origin = ORIGIN, headers: Record<string, string> = {}, cookies: { name: string; value: string }[] = []): Promise<APIRequestContext> {
  const storageState = await signInOverHttp(email, PASSWORD, address);
  // Cookies a test adds to the session (a forged workspace preference, say), as a browser would hold them.
  for (const { name, value } of cookies) storageState.cookies.push({ name, value, domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" });
  return playwrightRequest.newContext({ baseURL: origin, storageState, extraHTTPHeaders: { origin, "x-forwarded-for": address, ...headers } });
}

/** A client with no session, the way a script or a visitor would call. `origin` is sent unless it is left out. */
export async function anonymous(address: string, origin: string | null = ORIGIN): Promise<APIRequestContext> {
  // An explicitly empty session: a context made inside a test would otherwise inherit the signed-in one the project gives every test.
  return playwrightRequest.newContext({ baseURL: ORIGIN, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { ...(origin ? { origin } : {}), "x-forwarded-for": address } });
}

/** The fields of a Branding save. `accent` is always sent (an empty one means the Climvia teal). */
export function brandingForm(options: { logo?: { name: string; mimeType: string; buffer: Buffer }; accent?: string; removeLogo?: boolean; extra?: Record<string, string> } = {}) {
  return {
    accent: options.accent ?? "",
    ...(options.logo ? { logo: options.logo } : {}),
    ...(options.removeLogo ? { removeLogo: "1" } : {}),
    ...(options.extra ?? {}),
  };
}

export const file = (buffer: Buffer, name = "logo.png", mimeType = "image/png") => ({ name, mimeType, buffer });

/** What the server answered, as parsed JSON (or the text if it was not JSON). */
export async function bodyOf(response: { text: () => Promise<string> }): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

/** A second `next start` process on its own port, for what one server cannot show: a failing store, a restart. Always stopped with `stop()`. */
export async function startServer(port: number, env: Record<string, string> = {}, upPath = "/login"): Promise<{ origin: string; stop: () => void }> {
  const origin = `http://localhost:${port}`;
  const child: ChildProcess = spawn("npx", ["next", "start", "-p", String(port)], { shell: true, stdio: "ignore", env: { ...process.env, BETTER_AUTH_URL: origin, ...env } });
  const stop = () => {
    if (!child.pid) return;
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  };
  const isUp = async () => {
    try {
      return (await fetch(`${origin}${upPath}`)).status === 200;
    } catch {
      return false;
    }
  };
  for (let attempt = 0; attempt < 90 && !(await isUp()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!(await isUp())) {
    stop();
    throw new Error(`The extra server on port ${port} did not start.`);
  }
  return { origin, stop };
}

/**
 * A READY logo for a business with a real stored file, written the way the seed does (the object first, then the row), without making it the
 * business's logo. For tests that need to switch a logo without going through the upload.
 */
export async function addReadyLogo(pool: Pool, organizationId: string, options: { filename?: string; color?: { r: number; g: number; b: number } } = {}): Promise<string> {
  const logo = await normalizeLogo(await picture("png", 80, 80, options.color));
  const id = randomUUID();
  const key = assetKey(organizationId, id);
  await createLocalStorage(process.env.ASSET_LOCAL_DIR!).put(key, logo.bytes, { contentType: logo.mediaType });
  await pool.query(
    "insert into assets (id, organization_id, purpose, storage_driver, storage_key, original_filename, media_type, byte_size, width, height, checksum, status, ready_at) values ($1, $2, 'logo', 'local', $3, $4, 'image/webp', $5, $6, $7, $8, 'ready', now())",
    [id, organizationId, key, options.filename ?? "added.png", logo.bytes.byteLength, logo.width, logo.height, logo.checksum],
  );
  return id;
}

/** Make `assetId` (or nothing) the business's logo, as the application's own save does, leaving its accent alone. */
export async function setLogo(pool: Pool, organizationId: string, assetId: string | null): Promise<void> {
  await pool.query(
    "insert into organization_branding (organization_id, logo_asset_id) values ($1, $2) on conflict (organization_id) do update set logo_asset_id = excluded.logo_asset_id",
    [organizationId, assetId],
  );
}
