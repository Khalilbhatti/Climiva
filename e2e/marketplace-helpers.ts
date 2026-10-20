/**
 * Shared by the Marketplace discovery specs (not a spec itself: a helper exported from a `*.spec.ts` would register that file's tests again).
 *
 * Every test that needs a provider makes ITS OWN: a business with a word in its name that no other test or seed uses (`token`), so a search for that
 * word finds exactly that provider however many other tests are publishing listings in parallel. The index of the whole Marketplace changes whenever any
 * test publishes or hides a listing, so no spec in this family asserts on it as a whole.
 */
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { makeBusiness, type Business } from "./assets-helpers";

export type AreaSpec = { city?: string; state?: string; postal?: string; label?: string };
export type ReviewSpec = { rating: number; text?: string; reviewer?: string; visibility?: "public" | "private"; on?: string };

export type ProviderOptions = {
  status?: "published" | "hidden" | "draft";
  /** Service addresses of the standing sample business's catalog (a new business is given all of them). Default: the first two. */
  services?: string[];
  areas?: AreaSpec[];
  reviews?: ReviewSpec[];
  description?: string;
  suspended?: boolean;
  show?: Partial<{ phone: boolean; email: boolean; address: boolean; hours: boolean; website: boolean }>;
  actions?: Partial<{ book: boolean; website: boolean; contact: boolean }>;
  /** A word to put in the business's name, besides the unique token. */
  nameWord?: string;
};

export type Provider = {
  business: Business;
  listingId: string;
  /** The listing's public address: `/listings/<slug>`. */
  slug: string;
  /** A word that is in this provider's name and nobody else's. */
  token: string;
  name: string;
};

export const SAMPLE_SERVICES = {
  repair: "ac-repair-diagnostics",
  tuneUp: "annual-cooling-tune-up",
  heatPump: "heat-pump-diagnostics-repair",
  ductless: "ductless-mini-split-estimate",
  furnace: "furnace-safety-inspection",
} as const;

type MakeBusinessDb = Parameters<typeof makeBusiness>[1];

/** A business with a published (by default) Marketplace listing, the Services, service areas and public reviews asked for. */
export async function makeProvider(label: string, handles: { db: MakeBusinessDb; pool: Pool }, options: ProviderOptions = {}): Promise<Provider> {
  const { db, pool } = handles;
  const business = await makeBusiness(label, db);
  const token = `mk${randomBytes(4).toString("hex")}`;
  const name = `${options.nameWord ?? "Meridian"} ${token} Climate`;
  await pool.query("update organizations set name = $2 where id = $1", [business.organizationId, name]);

  const slug = `prov-${token}`;
  const status = options.status ?? "published";
  const show = { phone: true, email: true, address: true, hours: true, website: true, ...options.show };
  const actions = { book: true, website: true, contact: true, ...options.actions };
  const inserted = await pool.query<{ id: string }>(
    `insert into marketplace_listings (organization_id, public_slug, status, description, published_at, show_phone, show_email, show_address, show_hours, show_website, action_book, action_website, action_contact)
     values ($1, $2, $3, $4, case when $3 = 'draft' then null else now() end, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [business.organizationId, slug, status, options.description ?? `${name} repairs and maintains heating and cooling systems.`, show.phone, show.email, show.address, show.hours, show.website, actions.book, actions.website, actions.contact],
  );
  const listingId = inserted.rows[0].id;

  // A new business starts with no Services: it is given the sample business's catalog, copied (every column but its own identity), so it offers the same Services.
  const columns = (
    await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name not in ('id', 'organization_id', 'created_at', 'updated_at') order by ordinal_position")
  ).rows.map((row) => `"${row.column_name}"`).join(", ");
  await pool.query(`insert into services (organization_id, ${columns}) select $1, ${columns} from services where organization_id = (select id from organizations where slug = 'apex-climate-heating-air')`, [business.organizationId]);

  const wanted = options.services ?? [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp];
  for (const [index, service] of wanted.entries()) {
    const found = await pool.query<{ id: string }>("select id from services where organization_id = $1 and slug = $2", [business.organizationId, service]);
    if (!found.rows[0]) throw new Error(`the new business has no Service "${service}"`);
    await pool.query("insert into marketplace_listing_services (organization_id, listing_id, service_id, sort_order) values ($1, $2, $3, $4)", [business.organizationId, listingId, found.rows[0].id, index]);
  }

  for (const [index, area] of (options.areas ?? []).entries()) {
    await pool.query(
      "insert into marketplace_service_areas (organization_id, listing_id, city, state_region, postal_code, label, sort_order) values ($1, $2, $3, $4, $5, $6, $7)",
      [business.organizationId, listingId, area.city ?? null, area.state ?? null, area.postal ?? null, area.label ?? null, index],
    );
  }

  for (const [index, review] of (options.reviews ?? []).entries()) {
    await pool.query(
      "insert into reviews (organization_id, slug, contact_name, source, rating, review_text, submitted_on, visibility) values ($1, $2, $3, 'Climvia', $4, $5, $6::date, $7)",
      [business.organizationId, `rev-${token}-${index}`, review.reviewer ?? "Jordan Rivera", review.rating, review.text ?? "Did the job well.", review.on ?? "2024-10-20", review.visibility ?? "public"],
    );
  }

  if (options.suspended) await suspend(pool, listingId);
  return { business, listingId, slug, token, name };
}

/** The platform's decision on a listing, written the way the console does (a new suspension starts its lifecycle afresh, with its own start time). */
export async function suspend(pool: Pool, listingId: string, reason = "Test suspension", tenantMessage: string | null = null): Promise<void> {
  await pool.query(
    `insert into platform_listing_moderation (listing_id, state, reason, tenant_message, suspended_at, decided_by) values ($1, 'suspended', $2, $3, now(), 'test-administrator')
     on conflict (listing_id) do update set state = 'suspended', reason = excluded.reason, tenant_message = excluded.tenant_message, suspended_at = now(), decided_at = now(),
       revision = platform_listing_moderation.revision + 1, review_state = 'none', review_requested_at = null, review_requested_by = null, review_note = null, review_resolved_at = null, review_outcome = null`,
    [listingId, reason, tenantMessage],
  );
}

export async function allow(pool: Pool, listingId: string): Promise<void> {
  await pool.query(
    `insert into platform_listing_moderation (listing_id, state, reason, decided_by) values ($1, 'allowed', null, 'test-administrator')
     on conflict (listing_id) do update set state = 'allowed', reason = null, tenant_message = null, suspended_at = null, decided_at = now(), revision = platform_listing_moderation.revision + 1,
       review_state = 'none', review_requested_at = null, review_requested_by = null, review_note = null, review_resolved_at = null, review_outcome = null`,
    [listingId],
  );
}

/** What a visitor's search for a provider's own word shows: the path of the search page. */
export const searchFor = (token: string, extra = "") => `/marketplace?q=${encodeURIComponent(token)}${extra}`;
