import { platformOrigin } from "@/lib/domain-config";

/**
 * What a crawler may fetch on the platform's own address: the public Marketplace (its index, its Service and place pages), the providers' profiles
 * and the published websites, and nothing else. The workspace and the console need a sign-in and are not offered. The sitemap it points to lists the
 * Marketplace's pages only. (A customer's own domain never reaches this route: it is served that customer's site.)
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const origin = platformOrigin() ?? new URL(request.url).origin;
  const body = ["User-agent: *", "Allow: /marketplace$", "Allow: /marketplace/", "Allow: /listings/", "Allow: /sites/", "Allow: /assets/", "Disallow: /", `Sitemap: ${origin}/sitemap.xml`, ""].join("\n");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
