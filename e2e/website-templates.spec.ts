/**
 * Phase 17: the application's website Templates as DATA. Four Templates (the starter and three more), each a validated definition that
 * chooses registered section types and variants and gives them neutral, truthful copy; the registry additions and the one theme token
 * (the design style) that make them different; and the rows the migration wrote, which must be the very same definitions.
 *
 * No browser here. The Gallery, the preview, applying a Template and the public pages are in website-templates-ui.spec.ts and
 * website-templates-render.spec.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { Pool } from "pg";
import { DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_KEY } from "../src/db/default-template";
import { TEMPLATE_CATALOG, TEMPLATE_KEYS, findTemplateRecord, type TemplateRecord } from "../src/db/site-templates";
import { MAX_PAGES, MAX_SECTIONS_PER_PAGE, TEMPLATE_SCHEMA, validateContent, validateTemplateDefinition, type TemplateDefinition } from "../src/lib/site-template";
import {
  SECTION_LIBRARY,
  SECTION_REGISTRY,
  SECTION_TYPES,
  defaultPropsFor,
  fieldsOf,
  textProblem,
  validateProps,
  variantDef,
  variantDescription,
  variantLabel,
} from "../src/lib/site-sections";
import { DEFAULT_THEME, THEME_LOOKS, lookOf, readTheme, themeAttributes, validateTheme } from "../src/lib/site-theme";
import { APEX_CONTENT, CUSTOMERS, NORTHSTAR_CONTENT, SERVICES } from "./apex-data";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const KEYS = ["climvia-starter", "precision", "comfort", "airflow"] as const;
const PAGE_KEYS = ["home", "services", "about", "contact", "booking"];

const byKey = (key: string): TemplateRecord => {
  const record = findTemplateRecord(key);
  if (!record) throw new Error(`No template ${key}`);
  return record;
};

/** What a page is made of, in order: "hero:split", "service_list:grid" ... */
const shape = (definition: TemplateDefinition, pageKey: string): string[] =>
  definition.pages.find((page) => page.key === pageKey)!.sections.map((section) => `${section.type}:${section.variant}`);

/** Every variant a Template uses anywhere, as "type:variant". */
const variantsUsed = (definition: TemplateDefinition): Set<string> => new Set(PAGE_KEYS.flatMap((key) => shape(definition, key)));

const pairs = <T>(list: readonly T[]): [T, T][] => list.flatMap((first, index) => list.slice(index + 1).map((second): [T, T] => [first, second]));

