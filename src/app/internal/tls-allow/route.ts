import { timingSafeEqual } from "node:crypto";
import { isTlsEligible } from "@/db/public-queries";
import { normalizeHostname } from "@/lib/hostname";

export const dynamic = "force-dynamic";

/**
 * "May a certificate be requested for this name?" asked by the reverse proxy (Caddy's on-demand TLS `ask`) the first time a customer's domain
 * is requested over https, so an arbitrary name pointed at the server can not make it request a certificate from a public CA.
 *
 *     GET /internal/tls-allow?token=<TLS_ASK_TOKEN>&domain=<name>
 *
 * The answer is a STATUS and nothing else: 200 means yes; everything else means no, and every kind of no (a wrong or missing token, a name that
 * is not a name, a name nobody has activated, a pending, verified, disabled or removed claim, a private site, an endpoint that is not configured)
 * is the same bare 404, so the endpoint tells a caller nothing about which names exist. No body, no tenant, no site, no token of a claim.
 *
 * It is not a lookup API: it takes one normalized name and returns one bit, through a single indexed query (`app_tls_eligible`), never consults
 * DNS, and is refused unless the shared secret matches. The proxy also refuses to forward `/internal/*` from the Internet, and the application's
 * port is on the internal network only; the secret is a third layer, not the first.
 */
const NO = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const expected = process.env.TLS_ASK_TOKEN;
  if (!expected) return NO();
  const params = new URL(request.url).searchParams;
  if (!sameSecret(params.get("token"), expected)) return NO();

  const asked = params.get("domain");
  if (asked === null) return NO();
  const name = normalizeHostname(asked);
  if (!name.ok) return NO();
  try {
    return (await isTlsEligible(name.hostname)) ? new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } }) : NO();
  } catch {
    // The database can not be asked: no certificate is requested now (the proxy asks again at the next handshake).
    return NO();
  }
}
