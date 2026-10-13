/**
 * Phase 18A: the durability claim, tested as a claim about the application and not about React. A logo is saved through the running server;
 * then NEW server processes, started from nothing, with the same database and the same storage directory and none of the first one's memory,
 * are asked for it. If the logo were held in a process, a browser or anything that dies with either, they could not give it back.
 *
 * (A reload of the page, a new session and a new browser are checked in branding-settings.spec.ts; this is the part that needs a process to stop.)
 */
import { createHash } from "node:crypto";
import { expect, request as playwrightRequest } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { assetKey } from "../src/storage";
import { createLocalStorage } from "../src/storage/local";
import { bodyOf, brandingForm, file, makeBusiness, picture, signedIn, startServer } from "./assets-helpers";
import { test } from "./saas";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("a saved logo is given back by a server process started afterwards, and by another started after that", async ({ clientAddresses }, testInfo) => {
  test.setTimeout(240_000);
  const { pool, db } = adminDb();
  try {
    const biz = await makeBusiness("durable", db);
    const owner = await signedIn(biz.owner.email, clientAddresses());
    const saved = await owner.post("/api/branding", { multipart: brandingForm({ logo: file(await picture("png", 320, 200), "Durable Crest.png"), accent: "#17766B" }) });
    expect(saved.status()).toBe(200);
    const { branding } = (await bodyOf(saved)) as { branding: { logo: { src: string; fileName: string } } };
    const id = branding.logo.src.replace("/assets/", "");

    // What was stored: the file in the directory, and the row that describes it.
    const key = assetKey(biz.organizationId, id);
    const onDisk = (await createLocalStorage(process.env.ASSET_LOCAL_DIR!).get(key))!;
    const row = (await pool.query("select checksum, byte_size from assets where id = $1", [id])).rows[0];
    expect(sha256(onDisk.body)).toBe(row.checksum);
    expect(onDisk.size).toBe(row.byte_size);

    const port = 3500 + testInfo.parallelIndex;
    for (const label of ["first", "second"]) {
      // A server that did not exist when the logo was saved: nothing in its memory, only the database and the directory.
      const server = await startServer(port, {});
      try {
        const served = await playwrightRequest.newContext({ baseURL: server.origin, storageState: { cookies: [], origins: [] } });
        const answer = await served.get(`/assets/${id}`);
        expect(answer.status(), `${label} server`).toBe(200);
        expect(answer.headers()["content-type"]).toBe("image/webp");
        expect(sha256(await answer.body()), `${label} server`).toBe(row.checksum);
        // The business's own Settings, on that server, signed in afresh on that server, name the same logo and file.
        const settings = await (await signedIn(biz.owner.email, clientAddresses(), server.origin)).get("/settings/branding");
        const html = await settings.text();
        expect(html, `${label} server`).toContain(`/assets/${id}`);
        expect(html, `${label} server`).toContain("Durable Crest.png");
        expect(html, `${label} server`).toContain("#17766B");
        await served.dispose();
      } finally {
        server.stop();
      }
      // Stopped, and still there: the next server is a different process again.
      await expect.poll(async () => (await createLocalStorage(process.env.ASSET_LOCAL_DIR!).exists(key)), { message: "the file after the server stopped" }).toBe(true);
    }
  } finally {
    await pool.end();
  }
});