test.describe("the catalogue", () => {
  test("there are exactly four Templates, in a fixed order, with the names and keys the product gives them", () => {
    expect(TEMPLATE_CATALOG.map((template) => template.key)).toEqual([...KEYS]);
    expect([...TEMPLATE_KEYS]).toEqual([...KEYS]);
    expect(TEMPLATE_CATALOG.map((template) => template.name)).toEqual(["Climvia Starter", "Precision", "Comfort", "Airflow"]);
    expect(DEFAULT_TEMPLATE_KEY).toBe("climvia-starter");
    expect(new Set(TEMPLATE_CATALOG.map((template) => template.key)).size).toBe(4);
    expect(TEMPLATE_CATALOG[0].definition).toBe(DEFAULT_TEMPLATE);
  });

  test("each has metadata that fits what the table accepts and what the Gallery shows", () => {
    for (const template of TEMPLATE_CATALOG) {
      expect(template.key, template.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(template.key.length).toBeLessThanOrEqual(60);
      expect(template.name.trim().length).toBeGreaterThan(0);
      expect(template.name.length).toBeLessThanOrEqual(80);
      expect(template.category, template.key).toBe("hvac");
      expect(template.description.length, template.key).toBeGreaterThan(20);
      expect(template.description.length, template.key).toBeLessThanOrEqual(160);
      expect(template.style.length, template.key).toBeGreaterThan(0);
      expect(template.tags.length, template.key).toBeLessThanOrEqual(2);
      expect(template.definition.schema, template.key).toBe(TEMPLATE_SCHEMA);
    }
    // Four different descriptions and style labels: the Gallery's cards say different things.
    expect(new Set(TEMPLATE_CATALOG.map((template) => template.description)).size).toBe(4);
    expect(new Set(TEMPLATE_CATALOG.map((template) => template.style)).size).toBe(4);
  });
});

test.describe("every Template is a valid definition", () => {
  for (const key of KEYS) {
    test(`${key}: it passes the same validation a stored Template and a Draft pass`, () => {
      const { definition } = byKey(key);
      const result = validateTemplateDefinition(clone(definition));
      expect(result.ok, JSON.stringify(result.ok ? [] : result.problems)).toBe(true);
      // And the content on its own, as a Draft would be validated when it is saved or published.
      const { schema: _schema, ...content } = clone(definition);
      void _schema;
      expect(validateContent(content).ok).toBe(true);
    });

    test(`${key}: five pages with the standard keys and addresses, one home, a booking page that lists the Services, all within the limits`, () => {
      const { definition } = byKey(key);
      expect(definition.pages.map((page) => page.key)).toEqual(PAGE_KEYS);
      expect(definition.pages.map((page) => page.slug)).toEqual(["", "services", "about", "contact", "booking"]);
      expect(definition.pages.map((page) => page.type)).toEqual(["home", "services", "content", "contact", "booking"]);
      expect(definition.pages.every((page) => page.visible)).toBe(true);
      expect(definition.pages.filter((page) => page.type === "home")).toHaveLength(1);
      expect(new Set(definition.pages.map((page) => page.slug)).size).toBe(5);
      const booking = definition.pages.find((page) => page.type === "booking")!;
      expect(booking.sections.some((section) => section.type === "service_list" && section.visible)).toBe(true);
      // Comfortably inside the Builder's limits, so a business has room to add pages and sections.
      expect(definition.pages.length).toBeLessThanOrEqual(MAX_PAGES / 2);
      for (const page of definition.pages) {
        expect(page.sections.length, `${key}/${page.key}`).toBeLessThanOrEqual(MAX_SECTIONS_PER_PAGE / 4);
        expect(new Set(page.sections.map((section) => section.key)).size, `${key}/${page.key}`).toBe(page.sections.length);
      }
    });

    test(`${key}: every section is a registered type and variant, with exactly the properties that variant declares`, () => {
      const { definition } = byKey(key);
      for (const page of definition.pages) {
        for (const section of page.sections) {
          const where = `${key}/${page.key}/${section.key}`;
          expect(variantDef(section.type, section.variant), where).toBeDefined();
          const declared = fieldsOf(section.type, section.variant).map((field) => field.key);
          expect(Object.keys(section.props).sort(), where).toEqual([...declared].sort());
          expect(validateProps(section.type, section.variant, section.props).ok, where).toBe(true);
          expect(section.label.trim().length, where).toBeGreaterThan(0);
        }
      }
    });

    test(`${key}: it holds data, not code (no markup, script, link or event handler anywhere in it) and survives a round trip through JSON unchanged`, () => {
      const { definition } = byKey(key);
      const json = JSON.stringify(definition);
      expect(json).not.toMatch(/[<>]/);
      expect(json).not.toMatch(/javascript:|data:|vbscript:|\bon[a-z]+\s*=|<script|style=|className|dangerouslySetInnerHTML/i);
      expect(JSON.parse(json)).toEqual(definition);
      // The only keys a definition has.
      expect(Object.keys(definition).sort()).toEqual(["pages", "schema", "settings", "theme"]);
      for (const page of definition.pages) expect(Object.keys(page).sort()).toEqual(["key", "sections", "slug", "title", "type", "visible"]);
      for (const text of JSON.stringify(definition.pages).match(/"(?:[^"\\]|\\.)*"/g) ?? []) expect(textProblem(JSON.parse(text) as string), text).toBeUndefined();
    });
  }
});

test.describe("they name no business, hold no tenant's data and make no claim about one", () => {
  const everything = (definition: TemplateDefinition) => JSON.stringify(definition);

  for (const key of KEYS) {
    test(`${key}: no sample business, person, phone number, email, address, price or Service from any organization`, () => {
      const json = everything(byKey(key).definition);
      expect(json).not.toMatch(/Apex|Northstar|Austin|Denver|Morgan|Rivera|Brooks|Nguyen/);
      expect(json).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}|\d{3}-\d{3}-\d{4}/);
      expect(json).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[a-z]{2,}/);
      expect(json).not.toMatch(/\$\s?\d/);
      expect(json).not.toMatch(/\b\d{5}\b/);
      for (const service of SERVICES) expect(json, service.name).not.toContain(service.name);
      for (const customer of CUSTOMERS) expect(json, customer.name).not.toContain(customer.name);
      // Nothing of either standing website's authored copy: what a business wrote over the starter (the starter's own neutral words are
      // in their sites too, and are not theirs).
      const starterWords = new Set(DEFAULT_TEMPLATE.pages.flatMap((page) => page.sections.flatMap((section) => Object.values(section.props))));
      for (const content of [APEX_CONTENT, NORTHSTAR_CONTENT]) {
        const authored = content.pages.flatMap((page) => page.sections.flatMap((section) => Object.values(section.props))).filter((value) => !starterWords.has(value));
        expect(authored.length, "the standing sites do have authored copy to compare with").toBeGreaterThan(0);
        for (const value of authored) expect(json, value).not.toContain(value);
      }
    });

    test(`${key}: only the business's name and place are text tokens; the rest is read from its record when a page is drawn, never copied`, () => {
      const { definition } = byKey(key);
      const json = JSON.stringify(definition);
      expect(json.match(/\{\{[^}]*\}\}/g)?.every((token) => token === "{{business.name}}" || token === "{{business.location}}")).toBe(true);
      for (const page of definition.pages) {
        for (const section of page.sections) {
          // A section bound to Services, hours or contact details has no property for them: a Service's name, price and duration are not here.
          if (section.type === "service_list") expect(Object.keys(section.props).every((name) => name === "heading" || name === "supportingText")).toBe(true);
          if (["business_hours", "business_details"].includes(section.type) || (section.type === "contact_details" && section.variant !== "callout")) expect(section.props).toEqual({});
        }
      }
      // Which Services the site shows is the business's choice: a Template starts with none hidden and none ordered.
      expect(definition.settings.serviceDisplay).toEqual({ order: [], hidden: [] });
    });

    test(`${key}: no invented award, certification, rating, guarantee, financing offer, years in business or customer count`, () => {
      // The words a visitor reads: titles, names and every section's text (not the theme's colours, which contain "#1...").
      const json = JSON.stringify(byKey(key).definition.pages);
      expect(json).not.toMatch(/\baward|certified|certification|licensed|insured|bonded|guarantee|warranty|financing|\d+\+?\s*years|since \d{4}|five[- ]star|5[- ]star|rated|\bbest\b|#1|top[- ]rated|thousands|customers served|reviews?\b/i);
    });

    test(`${key}: nothing in the contact form's copy says a message is delivered or answered (there is no mail provider yet)`, () => {
      const forms = byKey(key).definition.pages.flatMap((page) => page.sections).filter((section) => section.type === "contact_form");
      for (const form of forms) expect(JSON.stringify(form.props)).not.toMatch(/will (reply|respond|get back|email|call)|emailed|delivered|we.?ll (reply|respond|get back)|within \d+|hours? to (reply|respond)|24 ?(hours|\/7)/i);
    });
  }
});

