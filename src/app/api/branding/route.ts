import { NextResponse } from "next/server";
import { NOT_ALLOWED, SIGNED_OUT } from "@/lib/action-result";
import { LOGO_MAX_BYTES, UPLOAD_FAILURES } from "@/lib/asset-rules";
import { can } from "@/lib/policy";
import { saveBranding } from "@/server/branding";
import { isSameOrigin } from "@/server/same-origin";
import { resolveWorkspace } from "@/server/workspace";

/**
 * Save the business's Branding: its logo and its accent. The one endpoint that takes a file.
 *
 * POST multipart/form-data, with these fields (none names an organization):
 *   accent       required: "#RRGGBB", or "" for the Climvia teal
 *   logo         optional: a PNG, JPEG or WebP image, replacing the logo
 *   removeLogo   optional: "1" takes the logo away (cannot be combined with `logo`); with neither, the logo is left as it is
 *
 * The order is the defence, and it is the same as every Server Action's, with one addition:
 *   1. the request must come from this application's own pages (src/server/same-origin);
 *   2. the caller is the verified person in a verified active workspace (the session cookie and a membership, never a field), and may
 *      `settings:manage` there (an owner or admin; a member cannot);
 *   3. ONLY THEN is the body read, and it is read under a hard byte limit as it arrives, so a body that lies about its length is cut off, and
 *      nobody without the right to upload makes the server buffer anything;
 *   4. the file is judged by its bytes (src/storage/logo-image), never by its name or its Content-Type.
 * The organization written is the caller's active one. Responses are never cached and say nothing about storage.
 */
export const dynamic = "force-dynamic";

/** The multipart framing around the file (boundaries, field names, the accent): generous, and still bounded. */
const FRAMING_BYTES = 64 * 1024;
const MAX_BODY = LOGO_MAX_BYTES + FRAMING_BYTES;

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The whole body, or null when it is larger than `limit` (judged by what arrives, not by what the header claims). */
async function readLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return reply(403, { ok: false, error: "This request did not come from this site." });

  const state = await resolveWorkspace();
  if (state.status !== "ready") return reply(401, { ok: false, error: SIGNED_OUT });
  if (!can(state.context.role, "settings:manage")) return reply(403, { ok: false, error: NOT_ALLOWED });

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return reply(415, { ok: false, error: UPLOAD_FAILURES.unsupported, code: "unsupported" });

  const body = await readLimited(request, MAX_BODY);
  if (!body) return reply(413, { ok: false, error: UPLOAD_FAILURES.tooLarge, code: "tooLarge" });

  let form: FormData;
  try {
    form = await new Response(Buffer.from(body), { headers: { "content-type": contentType } }).formData();
  } catch {
    return reply(400, { ok: false, error: "The request could not be read." });
  }

  const accent = form.get("accent");
  const file = form.get("logo");
  const remove = form.get("removeLogo") === "1";
  // The accent is always sent (empty means the Climvia teal), so a request that leaves it out cannot reset it by accident.
  if (typeof accent !== "string") return reply(400, { ok: false, error: "The request could not be read." });
  if (file !== null && typeof file === "string") return reply(400, { ok: false, error: "The request could not be read." });
  if (file && remove) return reply(400, { ok: false, error: "Choose a logo or remove it, not both." });

  const logo = file
    ? ({ kind: "replace", bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name } as const)
    : remove
      ? ({ kind: "remove" } as const)
      : ({ kind: "keep" } as const);

  const result = await saveBranding(state.context, accent, logo);
  if (!result.ok) return reply(result.status, { ok: false, error: result.error, code: result.code });
  return reply(200, { ok: true, branding: result.branding });
}
