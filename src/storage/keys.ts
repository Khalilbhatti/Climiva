/**
 * Storage keys: the only names an object can have.
 *
 * A key is built here from two ids and a variant, and parsed here, strictly. A filename, a path or anything a browser sent is never part of
 * one: the Asset row stores the key, a CHECK ties it to the row's own organization and id (drizzle/0017), and both storage drivers refuse
 * anything this file does not recognise. So `..`, an absolute path, an encoded traversal, a slash in a filename or another business's folder
 * is not a key that exists, rather than one that is rejected after being resolved.
 *
 *     organizations/<organization id>/assets/<asset id>/<variant>
 *
 * Nothing in this file touches a disk or a network, and it ships to no browser.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What an Asset may be stored as. `normalized` is the re-encoded file; later variants (thumbnails) are added here. */
export const ASSET_VARIANTS = ["normalized"] as const;
export type AssetVariant = (typeof ASSET_VARIANTS)[number];

export type ParsedAssetKey = { organizationId: string; assetId: string; variant: AssetVariant };

const KEY = /^organizations\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})\/([a-z]+)$/;

export const isAssetId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** The key for an Asset's stored file. Throws on anything that is not a lower-case UUID, so no caller can build a key from user input. */
export function assetKey(organizationId: string, assetId: string, variant: AssetVariant = "normalized"): string {
  if (!isAssetId(organizationId) || !isAssetId(assetId)) throw new Error("An asset key needs an organization id and an asset id.");
  if (!(ASSET_VARIANTS as readonly string[]).includes(variant)) throw new Error("Unknown asset variant.");
  return `organizations/${organizationId}/assets/${assetId}/${variant}`;
}

/** The parts of a key, or null when the text is not exactly a key this application would generate. */
export function parseAssetKey(key: unknown): ParsedAssetKey | null {
  if (typeof key !== "string" || key.length > 200) return null;
  const match = KEY.exec(key);
  if (!match) return null;
  const [, organizationId, assetId, variant] = match;
  if (!isAssetId(organizationId) || !isAssetId(assetId) || !(ASSET_VARIANTS as readonly string[]).includes(variant)) return null;
  return { organizationId, assetId, variant: variant as AssetVariant };
}