test.describe("the Templates are genuinely different, not four skins over one layout", () => {
  const defs = KEYS.map((key) => ({ key, definition: byKey(key).definition }));

  test("each pair opens its home page with different sections: at least four of the six positions differ and most variants are not shared", () => {
    for (const [a, b] of pairs(defs)) {
      const first = shape(a.definition, "home");
      const second = shape(b.definition, "home");
      const length = Math.max(first.length, second.length);
      let differing = 0;
      for (let index = 0; index < length; index += 1) if (first[index] !== second[index]) differing += 1;
      expect(differing, `${a.key} / ${b.key} home`).toBeGreaterThanOrEqual(4);
      // The hero, the Services and the closing call to action are each drawn a different way.
      expect(first[0], `${a.key} / ${b.key} opening`).not.toBe(second[0]);
      const serviceList = (list: string[]) => list.find((entry) => entry.startsWith("service_list:"));
      expect(serviceList(first), `${a.key} / ${b.key} services`).not.toBe(serviceList(second));
      const closing = (list: string[]) => list.at(-1);
      expect(closing(first), `${a.key} / ${b.key} closing`).not.toBe(closing(second));
    }
  });

  test("each pair presents the Services page differently, and at least four of the five pages are composed differently", () => {
    for (const [a, b] of pairs(defs)) {
      expect(shape(a.definition, "services"), `${a.key} / ${b.key} services page`).not.toEqual(shape(b.definition, "services"));
      const differentPages = PAGE_KEYS.filter((key) => JSON.stringify(shape(a.definition, key)) !== JSON.stringify(shape(b.definition, key)));
      expect(differentPages.length, `${a.key} / ${b.key} pages that differ: ${differentPages.join(", ")}`).toBeGreaterThanOrEqual(4);
    }
  });

  test("each pair shares less than half of the section variants it uses, so the difference is not a handful of colours on one layout", () => {
    for (const [a, b] of pairs(defs)) {
      const first = variantsUsed(a.definition);
      const second = variantsUsed(b.definition);
      const shared = [...first].filter((entry) => second.has(entry)).length;
      const union = new Set([...first, ...second]).size;
      expect(shared / union, `${a.key} / ${b.key} (${shared} of ${union} shared)`).toBeLessThan(0.5);
    }
  });

  test("each has its own design style and its own accent, and every Template but the starter names a style", () => {
    expect(new Set(defs.map(({ definition }) => lookOf(definition.theme))).size).toBe(4);
    expect(new Set(defs.map(({ definition }) => definition.theme.accent)).size).toBe(4);
    expect(lookOf(DEFAULT_TEMPLATE.theme)).toBe("standard");
    expect(DEFAULT_TEMPLATE.theme).not.toHaveProperty("look");
    for (const key of ["precision", "comfort", "airflow"]) expect(byKey(key).definition.theme.look).toBe(key);
    // A theme alone is not the difference (four themes on one layout would still fail the structure tests above), but it is deliberately chosen.
    expect(byKey("precision").definition.theme).toMatchObject({ radius: "small", density: "compact" });
    expect(byKey("comfort").definition.theme).toMatchObject({ radius: "large", headingFont: "serif" });
  });

  test("a Template could not pass these tests by changing only its theme: the same layout under another look is caught", () => {
    const disguised = clone(byKey("climvia-starter").definition);
    disguised.theme = { ...disguised.theme, accent: "#1E40AF", look: "precision" };
    expect(JSON.stringify(shape(disguised, "home"))).toBe(JSON.stringify(shape(byKey("climvia-starter").definition, "home")));
    // It is the same composition: every position equals the starter's, which the difference rule above requires to be at least four apart.
    const first = shape(disguised, "home");
    const second = shape(byKey("climvia-starter").definition, "home");
    expect(first.filter((entry, index) => entry !== second[index])).toHaveLength(0);
  });
});

