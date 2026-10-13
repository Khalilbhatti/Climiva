import { loadPublicAsset } from "@/db/public-queries";
import { logAsset } from "@/server/asset-log";
import { isAssetId, storageFor } from "@/storage";

/**
 * A business's logo, served to anyone: the published Site and the Marketplace listing draw it from here.
 *
 *   /assets/<asset id>
 *
 * This is a PUBLIC route and reads no session, no cookie and no workspace (src/app/(public) holds that line, and a test checks it). What it may
 * serve is decided in the database, by `app_public_asset`: an Asset that is READY, a LOGO, and the logo its business has CHOSEN. Everything else
 * (a pending or failed upload, a logo that was replaced or removed, any other Asset, an id that does not exist) is the same plain 404, with
 * nothing in it that tells them apart.
 *
 * The address is an id and nothing else: a storage key cannot be asked for (a key is not a UUID, so it is a 404 before the database is
 * consulted), and the response carries no key, path, bucket or file name. The bytes are the stored, re-encoded image; the type is the one
 * recorded when it was stored, never anything from the request.
 *
 * Caching: an Asset id never changes what it holds (a new logo is a new id), so the response is cacheable and validated by its checksum. It is a
 * day, not a year, on purpose: a logo that is removed stops being served here at once, and the day is how long a copy somewhere may outlive that.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!isAssetId(assetId)) return NOT_FOUND();

  let asset;
  try {
    asset = await loadPublicAsset(assetId);
  } catch (error) {
    logAsset("public.lookup-failed", { asset: assetId, cause: error instanceof Error ? error.name : "unexpected" }, "error");
    return new Response("Unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (!asset) return NOT_FOUND();

  const etag = `"${asset.checksum}"`;
  const headers: Record<string, string> = {
    "Content-Type": asset.mediaType,
    "Cache-Control": "public, max-age=86400",
    ETag: etag,
    // A picture and only a picture: no sniffing it into anything else, no scripting, no framing, no filename.
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  try {
    const stored = await storageFor(asset.storageDriver).get(asset.storageKey);
    if (!stored || stored.size !== asset.byteSize) {
      // The database says it is ready and the store disagrees: an integrity problem for the operator, not something to describe to a visitor.
      logAsset("public.object-missing", { asset: assetId, driver: asset.storageDriver, found: stored ? "wrong-size" : "no" }, "error");
      return NOT_FOUND();
    }
    return new Response(Buffer.from(stored.body), { status: 200, headers: { ...headers, "Content-Length": String(stored.size) } });
  } catch (error) {
    logAsset("public.read-failed", { asset: assetId, driver: asset.storageDriver, cause: error instanceof Error ? error.name : "unexpected" }, "error");
    return new Response("Unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
}
