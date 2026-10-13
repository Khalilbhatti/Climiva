/**
 * Phase 18A: the Branding upload endpoint (POST /api/branding), against the running application. Who may call it, what it accepts, what it
 * stores and where, what it never trusts, and what a failure leaves behind.
 *
 * Every test makes a business of its own (assets-helpers), so the standing Apex and Northstar are never changed. "The row, the object and the
 * Branding agree" is checked at the source: PostgreSQL for the rows, and the storage directory the server writes to for the bytes.
 */
import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { expect } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { LOGO_MAX_BYTES } from "../src/lib/asset-rules";
import { assetKey } from "../src/storage";
import { createLocalStorage } from "../src/storage/local";
import { sniffImageType } from "../src/storage/logo-image";
import { anonymous, bodyOf, brandingForm, file, grayPng, makeBusiness, ORIGIN, picture, signedIn, startServer } from "./assets-helpers";
import { test as saas } from "./saas";

const storage = () => createLocalStorage(process.env.ASSET_LOCAL_DIR!);
let pool: Pool;
let db: ReturnType<typeof adminDb>["db"];

saas.beforeAll(() => {
  const admin = adminDb();
  pool = admin.pool;
  db = admin.db;
});
saas.afterAll(async () => {
  await pool.end();
});

type Row = { id: string; status: string; media_type: string; byte_size: number; width: number; height: number; checksum: string; original_filename: string | null; storage_key: string; storage_driver: string; created_by_user_id: string | null };
const assetsOf = async (organizationId: string): Promise<Row[]> =>
  (await pool.query<Row>("select id, status, media_type, byte_size, width, height, checksum, original_filename, storage_key, storage_driver, created_by_user_id from assets where organization_id = $1 order by created_at, id", [organizationId])).rows;
const brandingOf = async (organizationId: string) =>
  (await pool.query<{ logo_asset_id: string | null; accent: string | null }>("select logo_asset_id, accent from organization_branding where organization_id = $1", [organizationId])).rows[0];

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