test.describe("the registry additions", () => {
  test("there are still ten section types: the Templates are made of new variants, not new kinds of section", () => {
    expect(SECTION_TYPES).toHaveLength(10);
    expect(Object.keys(SECTION_REGISTRY)).toHaveLength(10);
  });

  test("the new variants exist, each in the group the Section library offers it under", () => {
    const wanted: [string, string][] = [
      ["hero", "split"], ["hero", "welcome"], ["hero", "editorial"],
      ["service_list", "grid"], ["service_list", "grid-catalog"], ["service_list", "friendly"], ["service_list", "friendly-catalog"], ["service_list", "rows"], ["service_list", "rows-catalog"],
      ["feature_list", "strip"], ["feature_list", "numbered"], ["feature_list", "reassure"],
      ["call_to_action", "band"], ["call_to_action", "panel"], ["call_to_action", "editorial"],
    ];
    for (const [type, variant] of wanted) expect(SECTION_LIBRARY.some((entry) => entry.type === type && entry.variant === variant), `${type}:${variant}`).toBe(true);
    expect(SECTION_LIBRARY).toHaveLength(31);
  });

  test("every entry of the library has a name and a description a person can read: no internal identifier, no duplicate name", () => {
    const labels = SECTION_LIBRARY.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const entry of SECTION_LIBRARY) {
      expect(entry.label, entry.variant).toMatch(/^[A-Z][A-Za-z ()]+$/);
      expect(variantLabel(entry.type, entry.variant)).toBe(entry.label);
      expect(variantDescription(entry.type, entry.variant).length, entry.label).toBeGreaterThan(20);
    }
  });

  test("a section added from the library starts with valid text, for every variant, new ones included", () => {
    for (const entry of SECTION_LIBRARY) {
      const result = validateProps(entry.type, entry.variant, defaultPropsFor(entry.type, entry.variant));
      expect(result.ok, `${entry.type}:${entry.variant}`).toBe(true);
    }
  });

  test("a variant that offers its own heading is paired with one that does not, so a full list sits under a page's one heading", () => {
    for (const presentation of ["grid", "friendly", "rows"]) {
      expect(fieldsOf("service_list", presentation).map((field) => field.key)).toEqual(["heading", "supportingText"]);
      expect(fieldsOf("service_list", `${presentation}-catalog`)).toHaveLength(0);
      expect(variantDef("service_list", presentation)?.connected).toBe("services");
      expect(variantDef("service_list", `${presentation}-catalog`)?.connected).toBe("services");
    }
  });
});

