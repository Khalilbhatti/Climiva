/**
 * Prints the SQL that writes the application's website Templates (src/db/site-templates.ts) into site_templates.
 *
 * A template row is changed by a MIGRATION, never edited in place by a tenant (the runtime role can only read it). Migration 0013 holds the
 * statement for the starter template; migration 0016 holds the statements for the three Templates Phase 17 added. When a Template changes,
 * run this and put the output in a NEW migration. e2e/website-templates.spec.ts fails if a migrated row and its definition differ.
 *
 *     npx tsx scripts/db/template-sql.ts                         every Template
 *     npx tsx scripts/db/template-sql.ts precision comfort       only those
 */
import { TEMPLATE_CATALOG } from "../../src/db/site-templates";
import { validateTemplateDefinition } from "../../src/lib/site-template";

const wanted = process.argv.slice(2);
const records = wanted.length === 0 ? TEMPLATE_CATALOG : TEMPLATE_CATALOG.filter((template) => wanted.includes(template.key));
if (records.length !== (wanted.length === 0 ? TEMPLATE_CATALOG.length : wanted.length)) throw new Error(`Unknown template in: ${wanted.join(", ")}`);

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

for (const template of records) {
  const checked = validateTemplateDefinition(template.definition);
  if (!checked.ok) throw new Error(`The ${template.key} template is not valid: ${JSON.stringify(checked.problems)}`);
  const json = JSON.stringify(template.definition, null, 2);
  if (json.includes("$template$")) throw new Error(`The ${template.key} template contains the SQL quoting tag.`);
  console.log(`INSERT INTO site_templates (key, name, category, description, schema_version, definition, is_active)
VALUES (${quote(template.key)}, ${quote(template.name)}, ${quote(template.category)}, ${quote(template.description)}, ${template.definition.schema}, $template$${json}$template$::jsonb, true)
ON CONFLICT (key) DO NOTHING;
`);
}
