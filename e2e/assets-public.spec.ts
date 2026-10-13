/**
 * Phase 18A: the public Asset route (GET /assets/<id>). What a visitor with no session is given, in what shape, and what is the same plain
 * nothing for every other id: a logo that is not the business's current one, an upload that is not finished or failed, a storage key, a
 * traversal, anything else.
 *
 * Every client here is anonymous on purpose (assets-helpers `anonymous`): the route reads no session, and a response that depended on one
 * would be a leak. Logos are made for the test (makeBusiness / addReadyLogo), so the standing businesses are only read.
 */
import { createHash, randomUUID } from "node:crypto";
import { expect } from "playwright/test";
import { Pool } from "pg";
import { adminDb } from "../scripts/db/lib";
import { assetKey } from "../src/storage";
import { createLocalStorage } from "../src/storage/local";
import { sniffImageType } from "../src/storage/logo-image";
import { addReadyLogo, anonymous, makeBusiness, setLogo } from "./assets-helpers";
import { test } from "./saas";

let pool: Pool;
let db: ReturnType<typeof adminDb>["db"];
test.beforeAll(() => {
  const admin = adminDb();
  pool = admin.pool;
  db = admin.db;
});
test.afterAll(async () => {
  await pool.end();
});

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const storage = () => createLocalStorage(process.env.ASSET_LOCAL_DIR!);

/** A pending, a failed and a ready-but-not-chosen Asset for a business, written by the owner role (the application only ever creates pending ones). */
async function row(organizationId: string, status: "pending" | "failed", filename = "x.png"): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into assets (id, organization_id, purpose, storage_driver, storage_key, original_filename, media_type, byte_size, width, height, checksum, status) values ($1, $2, 'logo', 'local', $3, $4, 'image/webp', 100, 10, 10, $5, $6)",
    [id, organizationId, assetKey(organizationId, id), filename, "a".repeat(64), status],
  );
  return id;
}

