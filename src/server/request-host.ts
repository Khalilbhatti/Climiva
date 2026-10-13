import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { PublicHost } from "@/data/public-site";
import { loadPublicHost } from "@/db/public-queries";
import { classifyHost, readRequestHost } from "@/lib/hostname";
import { hostConfig } from "@/lib/domain-config";

/**
 * Which address did this request arrive on?
 *
 *   platform   the application's own name (the workspace, `/sites/<address>`, `localhost`, an IP address, `app.<domain>`): the route decides.
 *   custom     a customer's domain whose claim is ACTIVE and whose Site is PUBLISHED: `host` names the Site.
 *   unknown    anything else: a name nobody has activated, a claim that is pending, disabled or removed, a Site that is private, or a Host
 *              header that is not a name. It is never the platform and never a sample business: the page is "not found".
 *
 * The answer comes from the `Host` header and from nothing else. `Forwarded` and `X-Forwarded-Host` are headers any client can send, so they
 * select no business; if a trusted reverse proxy is added in front of the application (a later phase), it must pass the customer's name in
 * `Host`, or an explicit trusted-proxy setting must be introduced and documented. No organization or site id from a browser takes part.
 *
 * The lookup is one call to the public SQL function `app_public_domain`, which returns the site's public identity and nothing else.
 */
export type RequestSite = { kind: "platform" } | { kind: "custom"; hostname: string; host: PublicHost } | { kind: "unknown" };

export const getRequestSite = cache(async (): Promise<RequestSite> => {
  const header = (await headers()).get("host");
  const kind = classifyHost(header, hostConfig());
  if (kind === "platform") return { kind: "platform" };
  if (kind === "refuse") return { kind: "unknown" };
  const parsed = readRequestHost(header);
  if (parsed.kind !== "name") return { kind: "unknown" };
  const host = await loadPublicHost(parsed.hostname);
  return host ? { kind: "custom", hostname: parsed.hostname, host } : { kind: "unknown" };
});
