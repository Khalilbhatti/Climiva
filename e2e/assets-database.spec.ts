/**
 * Phase 18A: tenant isolation and integrity of Assets and Organization Branding, and the one narrow PUBLIC read path, at the DATABASE,
 * independent of the application code.
 *
 * Like website-database.spec.ts, this connects to the freshly migrated and seeded test database as the restricted runtime role the app uses
 * (`climvia_app`, DATABASE_URL), sets the transaction-local context the way src/db/tenant.ts does, and checks that PostgreSQL itself keeps
 * businesses apart: Row Level Security for who may read and write, column grants for what may change, a composite foreign key for what may
 * point at what, and triggers for what a logo may be and how an Asset may change. Every test runs in a transaction that is rolled back, so
 * the standing businesses are never changed.
 *
 *   Alex    Apex owner        Jamie   Apex member (may look, may not change)
 *   Taylor  Northstar owner   Casey   admin in both
 *
 * The visitor path (`app_public_asset`) is called with NO context at all: that is what a request without a session looks like.
 */
import { randomUUID } from "node:crypto";
import { test, expect } from "playwright/test";
import { Pool, type PoolClient } from "pg";

const SEED = {
  alex: "alex.morgan@apex.test",
  jamie: "jamie.rivera@apex.test",
  taylor: "taylor.brooks@northstar.test",
  casey: "casey.nguyen@climvia.test",
};

let app: Pool;
let admin: Pool;
const user: Record<string, string> = {};
let apex = "";
let northstar = "";
/** The id of the Apex logo the seed stored. */
let apexLogo = "";