test.describe("the design style token", () => {
  test("it is optional and backward compatible: a theme without one is the standard style, byte for byte as it was stored", () => {
    const legacy = clone(DEFAULT_THEME);
    expect(legacy).not.toHaveProperty("look");
    const checked = validateTheme(legacy);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.theme).toEqual(legacy);
      expect(checked.theme).not.toHaveProperty("look");
      expect(JSON.stringify(checked.theme)).toBe(JSON.stringify(legacy));
    }
    expect(lookOf(readTheme(legacy))).toBe("standard");
    // The standing sites' themes were stored before the token existed and stay valid and unchanged.
    for (const content of [APEX_CONTENT, NORTHSTAR_CONTENT]) {
      const result = validateTheme(clone(content.theme));
      expect(result.ok).toBe(true);
      if (result.ok) expect(JSON.stringify(result.theme)).toBe(JSON.stringify(content.theme));
    }
  });

  test("it accepts each style the renderer knows and nothing else", () => {
    expect([...THEME_LOOKS]).toEqual(["standard", "precision", "comfort", "airflow"]);
    for (const look of THEME_LOOKS) {
      const result = validateTheme({ ...DEFAULT_THEME, look });
      expect(result.ok, look).toBe(true);
      if (result.ok) expect(result.theme.look).toBe(look);
    }
    for (const bad of ["neon", "", "Precision", "precision ", "../comfort", "<script>", 3, null, {}, []]) {
      expect(validateTheme({ ...DEFAULT_THEME, look: bad }).ok, JSON.stringify(bad)).toBe(false);
    }
    // A stored theme that holds something else is drawn with the default theme, never as written.
    expect(readTheme({ ...DEFAULT_THEME, look: "neon" })).toEqual(DEFAULT_THEME);
  });

  test("it is an identifier, not CSS: it adds an attribute naming the style and nothing a stylesheet could be made of", () => {
    expect(themeAttributes(DEFAULT_THEME)).toEqual({ "data-site-theme": "", "data-site-density": "comfortable" });
    expect(themeAttributes({ ...DEFAULT_THEME, look: "comfort" })).toEqual({ "data-site-theme": "", "data-site-density": "comfortable", "data-site-look": "comfort" });
    // Nothing else can ride along with it: a theme with any key the token model does not know is refused whole.
    expect(validateTheme({ ...DEFAULT_THEME, look: "airflow", style: "color:red" }).ok).toBe(false);
  });
});

