import { platformOrigin } from "@/lib/domain-config";
import { getMarketplaceSitemap } from "@/server/public-site";

/**
 * The Marketplace's sitemap: the pages a search engine may be told about, and only those. Every address comes from the public discovery function,
 * which lists a provider's profile, a Service page, a place page or a Service-in-place page only while at least one DISCOVERABLE provider is
 * behind it (published by its business, not suspended by the platform, with at least one Service it shows). A provider that is suspended or
 * hidden is in no entry, and a combination nobody offers is not made up. The business websites are not part of this list.
 *
 * Public: no session, no cookie. The platform's own address is the one used (customers' domains never reach this route).
 */
export const dynamic = "force-dynamic";

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(request: Request) {
  const origin = platformOrigin() ?? new URL(request.url).origin;
  let map;
  try {
    map = await getMarketplaceSitemap();
  } catch {
    return new Response("Unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const entries: { path: string; lastModified?: string }[] = [];
  if (map.listings.length > 0) entries.push({ path: "/marketplace" });
  for (const service of map.services) entries.push({ path: `/marketplace/services/${service}` });
  for (const location of map.locations) entries.push({ path: `/marketplace/locations/${location}` });
  for (const pair of map.combinations) entries.push({ path: `/marketplace/services/${pair.service}/${pair.location}` });
  for (const listing of map.listings) entries.push({ path: `/listings/${listing.slug}`, lastModified: listing.updatedAt || undefined });

  const body = [
    '<?xml version="1.0"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => `<url><loc>${xml(origin + entry.path)}</loc>${entry.lastModified ? `<lastmod>${xml(entry.lastModified)}</lastmod>` : ""}</url>`),
    "</urlset>",
    "",
  ].join("\n");
  return new Response(body, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
