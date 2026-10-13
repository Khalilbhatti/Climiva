/**
 * The ONE place a hostname is normalized, for a domain a business enters and for the Host a request arrives with.
 *
 * Pure: no database, no network, no environment (the platform's own names are passed in as `HostConfig`). It is shared by the Domain
 * Manager (a first check as the person types), the Server Actions (the enforcement) and the proxy (which classifies a request), so there
 * are not two ideas of what a hostname is.
 *
 * Unicode names are converted to ASCII by the platform's own URL parser (the WHATWG "domain to ASCII" algorithm), never by hand, and the
 * result is then checked strictly: only lower-case letters, digits and hyphens in labels of 1 to 63 characters, at least two labels, a
 * top-level label that starts with a letter (so no IP address can pass), and a total short enough that the verification record
 * `_climvia-verification.<name>` still fits in the 253 characters DNS allows. What is stored and looked up is only this ASCII form.
 */

/** The domain every Site's platform address lives under (`<platform-slug>.climvia.com`), and which nobody else can claim. */
export const PLATFORM_DOMAIN = "climvia.com";

/** 253 is the DNS limit; the verification record adds `_climvia-verification.` (22 characters) in front of the name. */
export const MAX_HOSTNAME_LENGTH = 231;

export type HostnameProblem =
  | "empty"
  | "scheme"
  | "path"
  | "query"
  | "fragment"
  | "credentials"
  | "port"
  | "wildcard"
  | "ip"
  | "single-label"
  | "invalid"
  | "length";

export type NormalizedHostname = { ok: true; hostname: string } | { ok: false; problem: HostnameProblem };

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const TOP_LABEL = /^[a-z]/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** What a business may type: a bare hostname. Everything that is not one is named, so the screen can say why. */
export function normalizeHostname(input: unknown): NormalizedHostname {
  if (typeof input !== "string") return { ok: false, problem: "invalid" };
  let candidate = input.trim();
  if (candidate === "") return { ok: false, problem: "empty" };
  if (candidate.length > 512) return { ok: false, problem: "length" };

  if (candidate.includes("://") || candidate.startsWith("//")) return { ok: false, problem: "scheme" };
  if (candidate.startsWith("[")) return { ok: false, problem: "ip" };
  if (/[/\\]/.test(candidate)) return { ok: false, problem: "path" };
  if (candidate.includes("?")) return { ok: false, problem: "query" };
  if (candidate.includes("#")) return { ok: false, problem: "fragment" };
  if (candidate.includes("@")) return { ok: false, problem: "credentials" };
  if (candidate.includes(":")) return { ok: false, problem: "port" };
  if (candidate.includes("*")) return { ok: false, problem: "wildcard" };
  // A space, a control character or a percent escape could make two different strings mean one name, so none is accepted.
  if (/[\s%\u0000-\u001f\u007f]/.test(candidate)) return { ok: false, problem: "invalid" };

  // One trailing dot is the DNS root and is dropped; anything left that still ends in a dot has an empty label.
  if (candidate.endsWith(".")) candidate = candidate.slice(0, -1);
  if (candidate === "" || candidate.startsWith(".") || candidate.endsWith(".") || candidate.includes("..")) return { ok: false, problem: "invalid" };

  let host: string;
  try {
    host = new URL(`http://${candidate}`).hostname;
  } catch {
    return { ok: false, problem: "invalid" };
  }
  return checkAscii(host);
}

/** The strict check of an already-ASCII name. Also the last line of defence for anything that reaches the database. */
function checkAscii(host: string): NormalizedHostname {
  if (host === "" || host.endsWith(".") || host.startsWith(".")) return { ok: false, problem: "invalid" };
  // The URL parser turns every spelling of an IPv4 address ("127.1", "0x7f.1", "2130706433") into dotted decimal.
  if (IPV4.test(host) || host.startsWith("[")) return { ok: false, problem: "ip" };
  if (host.length > MAX_HOSTNAME_LENGTH) return { ok: false, problem: "length" };
  const labels = host.split(".");
  if (labels.length < 2) return { ok: false, problem: "single-label" };
  for (const label of labels) {
    if (label.length < 1 || label.length > 63 || !LABEL.test(label)) return { ok: false, problem: label.length > 63 ? "length" : "invalid" };
  }
  if (!TOP_LABEL.test(labels[labels.length - 1])) return { ok: false, problem: "invalid" };
  return { ok: true, hostname: host };
}

/** What a request's `Host` header says it is for: a name we may route, an IP address, a name with one label, or nothing usable. */
export type RequestHost = { kind: "name"; hostname: string } | { kind: "ip" } | { kind: "single-label" } | { kind: "invalid" };