test.beforeAll(async () => {
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
  for (const [key, email] of Object.entries(SEED)) user[key] = (await admin.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0].id;
  apex = (await admin.query<{ id: string }>("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id;
  northstar = (await admin.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
  apexLogo = (await admin.query<{ id: string }>("select logo_asset_id as id from organization_branding where organization_id = $1", [apex])).rows[0].id;
});

test.afterAll(async () => {
  await app.end();
  await admin.end();
});

type Outcome<T> = { value: T; error?: undefined; code?: undefined; constraint?: undefined } | { value?: undefined; error: string; code?: string; constraint?: string };

const failure = (error: unknown): { error: string; code?: string; constraint?: string } => ({
  error: error instanceof Error ? error.message : String(error),
  code: (error as { code?: string }).code,
  constraint: (error as { constraint?: string }).constraint,
});

/** Run `fn` as `userId` inside `org` (either may be absent), in a transaction that is always rolled back. */
async function as<T>(userId: string | null, org: string | null, fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await app.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId ?? "", org ?? ""]);
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** The same through the owner role (no Row Level Security): for what only the seed may write, and to check constraints on their own. */
async function asOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await admin.connect();
  try {
    await client.query("begin");
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

const count = async (client: PoolClient, sql: string, params: unknown[] = []) => (await client.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n;
const PERMISSION = "42501";
const FOREIGN_KEY = "23503";
const CHECK = "23514";
const UNIQUE = "23505";
const CHECKSUM = "a".repeat(64);

type AssetRow = Record<string, unknown>;
/** A well-formed Asset row for `org`. `status` and the timestamps follow the lifecycle unless overridden. */
function assetRow(org: string, by: string | null, extra: AssetRow = {}): AssetRow {
  const id = (extra.id as string | undefined) ?? randomUUID();
  const status = (extra.status as string | undefined) ?? "pending";
  return {
    id,
    organization_id: org,
    purpose: "logo",
    storage_driver: "local",
    storage_key: `organizations/${org}/assets/${id}/normalized`,
    original_filename: "crest.png",
    media_type: "image/webp",
    byte_size: 1234,
    width: 64,
    height: 64,
    checksum: CHECKSUM,
    status,
    created_by_user_id: by,
    ready_at: status === "ready" ? new Date().toISOString() : null,
    deleted_at: status === "deleted" ? new Date().toISOString() : null,
    ...extra,
  };
}

async function insert(client: PoolClient, row: AssetRow): Promise<string> {
  const columns = Object.keys(row);
  const result = await client.query<{ id: string }>(
    `insert into assets (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning id`,
    columns.map((column) => row[column]),
  );
  return result.rows[0].id;
}

const makeReady = (client: PoolClient, id: string) => client.query("update assets set status = 'ready', ready_at = now() where id = $1", [id]);

test.describe("an Asset belongs to one organization", () => {
  test("every Asset names its organization, and the key can only be its own", async () => {
    const result = await asOwner(async (client) => {
      const columns = await client.query<{ column_name: string; is_nullable: string }>(
        "select column_name, is_nullable from information_schema.columns where table_name = 'assets' and column_name in ('organization_id', 'storage_key', 'checksum', 'status', 'purpose')",
      );
      return Object.fromEntries(columns.rows.map((row) => [row.column_name, row.is_nullable]));
    });
    expect(result.value).toEqual({ organization_id: "NO", storage_key: "NO", checksum: "NO", status: "NO", purpose: "NO" });
  });

  test("a key into another business's folder, another Asset's folder, a traversal or a made-up name is refused by the database", async () => {
    const own = randomUUID();
    const cases: [string, string][] = [
      ["another business's folder", `organizations/${northstar}/assets/${own}/normalized`],
      ["another Asset's folder", `organizations/${apex}/assets/${randomUUID()}/normalized`],
      ["a traversal", `organizations/${apex}/assets/${own}/../../../etc/passwd`],
      ["a filename", `organizations/${apex}/assets/${own}/normalized/../logo.png`],
      ["a bare name", "logo.png"],
    ];
    for (const [label, key] of cases) {
      const result = await asOwner((client) => insert(client, assetRow(apex, null, { id: own, storage_key: key })));
      expect(result.code, label).toBe(CHECK);
      expect(result.constraint, label).toBe("assets_storage_key_own");
    }
  });

  test("the lifecycle, the type, the purpose, the size and the checksum are constrained", async () => {
    const bad: [string, AssetRow, string][] = [
      ["SVG is not a stored type", { media_type: "image/svg+xml" }, "assets_media_type"],
      ["a GIF is not a stored type", { media_type: "image/gif" }, "assets_media_type"],
      ["an unknown purpose", { purpose: "document" }, "assets_purpose"],
      ["a zero-byte file", { byte_size: 0 }, "assets_byte_size"],
      ["a file over 10 MB", { byte_size: 10 * 1024 * 1024 + 1 }, "assets_byte_size"],
      ["a checksum that is not SHA-256 hex", { checksum: "not-a-hash" }, "assets_checksum"],
      ["an unknown driver", { storage_driver: "ftp" }, "assets_storage_driver"],
      // Two constraints refuse it; PostgreSQL names the first in name order.
      ["an unknown status", { status: "published", ready_at: null }, "assets_lifecycle"],
      ["ready without a ready time", { status: "ready", ready_at: null }, "assets_lifecycle"],
      ["pending with a ready time", { status: "pending", ready_at: new Date().toISOString() }, "assets_lifecycle"],
      ["a width of zero", { width: 0 }, "assets_dimensions"],
    ];
    for (const [label, extra, constraint] of bad) {
      const result = await asOwner((client) => insert(client, assetRow(apex, null, extra)));
      expect(result.code, label).toBe(CHECK);
      expect(result.constraint, label).toBe(constraint);
    }
    const twice = await asOwner(async (client) => {
      const id = randomUUID();
      await insert(client, assetRow(apex, null, { id }));
      await insert(client, assetRow(apex, null, { id: randomUUID(), storage_key: `organizations/${apex}/assets/${id}/normalized` }));
    });
    expect(twice.code).toBe(CHECK);
  });

  test("no binary or encoded image can be stored in the database: there is no column for one", async () => {
    const result = await asOwner(async (client) =>
      (await client.query<{ column_name: string; data_type: string }>("select column_name, data_type from information_schema.columns where table_name in ('assets', 'organization_branding')")).rows,
    );
    for (const column of result.value!) expect(["bytea", "oid", "json", "jsonb"], `${column.column_name}`).not.toContain(column.data_type);
  });

  test("the old logo and accent columns are gone from the organization: a URL could go stale or point at someone else's file", async () => {
    const result = await asOwner(async (client) => (await client.query("select column_name from information_schema.columns where table_name = 'organizations' and column_name in ('logo_url', 'brand_accent')")).rowCount);
    expect(result.value).toBe(0);
  });
});

test.describe("Row Level Security", () => {
  test("a member of a business reads that business's Assets and Branding, and only that business's", async () => {
    for (const who of ["alex", "jamie", "casey"]) {
      const result = await as(user[who], apex, async (client) => ({
        assets: await count(client, "select id from assets"),
        branding: await count(client, "select organization_id from organization_branding"),
        own: await count(client, "select id from assets where organization_id = $1", [apex]),
      }));
      expect(result.value, who).toEqual({ assets: 1, branding: 1, own: 1 });
    }
    const northstarView = await as(user.taylor, northstar, async (client) => ({ assets: await count(client, "select id from assets"), branding: await count(client, "select organization_id from organization_branding") }));
    expect(northstarView.value).toEqual({ assets: 0, branding: 0 });
  });

  test("cross-tenant SELECT: Taylor, in Northstar or pointed at Apex, sees none of Apex's; Alex sees none of Northstar's", async () => {
    const inApex = await as(user.taylor, apex, async (client) => ({ assets: await count(client, "select id from assets"), branding: await count(client, "select organization_id from organization_branding") }));
    expect(inApex.value).toEqual({ assets: 0, branding: 0 });
    // A row Northstar owns, written by the owner role, is invisible to Alex.
    const seen = await asOwner(async (client) => {
      const id = await insert(client, assetRow(northstar, null, { status: "ready" }));
      await client.query("set local role climvia_app");
      await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [user.alex, apex]);
      return count(client, "select id from assets where id = $1", [id]);
    });
    expect(seen.value).toBe(0);
  });

  test("cross-tenant INSERT: nobody can add an Asset to a business they do not own", async () => {
    const taylorIntoApex = await as(user.taylor, apex, (client) => insert(client, assetRow(apex, user.taylor)));
    expect(taylorIntoApex.code).toBe(PERMISSION);
    const alexIntoNorthstar = await as(user.alex, apex, (client) => insert(client, assetRow(northstar, user.alex)));
    expect(alexIntoNorthstar.code).toBe(PERMISSION);
    const alexNamedNorthstar = await as(user.alex, northstar, (client) => insert(client, assetRow(northstar, user.alex)));
    expect(alexNamedNorthstar.code).toBe(PERMISSION);
    // The same for the Branding row.
    const branding = await as(user.alex, apex, (client) => client.query("insert into organization_branding (organization_id) values ($1)", [northstar]));
    expect(branding.code).toBe(PERMISSION);
  });

  test("cross-tenant UPDATE: Taylor cannot change Apex's Asset or Branding, even pointed at Apex", async () => {
    const result = await as(user.taylor, apex, async (client) => ({
      asset: (await client.query("update assets set status = 'deleted', deleted_at = now() where id = $1", [apexLogo])).rowCount,
      branding: (await client.query("update organization_branding set logo_asset_id = null, accent = '#000000' where organization_id = $1", [apex])).rowCount,
    }));
    expect(result.value).toEqual({ asset: 0, branding: 0 });
  });

  test("DELETE is not possible for the runtime role, by anyone", async () => {
    for (const who of ["alex", "casey"]) {
      const asset = await as(user[who], apex, (client) => client.query("delete from assets where id = $1", [apexLogo]));
      expect(asset.code, who).toBe(PERMISSION);
      const branding = await as(user[who], apex, (client) => client.query("delete from organization_branding where organization_id = $1", [apex]));
      expect(branding.code, who).toBe(PERMISSION);
    }
  });

  test("with no context at all, the runtime role sees no private Asset and no Branding", async () => {
    const result = await as(null, null, async (client) => ({ assets: await count(client, "select id from assets"), branding: await count(client, "select organization_id from organization_branding") }));
    expect(result.value).toEqual({ assets: 0, branding: 0 });
    const guessed = await as(null, null, (client) => client.query("select id from assets where id = $1", [apexLogo]));
    expect(guessed.value!.rowCount).toBe(0);
  });

  test("an owner and an admin may add an Asset and set the Branding; a member may only look", async () => {
    for (const who of ["alex", "casey"]) {
      const result = await as(user[who], apex, async (client) => {
        const id = await insert(client, assetRow(apex, user[who]));
        await makeReady(client, id);
        const updated = await client.query("update organization_branding set logo_asset_id = $1, accent = '#17766B' where organization_id = $2", [id, apex]);
        return { id, updated: updated.rowCount, now: (await client.query("select logo_asset_id, accent from organization_branding where organization_id = $1", [apex])).rows[0] };
      });
      expect(result.value!.updated, who).toBe(1);
      expect(result.value!.now, who).toEqual({ logo_asset_id: result.value!.id, accent: "#17766B" });
    }
    const memberInsert = await as(user.jamie, apex, (client) => insert(client, assetRow(apex, user.jamie)));
    expect(memberInsert.code).toBe(PERMISSION);
    const memberBranding = await as(user.jamie, apex, async (client) => ({
      update: (await client.query("update organization_branding set accent = '#000000' where organization_id = $1", [apex])).rowCount,
      assetUpdate: (await client.query("update assets set status = 'deleted', deleted_at = now() where id = $1", [apexLogo])).rowCount,
    }));
    expect(memberBranding.value).toEqual({ update: 0, assetUpdate: 0 });
  });

  test("a new Asset is born pending and is the author's own: it cannot arrive ready, or in someone else's name", async () => {
    const ready = await as(user.alex, apex, (client) => insert(client, assetRow(apex, user.alex, { status: "ready" })));
    expect(ready.code).toBe(PERMISSION);
    const anonymous = await as(user.alex, apex, (client) => insert(client, assetRow(apex, null)));
    expect(anonymous.code).toBe(PERMISSION);
    const inSomeoneElsesName = await as(user.alex, apex, (client) => insert(client, assetRow(apex, user.taylor)));
    expect(inSomeoneElsesName.code).toBe(PERMISSION);
  });
});

test.describe("what an Asset may become, and what may be a logo", () => {
  test("Branding is one row per organization, and its organization never changes", async () => {
    const second = await asOwner((client) => client.query("insert into organization_branding (organization_id) values ($1)", [apex]));
    expect(second.code).toBe(UNIQUE);
    const move = await as(user.alex, apex, (client) => client.query("update organization_branding set organization_id = $1 where organization_id = $2", [northstar, apex]));
    expect(move.code).toBe(PERMISSION);
  });

  test("Branding can reference its own ready logo", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const id = await insert(client, assetRow(apex, user.alex));
      await makeReady(client, id);
      await client.query("update organization_branding set logo_asset_id = $1 where organization_id = $2", [id, apex]);
      return (await client.query<{ logo_asset_id: string }>("select logo_asset_id from organization_branding where organization_id = $1", [apex])).rows[0].logo_asset_id === id;
    });
    expect(result.value).toBe(true);
  });

  test("Branding cannot reference another organization's Asset: refused by the guard, and independently by the composite foreign key", async () => {
    // 1. With everything in place, the guard refuses it first (a foreign Asset is not one of the business's own ready logos).
    const viaOwner = await asOwner(async (client) => {
      const id = await insert(client, assetRow(northstar, null, { status: "ready" }));
      await client.query("update organization_branding set logo_asset_id = $1 where organization_id = $2", [id, apex]);
    });
    expect(viaOwner.code).toBe(CHECK);
    expect(viaOwner.constraint).toBe("organization_branding_logo_ready");
    const viaApp = await as(user.alex, apex, (client) => client.query("update organization_branding set logo_asset_id = $1 where organization_id = $2", [randomUUID(), apex]));
    expect(viaApp.code).toBe(CHECK);

    // 2. The foreign key is a second, separate defence: with the guard switched off (in a transaction that is rolled back) a reference to
    //    another business's Asset is STILL impossible, through the owner's connection and the application's alike.
    const updateWithoutGuard = await asOwner(async (client) => {
      await client.query("alter table organization_branding disable trigger organization_branding_guard");
      const id = await insert(client, assetRow(northstar, null, { status: "ready" }));
      await client.query("update organization_branding set logo_asset_id = $1 where organization_id = $2", [id, apex]);
    });
    expect(updateWithoutGuard.code).toBe(FOREIGN_KEY);
    expect(updateWithoutGuard.constraint).toBe("organization_branding_logo_fk");
    const insertWithoutGuard = await asOwner(async (client) => {
      await client.query("alter table organization_branding disable trigger organization_branding_guard");
      await client.query("insert into organization_branding (organization_id, logo_asset_id) values ($1, $2)", [northstar, apexLogo]);
    });
    expect(insertWithoutGuard.code).toBe(FOREIGN_KEY);
    expect(insertWithoutGuard.constraint).toBe("organization_branding_logo_fk");
  });

  test("a pending, failed or deleted Asset can never be the logo", async () => {
    for (const status of ["pending", "failed", "deleted"]) {
      const result = await as(user.alex, apex, async (client) => {
        const id = await insert(client, assetRow(apex, user.alex));
        if (status === "failed") await client.query("update assets set status = 'failed' where id = $1", [id]);
        if (status === "deleted") {
          await makeReady(client, id);
          await client.query("update assets set status = 'deleted', deleted_at = now() where id = $1", [id]);
        }
        await client.query("update organization_branding set logo_asset_id = $1 where organization_id = $2", [id, apex]);
      });
      expect(result.code, status).toBe(CHECK);
      expect(result.constraint, status).toBe("organization_branding_logo_ready");
    }
  });

  test("an Asset's status only moves forward, and its identity and content never change", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const id = await insert(client, assetRow(apex, user.alex));
      const outcomes: Record<string, string | undefined> = {};
      const attempt = async (label: string, sql: string) => {
        await client.query("savepoint s");
        try {
          await client.query(sql, [id]);
          outcomes[label] = "allowed";
        } catch (error) {
          outcomes[label] = (error as { code?: string }).code;
          await client.query("rollback to savepoint s");
        }
      };
      await attempt("pending to deleted", "update assets set status = 'deleted', deleted_at = now() where id = $1");
      await attempt("pending to ready", "update assets set status = 'ready', ready_at = now() where id = $1");
      await attempt("ready to pending", "update assets set status = 'pending', ready_at = null where id = $1");
      await attempt("ready to failed", "update assets set status = 'failed', ready_at = null where id = $1");
      for (const column of ["storage_key", "checksum", "byte_size", "media_type", "original_filename", "organization_id", "purpose", "width", "created_by_user_id"]) {
        await attempt(`change ${column}`, `update assets set ${column} = ${column} where id = $1`);
      }
      await attempt("ready to deleted", "update assets set status = 'deleted', deleted_at = now() where id = $1");
      return outcomes;
    });
    expect(result.value).toMatchObject({ "pending to deleted": CHECK, "pending to ready": "allowed", "ready to pending": CHECK, "ready to failed": CHECK, "ready to deleted": "allowed" });
    // No column but the status and its two timestamps is even writable by the runtime role.
    for (const column of ["storage_key", "checksum", "byte_size", "media_type", "original_filename", "organization_id", "purpose", "width", "created_by_user_id"]) {
      expect(result.value![`change ${column}`], column).toBe(PERMISSION);
    }
  });

  test("a failed upload can fail, and a failed Asset can only be deleted", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const id = await insert(client, assetRow(apex, user.alex));
      await client.query("update assets set status = 'failed' where id = $1", [id]);
      const back = await client.query("update assets set status = 'ready', ready_at = now() where id = $1", [id]).then(() => "allowed", (error: { code?: string }) => error.code);
      return back;
    });
    expect(result.value).toBe(CHECK);
  });

  test("an Asset that is a business's logo cannot be deleted", async () => {
    const result = await as(user.alex, apex, (client) => client.query("update assets set status = 'deleted', deleted_at = now() where id = $1", [apexLogo]));
    expect(result.code).toBe(FOREIGN_KEY);
    expect(result.constraint).toBe("assets_in_use");
  });

  test("the accent is a six-digit upper-case hex colour or nothing", async () => {
    for (const bad of ["red", "#abc", "#0d5c63", "#12345G", "0D5C63"]) {
      const result = await as(user.alex, apex, (client) => client.query("update organization_branding set accent = $1 where organization_id = $2", [bad, apex]));
      expect(result.code, bad).toBe(CHECK);
    }
    const none = await as(user.alex, apex, (client) => client.query("update organization_branding set accent = null where organization_id = $1", [apex]));
    expect(none.value!.rowCount).toBe(1);
  });

  test("changing the Branding moves its updated_at", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const before = (await client.query<{ at: Date }>("select updated_at as at from organization_branding where organization_id = $1", [apex])).rows[0].at;
      await client.query("update organization_branding set accent = '#8B3A1E' where organization_id = $1", [apex]);
      const after = (await client.query<{ at: Date }>("select updated_at as at from organization_branding where organization_id = $1", [apex])).rows[0].at;
      return after.getTime() > before.getTime();
    });
    expect(result.value).toBe(true);
  });
});