saas.describe("saving a logo", () => {
  saas("a PNG is stored, described and served, and the row, the object and the Branding agree", async ({ clientAddresses }) => {
    const biz = await makeBusiness("png", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    const source = await picture("png", 300, 200);
    const response = await api.post("/api/branding", { multipart: brandingForm({ logo: file(source, "My Crest.png"), accent: "#17766B" }) });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = (await bodyOf(response)) as { ok: boolean; branding: { logo: { fileName: string; src: string }; accent: string } };

    const [asset] = await assetsOf(biz.organizationId);
    expect(await assetsOf(biz.organizationId)).toHaveLength(1);
    expect(asset).toMatchObject({ status: "ready", media_type: "image/webp", original_filename: "My Crest.png", storage_driver: "local", created_by_user_id: biz.owner.userId, width: 300, height: 200 });
    expect(asset.storage_key).toBe(assetKey(biz.organizationId, asset.id));
    expect(body.branding).toEqual({ logo: { fileName: "My Crest.png", src: `/assets/${asset.id}` }, accent: "#17766B" });
    expect(await brandingOf(biz.organizationId)).toEqual({ logo_asset_id: asset.id, accent: "#17766B" });

    // The object is where the row says, it is a WebP, and the row's size and checksum describe exactly those bytes.
    const stored = await storage().get(asset.storage_key);
    expect(stored).not.toBeNull();
    expect(sniffImageType(stored!.body)).toBe("webp");
    expect(stored!.size).toBe(asset.byte_size);
    expect(sha256(stored!.body)).toBe(asset.checksum);

    // And a visitor is given those same bytes, as a WebP, whatever was uploaded.
    const visitor = await anonymous(clientAddresses(), null);
    const served = await visitor.get(body.branding.logo.src);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/webp");
    expect(sha256(await served.body())).toBe(asset.checksum);
  });

  saas("a JPEG and a WebP are accepted as well, and every one comes back as a WebP", async ({ clientAddresses }) => {
    for (const format of ["jpeg", "webp"] as const) {
      const biz = await makeBusiness(format, db);
      const api = await signedIn(biz.owner.email, clientAddresses());
      const response = await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture(format), `logo.${format}`, `image/${format}`) }) });
      expect(response.status(), format).toBe(200);
      expect((await assetsOf(biz.organizationId))[0], format).toMatchObject({ status: "ready", media_type: "image/webp" });
    }
  });

  saas("the type the browser claims is not believed: a PNG sent as text/html is still a PNG, and a text file sent as image/png is still text", async ({ clientAddresses }) => {
    const biz = await makeBusiness("claims", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    const real = await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png"), "page.html", "text/html") }) });
    expect(real.status()).toBe(200);
    const fake = await api.post("/api/branding", { multipart: brandingForm({ logo: file(Buffer.from("not an image at all"), "logo.png", "image/png") }) });
    expect(fake.status()).toBe(415);
    expect(await assetsOf(biz.organizationId)).toHaveLength(1);
  });

  saas("a file name is only ever a label: it cannot reach a path, a key or a response header", async ({ clientAddresses }) => {
    const biz = await makeBusiness("names", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    const names = ["../../../etc/passwd.png", "..\\..\\windows\\win.ini.png", '<img src=x onerror=alert(1)>.png', 'a|b?c*d:e.png', "x".repeat(400) + ".png", "%2e%2e%2fsecret.png"];
    for (const name of names) {
      const response = await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png"), name) }) });
      expect(response.status(), name).toBe(200);
    }
    const rows = await assetsOf(biz.organizationId);
    expect(rows).toHaveLength(names.length);
    for (const row of rows) {
      // The key is the application's, built from two ids; nothing of the name is in it.
      expect(row.storage_key).toBe(assetKey(biz.organizationId, row.id));
      // The label is clean: no path, no markup, no control characters, a sensible length.
      expect(row.original_filename, row.id).not.toMatch(/[\\/<>"|?*:\u0000-\u001f]/);
      expect(row.original_filename!.length).toBeLessThanOrEqual(120);
    }
    // And nothing was written anywhere but the business's own folder.
    for (const row of rows) expect(await storage().exists(row.storage_key)).toBe(true);
    const served = await (await anonymous(clientAddresses(), null)).get(`/assets/${(await brandingOf(biz.organizationId)).logo_asset_id}`);
    expect(JSON.stringify(served.headers())).not.toMatch(/passwd|win\.ini|onerror|secret/i);
  });
});

saas.describe("what is refused, and what that leaves behind", () => {
  const cases: [string, () => Promise<Buffer>, number, string][] = [
    ["a renamed text file", async () => Buffer.from("this is not an image"), 415, "unsupported"],
    ["an SVG, whatever it is called or claims to be", async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 415, "unsupported"],
    ["an HTML page dressed as an image", async () => Buffer.from("<!doctype html><script>alert(1)</script>"), 415, "unsupported"],
    ["a GIF", async () => Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00;", "latin1"), 415, "unsupported"],
    ["a PDF", async () => Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"), 415, "unsupported"],
    ["a damaged PNG", async () => (await picture("png", 200, 200)).subarray(0, 120), 422, "invalid"],
    ["a file over 5 MB", async () => Buffer.concat([await picture("png"), Buffer.alloc(LOGO_MAX_BYTES)]), 413, "tooLarge"],
  ];
  for (const [label, make, status, code] of cases) {
    saas(`${label} is refused, and nothing is stored, recorded or linked`, async ({ clientAddresses }) => {
      const biz = await makeBusiness("refuse", db);
      const api = await signedIn(biz.owner.email, clientAddresses());
      const response = await api.post("/api/branding", { multipart: brandingForm({ logo: file(await make(), "logo.png", "image/png"), accent: "#8B3A1E" }) });
      expect(response.status()).toBe(status);
      const body = await bodyOf(response);
      expect(body).toMatchObject({ ok: false, code });
      // A person-sized sentence, and nothing about where things are kept.
      expect(String(body.error).length).toBeGreaterThan(10);
      expect(JSON.stringify(body)).not.toMatch(/organizations\/|\.data|bucket|s3|ENOENT|at \w+ \(|climvia|Error:/i);
      expect(await assetsOf(biz.organizationId)).toEqual([]);
      expect(await brandingOf(biz.organizationId)).toBeUndefined();
    });
  }

  saas("a decompression bomb (a few hundred KB that claim 144 million pixels) is refused before it is decoded", async ({ clientAddresses }) => {
    // 144 million pixels in a few hundred KB.
    const bomb = await grayPng(12_000, 12_000);
    expect(bomb.length).toBeLessThan(LOGO_MAX_BYTES);

    const biz = await makeBusiness("bomb", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    const started = Date.now();
    const response = await api.post("/api/branding", { multipart: brandingForm({ logo: file(bomb) }) });
    expect(response.status()).toBe(413);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await bodyOf(response)).toMatchObject({ ok: false, code: "tooLarge" });
    expect(await assetsOf(biz.organizationId)).toEqual([]);
  });

  saas("a body larger than the limit is cut off as it arrives, even when it does not say how long it is", async ({ clientAddresses }) => {
    const biz = await makeBusiness("chunked", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    const cookie = (await api.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
    const boundary = "----climviaboundary";
    const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const request = httpRequest(
        { host: "localhost", port: new URL(ORIGIN).port, path: "/api/branding", method: "POST", headers: { cookie, origin: ORIGIN, "content-type": `multipart/form-data; boundary=${boundary}`, "transfer-encoding": "chunked" } },
        (response) => {
          let text = "";
          response.on("data", (part) => (text += part));
          response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
        },
      );
      request.on("error", reject);
      request.write(`--${boundary}\r\nContent-Disposition: form-data; name="accent"\r\n\r\n\r\n--${boundary}\r\nContent-Disposition: form-data; name="logo"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n`);
      const block = Buffer.alloc(256 * 1024, 7);
      for (let sent = 0; sent < LOGO_MAX_BYTES + 512 * 1024; sent += block.length) request.write(block);
      request.end(`\r\n--${boundary}--\r\n`);
    });
    expect(result.status).toBe(413);
    expect(await assetsOf(biz.organizationId)).toEqual([]);
  });

  saas("a request that is not a form, that leaves the accent out, or asks for two things at once is refused", async ({ clientAddresses }) => {
    const biz = await makeBusiness("shape", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    expect((await api.post("/api/branding", { data: { accent: "", logo: "x" } })).status()).toBe(415);
    expect((await api.post("/api/branding", { multipart: { removeLogo: "1" } })).status()).toBe(400);
    expect((await api.post("/api/branding", { multipart: { accent: "", logo: "just text", } })).status()).toBe(400);
    expect((await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png")), removeLogo: true }) })).status()).toBe(400);
    expect((await api.get("/api/branding")).status()).toBe(405);
    expect(await assetsOf(biz.organizationId)).toEqual([]);
  });

  saas("an accent that is not a colour, or is too pale for white text, is refused and changes nothing", async ({ clientAddresses }) => {
    const biz = await makeBusiness("accent", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    for (const accent of ["red", "#12345", "#GGGGGG", "javascript:alert(1)", "#FFFFFF", "#FFFF00"]) {
      const response = await api.post("/api/branding", { multipart: brandingForm({ accent }) });
      expect(response.status(), accent).toBe(422);
      expect(await bodyOf(response), accent).toMatchObject({ ok: false, code: "accent" });
    }
    expect(await brandingOf(biz.organizationId)).toBeUndefined();
    const fine = await api.post("/api/branding", { multipart: brandingForm({ accent: "17766b" }) });
    expect(fine.status()).toBe(200);
    expect(await brandingOf(biz.organizationId)).toEqual({ logo_asset_id: null, accent: "#17766B" });
  });
});

saas.describe("who may call it", () => {
  saas("no session is told it is signed out, and nothing is stored", async ({ clientAddresses }) => {
    const biz = await makeBusiness("nosession", db);
    const visitor = await anonymous(clientAddresses());
    const response = await visitor.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png")) }) });
    expect(response.status()).toBe(401);
    expect(await bodyOf(response)).toMatchObject({ ok: false });
    expect(await assetsOf(biz.organizationId)).toEqual([]);
  });

  saas("a signed-in member who may only look is refused before their file is read, and nothing is stored", async ({ clientAddresses }) => {
    const biz = await makeBusiness("member", db);
    const member = await signedIn(biz.member.email, clientAddresses());
    const response = await member.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png")), accent: "#8B3A1E" }) });
    expect(response.status()).toBe(403);
    expect(await assetsOf(biz.organizationId)).toEqual([]);
    expect(await brandingOf(biz.organizationId)).toBeUndefined();
    // An owner and an admin may.
    for (const who of ["owner", "admin"] as const) {
      const api = await signedIn(biz[who].email, clientAddresses());
      expect((await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png")) }) })).status(), who).toBe(200);
    }
    expect(await assetsOf(biz.organizationId)).toHaveLength(2);
  });

  saas("a request that does not come from this site's own pages is refused, even with a valid session", async ({ clientAddresses }) => {
    const biz = await makeBusiness("origin", db);
    const address = clientAddresses();
    const api = await signedIn(biz.owner.email, address);
    const form = brandingForm({ logo: file(await picture("png")) });
    for (const origin of ["https://evil.example", "http://localhost:1", "null", "not a url"]) {
      const response = await api.post("/api/branding", { multipart: form, headers: { origin } });
      expect(response.status(), origin).toBe(403);
    }
    const noOrigin = await api.post("/api/branding", { multipart: form, headers: { origin: "" } });
    expect(noOrigin.status()).toBe(403);
    const crossSite = await api.post("/api/branding", { multipart: form, headers: { "sec-fetch-site": "cross-site" } });
    expect(crossSite.status()).toBe(403);
    expect(await assetsOf(biz.organizationId)).toEqual([]);
  });

  saas("nothing in the request names the organization: forged ids, keys and a forged workspace cookie change only the caller's own business", async ({ clientAddresses, workerTenant }) => {
    const mine = await makeBusiness("forge-a", db);
    const theirs = await makeBusiness("forge-b", db);
    // The workspace cookie is only a preference; pointing it at someone else's business gets the caller their own.
    const api = await signedIn(mine.owner.email, clientAddresses(), undefined, {}, [{ name: "climvia_org", value: theirs.organizationId }]);
    const before = { theirs: await assetsOf(theirs.organizationId), apex: await assetsOf(workerTenant.organizationId), apexBranding: await brandingOf(workerTenant.organizationId) };
    const forged = {
      organizationId: theirs.organizationId,
      organization_id: workerTenant.organizationId,
      assetId: randomUUID(),
      storageKey: `organizations/${theirs.organizationId}/assets/${randomUUID()}/normalized`,
      key: "../../x",
      logoAssetId: before.apexBranding?.logo_asset_id ?? randomUUID(),
      userId: theirs.owner.userId,
    };
    const response = await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png")), extra: forged }) });
    expect(response.status()).toBe(200);
    expect(await assetsOf(mine.organizationId)).toHaveLength(1);
    expect((await assetsOf(mine.organizationId))[0].created_by_user_id).toBe(mine.owner.userId);
    expect(await assetsOf(theirs.organizationId)).toEqual(before.theirs);
    expect(await assetsOf(workerTenant.organizationId)).toEqual(before.apex);
    expect(await brandingOf(workerTenant.organizationId)).toEqual(before.apexBranding);
    expect(await brandingOf(theirs.organizationId)).toBeUndefined();
  });

  saas("one business's owner cannot touch another's logo: each save is to the caller's own Branding", async ({ clientAddresses }) => {
    const a = await makeBusiness("iso-a", db);
    const b = await makeBusiness("iso-b", db);
    const apiA = await signedIn(a.owner.email, clientAddresses());
    const apiB = await signedIn(b.owner.email, clientAddresses());
    await apiA.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png", 80, 80, { r: 200, g: 20, b: 20 })), accent: "#8B3A1E" }) });
    const aBefore = await brandingOf(a.organizationId);
    await apiB.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png")), accent: "#17766B" }) });
    await apiB.post("/api/branding", { multipart: brandingForm({ removeLogo: true }) });
    expect(await brandingOf(a.organizationId)).toEqual(aBefore);
    expect((await assetsOf(a.organizationId))[0].status).toBe("ready");
    expect(await brandingOf(b.organizationId)).toEqual({ logo_asset_id: null, accent: null });
  });
});

saas.describe("replacing, removing and saving at once", () => {
  saas("replacing a logo switches the Branding to the new one; the old one is kept, unreferenced, and no longer served", async ({ clientAddresses }) => {
    const biz = await makeBusiness("replace", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    const visitor = await anonymous(clientAddresses(), null);
    await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png", 60, 60, { r: 200, g: 30, b: 30 }), "first.png") }) });
    const first = (await brandingOf(biz.organizationId)).logo_asset_id!;
    expect((await visitor.get(`/assets/${first}`)).status()).toBe(200);

    const response = await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("jpeg", 70, 50), "second.jpg", "image/jpeg") }) });
    expect(response.status()).toBe(200);
    const second = (await brandingOf(biz.organizationId)).logo_asset_id!;
    expect(second).not.toBe(first);

    const rows = await assetsOf(biz.organizationId);
    expect(rows.map((row) => [row.id, row.status]).sort()).toEqual([[first, "ready"], [second, "ready"]].sort());
    // The old file is not destroyed (nothing may risk removing what something still refers to), but it is not public any more.
    expect(await storage().exists(assetKey(biz.organizationId, first))).toBe(true);
    expect((await visitor.get(`/assets/${first}`)).status()).toBe(404);
    expect((await visitor.get(`/assets/${second}`)).status()).toBe(200);
  });

  saas("removing the logo clears the reference and keeps the accent; the record of the file stays and the file is no longer served", async ({ clientAddresses }) => {
    const biz = await makeBusiness("remove", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    const visitor = await anonymous(clientAddresses(), null);
    await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png")), accent: "#17766B" }) });
    const id = (await brandingOf(biz.organizationId)).logo_asset_id!;
    const response = await api.post("/api/branding", { multipart: brandingForm({ removeLogo: true, accent: "#17766B" }) });
    expect(response.status()).toBe(200);
    expect(await bodyOf(response)).toMatchObject({ ok: true, branding: { logo: null, accent: "#17766B" } });
    expect(await brandingOf(biz.organizationId)).toEqual({ logo_asset_id: null, accent: "#17766B" });
    expect((await assetsOf(biz.organizationId))[0]).toMatchObject({ id, status: "ready" });
    expect((await visitor.get(`/assets/${id}`)).status()).toBe(404);
  });

  saas("saving only the accent leaves the logo exactly as it is", async ({ clientAddresses }) => {
    const biz = await makeBusiness("keep", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png")), accent: "#17766B" }) });
    const before = await brandingOf(biz.organizationId);
    const response = await api.post("/api/branding", { multipart: brandingForm({ accent: "#8B3A1E" }) });
    expect(response.status()).toBe(200);
    expect(await brandingOf(biz.organizationId)).toEqual({ logo_asset_id: before.logo_asset_id, accent: "#8B3A1E" });
    expect(await assetsOf(biz.organizationId)).toHaveLength(1);
  });

  saas("saving at the same moment (a double click, two tabs) ends with one definite logo, two ready files, and nothing pending", async ({ clientAddresses }) => {
    const biz = await makeBusiness("race", db);
    const apis = await Promise.all(Array.from({ length: 6 }, () => signedIn(biz.owner.email, clientAddresses())));
    const pictures = await Promise.all(Array.from({ length: 6 }, (_, index) => picture("png", 40 + index, 40, { r: 20 * index, g: 80, b: 120 })));
    const responses = await Promise.all(apis.map((api, index) => api.post("/api/branding", { multipart: brandingForm({ logo: file(pictures[index], `race-${index}.png`), accent: index % 2 ? "#17766B" : "#8B3A1E" }) })));
    for (const response of responses) expect(response.status()).toBe(200);

    const rows = await assetsOf(biz.organizationId);
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.status === "ready")).toBe(true);
    const branding = await brandingOf(biz.organizationId);
    // It points at exactly one of the business's own files, and the accent is whole (one request's, not a mixture).
    expect(rows.map((row) => row.id)).toContain(branding.logo_asset_id);
    expect(["#17766B", "#8B3A1E"]).toContain(branding.accent);
    // The one chosen is the one a visitor is given; the others are not public.
    const visitor = await anonymous(clientAddresses(), null);
    for (const row of rows) expect((await visitor.get(`/assets/${row.id}`)).status(), row.original_filename ?? row.id).toBe(row.id === branding.logo_asset_id ? 200 : 404);
    // Every file and every row is this business's alone.
    for (const row of rows) {
      expect(row.storage_key).toBe(assetKey(biz.organizationId, row.id));
      expect(await storage().exists(row.storage_key)).toBe(true);
    }
  });

  saas("what the server answers always matches what is stored: reading Settings after a save shows the stored logo", async ({ clientAddresses }) => {
    const biz = await makeBusiness("reload", db);
    const api = await signedIn(biz.owner.email, clientAddresses());
    await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png"), "reload.png"), accent: "#17766B" }) });
    const id = (await brandingOf(biz.organizationId)).logo_asset_id!;
    // A reload, and a completely fresh sign-in, are both told the stored logo.
    const fresh = await signedIn(biz.owner.email, clientAddresses());
    for (const client of [api, fresh]) {
      const html = await (await client.get("/settings/branding")).text();
      expect(html).toContain(`/assets/${id}`);
      expect(html).toContain("reload.png");
      expect(html).toContain("#17766B");
    }
  });
});

saas.describe("a store that fails", () => {
  saas("a failed upload is recorded as failed, never becomes the logo, and says nothing about the store", async ({ clientAddresses }, testInfo) => {
    saas.setTimeout(180_000);
    const biz = await makeBusiness("failing", db);
    // The logo this business already has, saved through the healthy server.
    const healthy = await signedIn(biz.owner.email, clientAddresses());
    await healthy.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png"), "good.png"), accent: "#17766B" }) });
    const before = await brandingOf(biz.organizationId);
    expect(before.logo_asset_id).not.toBeNull();

    // A second server whose "asset directory" is a plain file: nothing can be stored under it.
    const directory = await mkdtemp(join(tmpdir(), "climvia-broken-"));
    const notADirectory = join(directory, "not-a-directory");
    await writeFile(notADirectory, "a file, not a folder");
    const broken = await startServer(3490 + testInfo.parallelIndex, { ASSET_STORAGE_DRIVER: "local", ASSET_LOCAL_DIR: notADirectory });
    try {
      const api = await signedIn(biz.owner.email, clientAddresses(), broken.origin);
      const response = await api.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png"), "bad.png"), accent: "#8B3A1E" }) });
      expect(response.status()).toBe(500);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({ ok: false, code: "failed" });
      expect(text).not.toMatch(/ENOTDIR|ENOENT|not-a-directory|climvia-broken|organizations\/|\.data|stack|at \w+ \(/i);

      const rows = await assetsOf(biz.organizationId);
      expect(rows.map((row) => row.status).sort()).toEqual(["failed", "ready"]);
      const failed = rows.find((row) => row.status === "failed")!;
      // The Branding is exactly what it was: the failed file was never pointed at, and neither was the new accent applied.
      expect(await brandingOf(biz.organizationId)).toEqual(before);
      // And the failed file is not public.
      expect((await (await anonymous(clientAddresses(), null)).get(`/assets/${failed.id}`)).status()).toBe(404);
    } finally {
      broken.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
