import "server-only";
import { randomUUID } from "node:crypto";
import type { Branding } from "@/data/settings";
import { activateLogo, createPendingAsset, loadBranding, markAssetFailed, writeBranding } from "@/db/asset-queries";
import { withTenant } from "@/db/tenant";
import { cleanFilename, UPLOAD_FAILURES, type UploadFailure } from "@/lib/asset-rules";
import { validateAccent, normalizeAccent } from "@/lib/settings-state";
import { assetKey, currentStorage, StorageError, type AssetStorage } from "@/storage";
import { LogoRejected, normalizeLogo } from "@/storage/logo-image";
import { logAsset as log } from "./asset-log";
import type { WorkspaceContext } from "./workspace";

/**
 * Saving a business's Branding: its logo and its accent.
 *
 * The caller has already been verified (a session, a membership, `settings:manage`) and `context` is theirs; nothing here takes an organization
 * from the request. The database and the object store cannot share a transaction, so the order is what keeps them consistent:
 *
 *   1. The upload is read as an image and re-encoded in memory (src/storage/logo-image). A bad file ends here, having touched nothing.
 *   2. A PENDING Asset row is written. It says "bytes are on their way"; nothing may render it or use it as a logo.
 *   3. The bytes are stored. If that fails, the row is marked FAILED and nothing else changed: the Branding still points where it did.
 *   4. ONE transaction makes the Asset READY and points the Branding at it (and saves the accent). It either happens whole or not at all, so the
 *      Branding never points at a pending or failed Asset, and the switch from the old logo to the new is a single row update, never a gap.
 *      Two saves at once take the Branding row's lock in turn: the later one wins, and both Assets are the business's own.
 *   5. If step 4 fails, the Asset is marked FAILED and its object removed, best effort.
 *
 * What can be left behind, and is unreachable: an object whose Asset stayed pending or failed (the process died between steps 3 and 4, or the
 * cleanup in step 5 could not run), and the previous logo's object and row after a replacement. None is public (the public path serves only a
 * READY LOGO that is a business's CURRENT choice) and none is referenced; a later garbage collector can remove them by status and age. A
 * replaced logo is deliberately not deleted here: nothing may risk removing a file something still refers to.
 */

export type LogoInput = { kind: "keep" } | { kind: "remove" } | { kind: "replace"; bytes: Uint8Array; filename: string | undefined | null };

export type SaveBrandingResult =
  | { ok: true; branding: Branding }
  | { ok: false; status: number; error: string; code: UploadFailure | "accent" };

const STATUS: Record<UploadFailure, number> = { unsupported: 415, tooLarge: 413, invalid: 422, failed: 500 };
const refuse = (code: UploadFailure): SaveBrandingResult => ({ ok: false, status: STATUS[code], error: UPLOAD_FAILURES[code], code });

export async function saveBranding(context: WorkspaceContext, accentInput: string, logo: LogoInput): Promise<SaveBrandingResult> {
  const { userId, organizationId } = context;
  const tenant = { userId, organizationId };

  const accentProblem = validateAccent(accentInput);
  if (accentProblem) return { ok: false, status: 422, error: accentProblem, code: "accent" };
  const accent = normalizeAccent(accentInput) ?? null;

  try {
    if (logo.kind === "keep" || logo.kind === "remove") {
      const branding = await withTenant(tenant, async (tx) => {
        await writeBranding(tx, organizationId, accent, logo.kind === "remove" ? { kind: "remove" } : { kind: "keep" });
        return loadBranding(tx, organizationId);
      });
      if (logo.kind === "remove") log("logo.removed", { organization: organizationId });
      return { ok: true, branding };
    }

    // 1. Read and re-encode, in memory.
    let normalized;
    try {
      normalized = await normalizeLogo(logo.bytes);
    } catch (error) {
      if (error instanceof LogoRejected) {
        log("logo.rejected", { organization: organizationId, reason: error.reason });
        return refuse(error.reason);
      }
      throw error;
    }

    const assetId = randomUUID();
    let storage: AssetStorage;
    try {
      storage = currentStorage();
    } catch (error) {
      log("logo.unavailable", { organization: organizationId, reason: error instanceof Error ? error.message : "storage" }, "error");
      return refuse("failed");
    }
    const key = assetKey(organizationId, assetId);

    // 2. A pending row.
    await withTenant(tenant, (tx) =>
      createPendingAsset(tx, {
        id: assetId,
        organizationId,
        userId,
        driver: storage.driver,
        storageKey: key,
        originalFilename: cleanFilename(logo.filename),
        mediaType: normalized.mediaType,
        byteSize: normalized.bytes.byteLength,
        width: normalized.width,
        height: normalized.height,
        checksum: normalized.checksum,
      }),
    );

    // 3. The bytes.
    try {
      await storage.put(key, normalized.bytes, { contentType: normalized.mediaType });
    } catch (error) {
      log("logo.store-failed", { organization: organizationId, asset: assetId, driver: storage.driver, cause: error instanceof StorageError ? "storage" : "unexpected" }, "error");
      await withTenant(tenant, (tx) => markAssetFailed(tx, organizationId, assetId)).catch(() => undefined);
      return refuse("failed");
    }

    // 4. Ready, and the logo, together.
    try {
      const branding = await withTenant(tenant, async (tx) => {
        if (!(await activateLogo(tx, organizationId, assetId, accent))) throw new Error("The asset was not pending.");
        return loadBranding(tx, organizationId);
      });
      log("logo.ready", { organization: organizationId, asset: assetId, driver: storage.driver, bytes: normalized.bytes.byteLength });
      return { ok: true, branding };
    } catch (error) {
      // 5. Tidy up what can be tidied; whatever cannot is unreachable (see above).
      log("logo.activate-failed", { organization: organizationId, asset: assetId, driver: storage.driver, cause: error instanceof Error ? error.name : "unexpected" }, "error");
      await withTenant(tenant, (tx) => markAssetFailed(tx, organizationId, assetId)).catch(() => undefined);
      await storage.delete(key).catch(() => undefined);
      return refuse("failed");
    }
  } catch (error) {
    log("branding.failed", { organization: organizationId, cause: error instanceof Error ? error.name : "unexpected" }, "error");
    return refuse("failed");
  }
}