test.describe("a logo that is a business's current choice", () => {
  test("is given to anyone as a WebP, with headers that make it only a picture", async ({ clientAddresses }) => {
    const biz = await makeBusiness("serve", db);
    const id = await addReadyLogo(pool, biz.organizationId, { filename: "Serve Me.png" });
    await setLogo(pool, biz.organizationId, id);
    const visitor = await anonymous(clientAddresses(), null);
    const response = await visitor.get(`/assets/${id}`);
    expect(response.status()).toBe(200);

    const stored = (await storage().get(assetKey(biz.organizationId, id)))!;
    const body = await response.body();
    expect(sniffImageType(body)).toBe("webp");
    expect(Buffer.compare(body, Buffer.from(stored.body))).toBe(0);

    const headers = response.headers();
    expect(headers["content-type"]).toBe("image/webp");
    expect(headers["content-length"]).toBe(String(stored.size));
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(headers["content-disposition"]).toBe("inline");
    expect(headers["cache-control"]).toBe("public, max-age=86400");
    expect(headers.etag).toBe(`"${sha256(stored.body)}"`);
    expect(headers["set-cookie"]).toBeUndefined();
    // Nothing of the file's label, its key, its folder or this machine is in what is sent.
    expect(JSON.stringify(headers)).not.toMatch(/Serve Me|organizations\/|\.data|assets-test|climvia/i);
  });

  test("is validated by its checksum: the same ETag gets a 304 with no body, a different one the whole file; HEAD has the headers and no body", async ({ clientAddresses }) => {
    const biz = await makeBusiness("etag", db);
    const id = await addReadyLogo(pool, biz.organizationId);
    await setLogo(pool, biz.organizationId, id);
    const visitor = await anonymous(clientAddresses(), null);
    const first = await visitor.get(`/assets/${id}`);
    const etag = first.headers().etag;
    const same = await visitor.get(`/assets/${id}`, { headers: { "if-none-match": etag } });
    expect(same.status()).toBe(304);
    expect((await same.body()).length).toBe(0);
    expect(same.headers().etag).toBe(etag);
    const other = await visitor.get(`/assets/${id}`, { headers: { "if-none-match": '"something-else"' } });
    expect(other.status()).toBe(200);
    const head = await visitor.head(`/assets/${id}`);
    expect(head.status()).toBe(200);
    expect(head.headers()["content-type"]).toBe("image/webp");
    expect((await head.body()).length).toBe(0);
  });

  test("is the same for a visitor, a signed-in person and a request carrying a garbage session: the route reads no session", async ({ clientAddresses, workerTenant, playwright }) => {
    const biz = await makeBusiness("session", db);
    const id = await addReadyLogo(pool, biz.organizationId);
    await setLogo(pool, biz.organizationId, id);
    const visitor = await (await anonymous(clientAddresses(), null)).get(`/assets/${id}`);
    const signedIn = await playwright.request.newContext({ baseURL: process.env.BETTER_AUTH_URL, storageState: workerTenant.storageState });
    const asPerson = await signedIn.get(`/assets/${id}`);
    const garbage = await (await anonymous(clientAddresses(), null)).get(`/assets/${id}`, { headers: { cookie: "better-auth.session_token=garbage; climvia_org=nonsense" } });
    for (const response of [asPerson, garbage]) {
      expect(response.status()).toBe(200);
      expect(response.headers().etag).toBe(visitor.headers().etag);
      expect(Buffer.compare(await response.body(), await visitor.body())).toBe(0);
    }
    await signedIn.dispose();
  });

  test("keeps being served from the object, whatever the query string says: no parameter chooses another file", async ({ clientAddresses }) => {
    const biz = await makeBusiness("query", db);
    const other = await makeBusiness("query-other", db);
    const id = await addReadyLogo(pool, biz.organizationId);
    await setLogo(pool, biz.organizationId, id);
    const otherId = await addReadyLogo(pool, other.organizationId, { color: { r: 200, g: 20, b: 20 } });
    await setLogo(pool, other.organizationId, otherId);
    const visitor = await anonymous(clientAddresses(), null);
    const plain = await (await visitor.get(`/assets/${id}`)).body();
    for (const query of [`?key=${assetKey(other.organizationId, otherId)}`, `?assetId=${otherId}`, `?path=../../x`, `?organizationId=${other.organizationId}`, "?download=1"]) {
      expect(Buffer.compare(await (await visitor.get(`/assets/${id}${query}`)).body(), plain), query).toBe(0);
    }
  });

  test("a label with line breaks and quotes in it cannot reach a header or a path", async ({ clientAddresses }) => {
    const biz = await makeBusiness("inject", db);
    const id = await addReadyLogo(pool, biz.organizationId, { filename: 'evil"\r\nX-Injected: yes\r\nContent-Disposition: attachment; filename="x"' });
    await setLogo(pool, biz.organizationId, id);
    const response = await (await anonymous(clientAddresses(), null)).get(`/assets/${id}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-injected"]).toBeUndefined();
    expect(response.headers()["content-disposition"]).toBe("inline");
    expect(JSON.stringify(response.headers())).not.toMatch(/evil|injected|attachment/i);
  });
});

test.describe("everything else is the same plain 404", () => {
  test("an unknown id, a pending or failed upload, a replaced or removed logo, a file that was never the logo: indistinguishable", async ({ clientAddresses }) => {
    const biz = await makeBusiness("nothing", db);
    const visitor = await anonymous(clientAddresses(), null);
    const first = await addReadyLogo(pool, biz.organizationId);
    await setLogo(pool, biz.organizationId, first);
    const spare = await addReadyLogo(pool, biz.organizationId); // ready, but not chosen
    const replacing = await addReadyLogo(pool, biz.organizationId);
    await setLogo(pool, biz.organizationId, replacing); // `first` is now a replaced logo
    const removedLogo = await addReadyLogo(pool, biz.organizationId);
    await setLogo(pool, biz.organizationId, removedLogo);
    await setLogo(pool, biz.organizationId, null); // and now nothing is chosen at all

    const ids = {
      unknown: randomUUID(),
      nil: "00000000-0000-0000-0000-000000000000",
      pending: await row(biz.organizationId, "pending"),
      failed: await row(biz.organizationId, "failed"),
      spare,
      replaced: first,
      removed: removedLogo,
      neverChosen: replacing,
    };
    const answers: Record<string, { status: number; text: string; type: string | undefined; cache: string | undefined }> = {};
    for (const [label, id] of Object.entries(ids)) {
      const response = await visitor.get(`/assets/${id}`);
      answers[label] = { status: response.status(), text: await response.text(), type: response.headers()["content-type"], cache: response.headers()["cache-control"] };
    }
    for (const [label, answer] of Object.entries(answers)) {
      expect(answer.status, label).toBe(404);
      expect(answer, label).toEqual(answers.unknown);
    }
    expect(answers.unknown.text).toBe("Not found");
    expect(answers.unknown.cache).toBe("no-store");
  });

  test("a storage key, a path, an upper-case id, a malformed id and a file address are not Assets", async ({ clientAddresses }) => {
    const biz = await makeBusiness("keys", db);
    const id = await addReadyLogo(pool, biz.organizationId);
    await setLogo(pool, biz.organizationId, id);
    const visitor = await anonymous(clientAddresses(), null);
    const key = assetKey(biz.organizationId, id);
    const addresses = [
      `/assets/${encodeURIComponent(key)}`,
      `/assets/${key}`,
      `/assets/${id}/normalized`,
      `/assets/${id.toUpperCase()}`,
      `/assets/${id}%00`,
      `/assets/${id}.webp`,
      `/assets/${encodeURIComponent(`../${id}`)}`,
      `/assets/..%2F..%2Fetc%2Fpasswd`,
      `/assets/${biz.organizationId}`,
      `/assets/`,
      `/assets`,
      `/assets/%2e%2e/%2e%2e/package.json`,
      `/.data/assets-test/${biz.organizationId}/${id}/normalized`,
      `/${key}`,
    ];
    for (const address of addresses) {
      const response = await visitor.get(address, { maxRedirects: 0 });
      expect([404, 307, 308], address).toContain(response.status());
      const body = await response.body();
      expect(sniffImageType(body), address).toBeNull();
      expect(body.toString("utf8"), address).not.toMatch(/"name":\s*"climvia"|root:|\[extensions\]/);
    }
  });

  test("an asset recorded against a driver this server is not configured for is a generic 'unavailable', naming no bucket or key", async ({ clientAddresses }) => {
    const biz = await makeBusiness("driver", db);
    const id = randomUUID();
    await pool.query(
      "insert into assets (id, organization_id, purpose, storage_driver, storage_key, original_filename, media_type, byte_size, width, height, checksum, status, ready_at) values ($1, $2, 'logo', 's3', $3, 'elsewhere.png', 'image/webp', 100, 10, 10, $4, 'ready', now())",
      [id, biz.organizationId, assetKey(biz.organizationId, id), "b".repeat(64)],
    );
    await setLogo(pool, biz.organizationId, id);
    const response = await (await anonymous(clientAddresses(), null)).get(`/assets/${id}`);
    expect(response.status()).toBe(503);
    const text = await response.text();
    expect(text).toBe("Unavailable");
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("an Asset whose file has gone missing from the store is a 404, not an error page", async ({ clientAddresses }) => {
    const biz = await makeBusiness("missing", db);
    const id = await addReadyLogo(pool, biz.organizationId);
    await setLogo(pool, biz.organizationId, id);
    await storage().delete(assetKey(biz.organizationId, id));
    const response = await (await anonymous(clientAddresses(), null)).get(`/assets/${id}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});