/**
 * Read a `Host` header. The port is dropped (it is not part of a domain's identity), one trailing dot is dropped, case is folded and a
 * Unicode name is converted to ASCII. Only the `Host` header is ever passed here: `Forwarded` and `X-Forwarded-Host` come from whoever
 * sent the request, and nothing selects a business from them.
 */
export function readRequestHost(header: string | null | undefined): RequestHost {
  if (typeof header !== "string") return { kind: "invalid" };
  const raw = header.trim();
  if (raw === "" || raw.length > 300) return { kind: "invalid" };
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    const rest = raw.slice(close + 1);
    return close > 1 && (rest === "" || /^:\d{1,5}$/.test(rest)) ? { kind: "ip" } : { kind: "invalid" };
  }
  const colon = raw.lastIndexOf(":");
  let name = raw;
  if (colon !== -1) {
    if (!/^\d{1,5}$/.test(raw.slice(colon + 1))) return { kind: "invalid" };
    name = raw.slice(0, colon);
  }
  const result = normalizeHostname(name);
  if (result.ok) return { kind: "name", hostname: result.hostname };
  if (result.problem === "ip") return { kind: "ip" };
  if (result.problem === "single-label") return { kind: "single-label" };
  return { kind: "invalid" };
}

/* ───────────────────────── which names are the platform's ───────────────────────── */

/** The platform's own names, from the environment (see src/lib/domain-config). */
export type HostConfig = {
  /** The domain every platform address lives under (`climvia.com`): it and everything beneath it is the platform's. */
  platformDomain: string;
  /** Every other name this application answers on (APP_HOSTS), already normalized. */
  appHosts: readonly string[];
  /** The name customers point their DNS at (CUSTOM_DOMAIN_TARGET), already normalized, or null. */
  customDomainTarget: string | null;
};

const under = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

/** The names that must never be claimed: the platform's own, and the ones the application is served on. */
export function platformBases(config: HostConfig): string[] {
  return [config.platformDomain, ...config.appHosts, ...(config.customDomainTarget ? [config.customDomainTarget] : [])];
}

/** Development and internal names the DATABASE also refuses (see the CHECK on site_domains). */
const INTERNAL = /(^|\.)(localhost|local|localdomain|internal|invalid)$|\.home\.arpa$|^localhost$/;

export type ReservedReason = "platform" | "internal";

/** Why a normalized name may not be claimed by a business, or null. Enforced on the server and again by the database. */
export function reservedReason(hostname: string, config: HostConfig): ReservedReason | null {
  if (INTERNAL.test(hostname)) return "internal";
  return platformBases(config).some((base) => under(hostname, base)) ? "platform" : null;
}

/**
 * Is this request for the PLATFORM (the workspace, the sign-in pages, `/sites/<address>`, `/listings/...`) or might it be for a
 * customer's own domain? The platform's names, every IP address and every one-label name (a container's service name, `localhost`) are the
 * platform's; any other multi-label name is a custom-domain candidate, which is resolved in the database and is NOT the platform when
 * nothing matches. An unusable Host is neither: the request is refused.
 */
export function classifyHost(header: string | null | undefined, config: HostConfig): "platform" | "custom" | "refuse" {
  const host = readRequestHost(header);
  if (host.kind === "invalid") return "refuse";
  if (host.kind !== "name") return "platform";
  return platformBases(config).some((base) => under(host.hostname, base)) ? "platform" : "custom";
}

/** The message for each reason a name cannot be used, in the words the Domain Manager shows. */
export const HOSTNAME_PROBLEM_TEXT: Record<HostnameProblem, string> = {
  empty: "Enter a domain name like www.yourbusiness.com.",
  scheme: "Enter only the domain name, without http:// or https://.",
  path: "Enter only the domain name, without a path.",
  query: "Enter only the domain name, without a query.",
  fragment: "Enter only the domain name, without a # fragment.",
  credentials: "Enter only the domain name, without a user name.",
  port: "Enter only the domain name, without a port.",
  wildcard: "Wildcard domains are not supported. Enter one domain name like www.yourbusiness.com.",
  ip: "An IP address can't be used. Enter a domain name like www.yourbusiness.com.",
  "single-label": "Enter a full domain name like www.yourbusiness.com.",
  invalid: "That doesn't look like a domain name. Enter one like www.yourbusiness.com.",
  length: "That domain name is too long.",
};

export const RESERVED_DOMAIN_TEXT = "That domain can't be used.";