/* ───────────────────────── what the database holds ───────────────────────── */

let admin: Pool;
test.describe("the rows the migration wrote", () => {
  test.beforeAll(() => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 3 });
  });
  test.afterAll(async () => {
    await admin.end();
  });

  test("the table holds exactly the four Templates, active, and each row is its definition, name, description and category word for word", async () => {
    const rows = (await admin.query<{ key: string; name: string; category: string; description: string; schema_version: number; definition: unknown; is_active: boolean }>(
      "select key, name, category, description, schema_version, definition, is_active from site_templates order by key",
    )).rows;
    expect(rows.map((row) => row.key)).toEqual([...KEYS].sort());
    for (const row of rows) {
      const record = byKey(row.key);
      expect(row.is_active, row.key).toBe(true);
      expect(row.schema_version, row.key).toBe(1);
      expect(row.name, row.key).toBe(record.name);
      expect(row.category, row.key).toBe(record.category);
      expect(row.description, row.key).toBe(record.description);
      expect(row.definition, row.key).toEqual(clone(record.definition));
      expect(validateTemplateDefinition(row.definition).ok, row.key).toBe(true);
    }
  });

  test("a Template belongs to no organization: the table has no organization column, and the starter's definition is the one it always was", async () => {
    const columns = (await admin.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'site_templates'")).rows.map((row) => row.column_name);
    expect(columns).not.toContain("organization_id");
    expect(columns.sort()).toEqual(["category", "created_at", "definition", "description", "id", "is_active", "key", "name", "schema_version", "updated_at"]);
    const starter = (await admin.query<{ definition: unknown }>("select definition from site_templates where key = 'climvia-starter'")).rows[0].definition;
    expect(starter).toEqual(clone(DEFAULT_TEMPLATE));
  });

  test("the migration is data only (no schema change) and running it again changes nothing", async () => {
    const sql = readFileSync(join(process.cwd(), "drizzle", "0016_site_template_catalog.sql"), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((statement) => statement.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    expect(statements.length).toBe(4);
    for (const statement of statements) expect(statement, statement.slice(0, 40)).toMatch(/^(INSERT INTO site_templates|UPDATE site_templates)/);
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DELETE)\b/i);

    const before = (await admin.query("select key, name, definition, updated_at from site_templates order by key")).rows;
    const client = await admin.connect();
    try {
      await client.query("begin");
      for (const statement of statements) await client.query(statement);
      const during = (await client.query("select key, name, definition, updated_at from site_templates order by key")).rows;
      expect(during.map((row) => row.key)).toEqual([...KEYS].sort());
      expect(during.map((row) => [row.key, row.name, row.definition])).toEqual(before.map((row) => [row.key, row.name, row.definition]));
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect((await admin.query("select count(*)::int as n from site_templates")).rows[0].n).toBe(4);
  });

  test("adding Templates did not touch any existing website: every Site still has the starter selected, and the standing Drafts are the content they were seeded with", async () => {
    const sites = (await admin.query<{ org: string; slug: string; key: string | null }>(
      `select o.slug as org, s.slug, t.key from sites s join organizations o on o.id = s.organization_id left join site_templates t on t.id = s.selected_template_id
        where o.slug in ('apex-climate-heating-air', 'northstar-heating-cooling') order by o.slug, s.slug`,
    )).rows;
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const site of sites) expect(site.key, `${site.org}/${site.slug}`).toBe("climvia-starter");
    const apex = (await admin.query<{ theme: unknown }>(
      `select v.theme from site_versions v join sites s on s.id = v.site_id join organizations o on o.id = s.organization_id
        where o.slug = 'apex-climate-heating-air' and s.slug = 'main' and v.status = 'draft'`,
    )).rows[0].theme;
    expect(apex).toEqual(clone(APEX_CONTENT.theme));
    expect(apex).not.toHaveProperty("look");
  });

  test("the runtime role can read every active Template and change none", async () => {
    const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      const rows = (await app.query<{ key: string }>("select key from site_templates where is_active order by key")).rows;
      expect(rows.map((row) => row.key)).toEqual([...KEYS].sort());
      for (const statement of ["update site_templates set name = 'x'", "delete from site_templates", "insert into site_templates (key, name, category, schema_version, definition) values ('mine', 'Mine', 'hvac', 1, '{\"schema\":1}')"]) {
        await expect(app.query(statement), statement).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await app.end();
    }
  });
});