test.describe("the public path", () => {
  const publicAsset = async (client: PoolClient, id: string) => (await client.query<{ asset: Record<string, unknown> | null }>("select app_public_asset($1::uuid) as asset", [id])).rows[0].asset;

  test("with no session, a business's current ready logo is found, and only what the server needs to fetch it is returned", async () => {
    const result = await as(null, null, (client) => publicAsset(client, apexLogo));
    expect(Object.keys(result.value!).sort()).toEqual(["byteSize", "checksum", "mediaType", "storageDriver", "storageKey"]);
    expect(result.value!.mediaType).toBe("image/webp");
    expect(result.value!.storageKey).toBe(`organizations/${apex}/assets/${apexLogo}/normalized`);
  });

  test("an unknown id, a pending or failed upload, a replaced logo and a removed logo are all the same nothing", async () => {
    const unknown = await as(null, null, (client) => publicAsset(client, randomUUID()));
    expect(unknown.value).toBeNull();
    const nothing = await as(null, null, async (client) => (await client.query("select app_public_asset(null::uuid) as asset")).rows[0].asset);
    expect(nothing.value).toBeNull();

    const steps = await asOwner(async (client) => {
      const out: Record<string, unknown> = {};
      const pending = await insert(client, assetRow(apex, null));
      out.pending = await publicAsset(client, pending);
      const failed = await insert(client, assetRow(apex, null, { status: "failed" }));
      out.failed = await publicAsset(client, failed);
      // Ready, but not the chosen logo: an Asset is not public because it exists.
      const spare = await insert(client, assetRow(apex, null, { status: "ready" }));
      out.spare = await publicAsset(client, spare);
      // Chosen: public. Replaced: the old one is not.
      await client.query("update organization_branding set logo_asset_id = $1 where organization_id = $2", [spare, apex]);
      out.chosen = (await publicAsset(client, spare)) !== null;
      out.replaced = await publicAsset(client, apexLogo);
      // Removed: neither.
      await client.query("update organization_branding set logo_asset_id = null where organization_id = $1", [apex]);
      out.removed = await publicAsset(client, spare);
      return out;
    });
    expect(steps.value).toEqual({ pending: null, failed: null, spare: null, chosen: true, replaced: null, removed: null });
  });

  test("another business's logo is public as that business's", async () => {
    const result = await asOwner(async (client) => {
      const mine = await insert(client, assetRow(northstar, null, { status: "ready" }));
      await client.query("insert into organization_branding (organization_id, logo_asset_id) values ($1, $2)", [northstar, mine]);
      const found = await publicAsset(client, mine);
      return (found?.storageKey as string).startsWith(`organizations/${northstar}/`);
    });
    expect(result.value).toBe(true);
  });

  test("the public Site and listing carry the logo as an Asset id and nothing about where it is stored", async () => {
    const result = await as(null, null, async (client) => {
      const site = (await client.query<{ site: Record<string, unknown> }>("select app_public_site('apexclimate', '') as site")).rows[0].site;
      const listing = (await client.query<{ listing: Record<string, unknown> }>("select app_public_listing('apex-climate-heating-air') as listing")).rows[0].listing;
      const northstarSite = (await client.query<{ site: Record<string, unknown> }>("select app_public_site('northstar', '') as site")).rows[0].site;
      return { site, listing, northstarSite };
    });
    const { site, listing, northstarSite } = result.value!;
    expect((site.organization as { logo: unknown }).logo).toEqual({ assetId: apexLogo });
    expect((listing.organization as { logo: unknown }).logo).toEqual({ assetId: apexLogo });
    expect((northstarSite.organization as { logo: unknown }).logo).toBeNull();
    for (const projection of [site, listing, northstarSite]) {
      const text = JSON.stringify(projection);
      expect(text).not.toMatch(/storageKey|storage_key|organizations\/[0-9a-f-]{36}\/assets|\.data|bucket/i);
    }
  });

  test("the function is executable by the runtime role and by nobody else", async () => {
    const result = await asOwner(async (client) => {
      const rows = (
        await client.query<{ grantee: string }>(
          "select grantee from information_schema.routine_privileges where routine_name = 'app_public_asset' and privilege_type = 'EXECUTE' order by 1",
        )
      ).rows;
      return rows.map((row) => row.grantee);
    });
    expect(result.value).not.toContain("PUBLIC");
    expect(result.value).toContain("climvia_app");
  });
});
