/**
 * Prints the SQL that writes the application's default site template (src/db/default-template.ts) into site_templates.
 *
 * Migration 0013 contains this statement; run this when the default template changes and put the output in a NEW migration (a
 * template row is changed by a migration, never edited in place by a tenant). e2e/website-database.spec.ts fails if the migrated row and
 * the constant differ.
 *
 *     npx tsx scripts/db/template-sql.ts
 */
import {
  DEFAULT_TEMPLATE,
  DEFAULT_TEMPLATE_CATEGORY,
  DEFAULT_TEMPLATE_DESCRIPTION,
  DEFAULT_TEMPLATE_KEY,
  DEFAULT_TEMPLATE_NAME,
} from "../../src/db/default-template";
import { validateTemplateDefinition } from "../../src/lib/site-template";

const checked = validateTemplateDefinition(DEFAULT_TEMPLATE);
if (!checked.ok) throw new Error(`The default template is not valid: ${JSON.stringify(checked.problems)}`);

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = JSON.stringify(DEFAULT_TEMPLATE, null, 2);
if (json.includes("$template$")) throw new Error("The template contains the SQL quoting tag.");

console.log(`INSERT INTO site_templates (key, name, category, description, schema_version, definition, is_active)
VALUES (${quote(DEFAULT_TEMPLATE_KEY)}, ${quote(DEFAULT_TEMPLATE_NAME)}, ${quote(DEFAULT_TEMPLATE_CATEGORY)}, ${quote(DEFAULT_TEMPLATE_DESCRIPTION)}, ${DEFAULT_TEMPLATE.schema}, $template$${json}$template$::jsonb, true);`);