test.describe("the documentation", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  test("§31 covers the Templates: ownership, the four definitions, the registry and theme additions, the Gallery, the replacement and its guarantees, and what is not built", () => {
    const docs = read("docs/saas-architecture.md");
    expect(docs).toContain("31. [Website Templates](#31-website-templates)");
    const section = docs.slice(docs.indexOf("## 31. Website Templates"));
    expect(section.length).toBeGreaterThan(8000);
    for (const heading of ["### What a Template is, and who owns it", "### The four Templates", "### The registry additions: variants, not new section types", "### The design style: one optional theme token", "### The Gallery and the preview", "### Choosing a Template", "### What this does not change, and what is not built", "### Proof"]) {
      expect(section, heading).toContain(heading);
    }
    for (const term of [
      "application-owned", "no organization column", "No schema changes", "0016", "ON CONFLICT", "climvia-starter", "precision", "comfort", "airflow",
      "ten", "fifteen variants", "`look`", "Design style", "optional and backward compatible", "never CSS",
      "demonstration business", "inert", "writes nothing", "applyTemplateAction", "replaceDraftWithTemplate", "expectedRevision", "FOR UPDATE", "one transaction",
      "published website is byte for byte", "survives", "settings.serviceDisplay", "Undo history starts empty", "website:manage", "forged", "`(signed-in)/(workspace)`",
      "Docker verification was required before AWS deployment", "logo", "custom domains", "contact-form",
    ]) {
      expect(section, term).toContain(term);
    }
    // The seam paragraph no longer says the gallery is not built, and nothing in the docs claims a deferred feature.
    expect(docs).not.toContain("**Not built here, by design:** a gallery");
    expect(docs).not.toMatch(/no multiple templates, template gallery or template choice/i);
  });

  test("the handoff, the screen map and the README describe the Templates and no longer list the gallery as a limit", () => {
    const handoff = read("docs/production-handoff.md");
    expect(handoff).toContain("**Phase 17 update.**");
    expect(handoff).toContain("`0016`");
    expect(handoff).not.toContain("no template gallery or choice of template (Phase 17)");
    const map = read("docs/stitch-screen-map.md");
    expect(map).toContain("**The Template Gallery**");
    expect(map).toContain("/website/templates");
    const readme = read("README.md");
    expect(readme).toContain("four of them, with a Gallery to preview and choose from");
    expect(readme).not.toContain("a template gallery (Phase 17)");
  });
});
