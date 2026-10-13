/**
 * The sample logo: a real Asset for the Apex workspace (and for each test worker's copy of it), so the sample business shows a logo the same way
 * every other business does, from a row and a stored file, and not from a name in the code.
 *
 * SEED AND TEST INFRASTRUCTURE ONLY (nothing in src/ imports this file). The crest is a small SVG kept beside the other seed data. The seed
 * rasterizes it to a PNG and stores it through the SAME pipeline an upload takes (src/storage/logo-image), so the stored file is a normalized
 * WebP like any other. An SVG is never accepted as an upload and none is ever served; this is the one place one is read, and it is ours.
 *
 * Idempotent, and consistent: the Asset's id is derived from its organization (the same every time the database is rebuilt), the object is
 * written only when it is not already stored, and the row always describes the object that is there (its size, dimensions and checksum are read
 * from the stored bytes). Running the seed twice changes nothing the second time; a database that is rebuilt finds its objects still in place
 * and describes them again. The seed refuses to point a row at an object that is not there: the object is stored first, as the application does.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import { DEFAULT_ACCENT } from "../../src/data/settings";
import { assets, organizationBranding } from "../../src/db/schema";
import { stableId } from "../../src/db/stable-id";
import { assetKey, currentStorage } from "../../src/storage";
import { normalizeLogo } from "../../src/storage/logo-image";
import { APEX_CREST_FILE_NAME } from "./seed-data/apex";
import type { adminDb } from "./lib";

type AdminDb = ReturnType<typeof adminDb>["db"];

// Like every db:* script, this runs from the repository root.
const CREST_SVG = join("scripts", "db", "seed-data", "apex-crest.svg");

/** The sample logo's id for a business: derived, never random, so a rebuilt database describes the same Asset. */
export const sampleLogoId = (organizationId: string): string => stableId(organizationId, "asset", "logo");

let crest: ReturnType<typeof normalizeLogo> | undefined;
/** The crest as it is stored: rasterized once per process, then through the normal pipeline. */
function crestLogo() {
  crest ??= sharp(readFileSync(CREST_SVG), { density: 300 }).resize(512, 512).png().toBuffer().then((png) => normalizeLogo(png));
  return crest;
}

/** Store the sample logo for `organizationId` and make it that business's logo, with the Apex accent. Returns the Asset's id. */
export async function ensureSampleLogo(db: AdminDb, organizationId: string): Promise<string> {
  const storage = currentStorage();
  const assetId = sampleLogoId(organizationId);
  const key = assetKey(organizationId, assetId);

  // The object first. When it is already there it is the truth: the row is written to match it.
  let bytes: Uint8Array;
  const present = await storage.get(key);
  if (present) {
    bytes = present.body;
  } else {
    const logo = await crestLogo();
    await storage.put(key, logo.bytes, { contentType: logo.mediaType });
    bytes = logo.bytes;
  }
  const { width, height } = await sharp(bytes).metadata();
  const description = {
    storageDriver: storage.driver,
    mediaType: "image/webp" as const,
    byteSize: bytes.byteLength,
    width: width ?? null,
    height: height ?? null,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(assets)
      .values({ id: assetId, organizationId, purpose: "logo", storageKey: key, originalFilename: APEX_CREST_FILE_NAME, status: "ready", readyAt: new Date(), ...description })
      .onConflictDoUpdate({ target: assets.id, set: { originalFilename: APEX_CREST_FILE_NAME, ...description } });
    await tx
      .insert(organizationBranding)
      .values({ organizationId, logoAssetId: assetId, accent: DEFAULT_ACCENT })
      .onConflictDoUpdate({ target: organizationBranding.organizationId, set: { logoAssetId: assetId, accent: DEFAULT_ACCENT } });
  });
  return assetId;
}

/** Put a test worker's Branding back to the sample logo and accent, before every test. The Asset itself was stored by `ensureSampleLogo`. */
export async function restoreSampleBranding(db: AdminDb, organizationId: string): Promise<void> {
  const assetId = sampleLogoId(organizationId);
  await db
    .insert(organizationBranding)
    .values({ organizationId, logoAssetId: assetId, accent: DEFAULT_ACCENT })
    .onConflictDoUpdate({ target: organizationBranding.organizationId, set: { logoAssetId: assetId, accent: DEFAULT_ACCENT } });
}
