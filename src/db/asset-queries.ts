/**
 * Assets and Organization Branding: the queries.
 *
 * Every function takes an open transaction (`tx`) and the organization it works for, and names that organization in every statement's WHERE
 * clause. They are meant to be called from `withTenant(...)`, where PostgreSQL's Row Level Security then enforces the same boundary a second
 * time (see src/db/tenant.ts and drizzle/0018); the explicit `organization_id` predicates are the first layer, not a substitute for it. The
 * seed calls the same functions on the owner connection, so the data it writes is exactly what the application reads and writes.
 *
 * The database cannot take part in the same transaction as the object store, so the upload is sequenced by src/server/branding.ts:
 *
 *     createPendingAsset  (a row that says "bytes are on their way", never rendered, never a logo)
 *     ... the bytes are stored ...
 *     activateLogo        (ONE transaction: the row becomes ready AND the Branding points at it)
 *
 * so there is no moment at which the Branding points at a pending or failed Asset, and none at which a ready Asset is not yet the logo it
 * was uploaded to be.
 *
 * No `server-only` import on purpose (the seed and the tests use these); nothing under src/ that is a Client Component may import this file.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Branding } from "@/data/settings";
import { assetUrl } from "@/lib/asset-rules";
import type { AssetStorageDriver } from "./schema";
import { assets, organizationBranding } from "./schema";
import type { Tx } from "./index";

export type NewAsset = {
  id: string;
  organizationId: string;
  userId: string | null;
  driver: AssetStorageDriver;
  storageKey: string;
  originalFilename: string | null;
  mediaType: "image/webp" | "image/png" | "image/jpeg";
  byteSize: number;
  width: number | null;
  height: number | null;
  checksum: string;
};

/** A new Asset is born PENDING: its bytes are not stored yet, so nothing may render it or use it as a logo. */
export async function createPendingAsset(tx: Tx, asset: NewAsset): Promise<void> {
  await tx.insert(assets).values({
    id: asset.id,
    organizationId: asset.organizationId,
    purpose: "logo",
    storageDriver: asset.driver,
    storageKey: asset.storageKey,
    originalFilename: asset.originalFilename,
    mediaType: asset.mediaType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    checksum: asset.checksum,
    status: "pending",
    createdByUserId: asset.userId,
  });
}

/** The upload did not complete. A failed Asset is never served and never referenced. Only a pending one can fail. */
export async function markAssetFailed(tx: Tx, organizationId: string, assetId: string): Promise<void> {
  await tx
    .update(assets)
    .set({ status: "failed" })
    .where(and(eq(assets.organizationId, organizationId), eq(assets.id, assetId), eq(assets.status, "pending")));
}

/** What a save does to the logo: leave it, take it away, or point at a new ready Asset. */
export type LogoChange = { kind: "keep" } | { kind: "remove" } | { kind: "set"; assetId: string };

/**
 * Write the business's Branding in one statement: the accent, and what the logo becomes. The row is created the first time and updated after, and
 * the statement takes the row's lock, so two saves at once are applied one after the other (the later one wins), never interleaved.
 */
export async function writeBranding(tx: Tx, organizationId: string, accent: string | null, logo: LogoChange): Promise<void> {
  const base = { organizationId, accent };
  if (logo.kind === "keep") {
    await tx.insert(organizationBranding).values({ ...base, logoAssetId: null }).onConflictDoUpdate({ target: organizationBranding.organizationId, set: { accent } });
    return;
  }
  const logoAssetId = logo.kind === "set" ? logo.assetId : null;
  await tx.insert(organizationBranding).values({ ...base, logoAssetId }).onConflictDoUpdate({ target: organizationBranding.organizationId, set: { accent, logoAssetId } });
}

/**
 * The upload succeeded: the Asset becomes ready and the Branding points at it, in this one transaction. Returns false when the Asset was not
 * pending (it was already failed, deleted or someone else's), in which case nothing is changed.
 */
export async function activateLogo(tx: Tx, organizationId: string, assetId: string, accent: string | null): Promise<boolean> {
  const ready = await tx
    .update(assets)
    .set({ status: "ready", readyAt: sql`now()` })
    .where(and(eq(assets.organizationId, organizationId), eq(assets.id, assetId), eq(assets.status, "pending")))
    .returning({ id: assets.id });
  if (ready.length === 0) return false;
  await writeBranding(tx, organizationId, accent, { kind: "set", assetId });
  return true;
}

/** The business's Branding as Settings holds it: the accent, and the logo only while it is a READY Asset. No row means no accent and no logo. */
export async function loadBranding(tx: Tx, organizationId: string): Promise<Branding> {
  const [row] = await tx
    .select({ accent: organizationBranding.accent, assetId: assets.id, fileName: assets.originalFilename })
    .from(organizationBranding)
    .leftJoin(
      assets,
      and(eq(assets.organizationId, organizationBranding.organizationId), eq(assets.id, organizationBranding.logoAssetId), eq(assets.status, "ready")),
    )
    .where(eq(organizationBranding.organizationId, organizationId))
    .limit(1);
  if (!row) return { logo: null, accent: null };
  return { accent: row.accent, logo: row.assetId ? { fileName: row.fileName ?? "Logo", src: assetUrl(row.assetId) } : null };
}
