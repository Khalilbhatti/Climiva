/**
 * The application's website Templates: the four starting compositions a business can choose from.
 *
 * Templates are APPLICATION-OWNED product content, never tenant data. Each is a validated definition (lib/site-template) written into
 * `site_templates` by a MIGRATION; the runtime role can read an active row and nothing more, and a row carries no organization. This file
 * is the one list of them: the order they are shown in (never the database's insertion order), each one's display metadata and its
 * definition. A test keeps every definition here identical to its migrated row, so there is one Template and not two.
 *
 *   climvia-starter   balanced and neutral: the baseline every new business starts from
 *   precision         structured and confident: a split opening, a ruled service grid, a trust strip
 *   comfort           warm and approachable: a welcoming opening, friendly cards, a reassurance panel
 *   airflow           editorial and spacious: a very large headline, index-style rows, numbered steps
 *
 * Server and tooling code only (the Site queries, the Template Gallery's route, the migration generator, the tests). A Client Component
 * never imports it: the Gallery's browser code is handed the Templates as props, so the definitions reach a browser as data the Gallery
 * draws, never as a constant in the JavaScript.
 */
import type { TemplateDefinition } from "@/lib/site-template";
import { DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_CATEGORY, DEFAULT_TEMPLATE_DESCRIPTION, DEFAULT_TEMPLATE_KEY, DEFAULT_TEMPLATE_NAME } from "./default-template";
import { AIRFLOW_TEMPLATE, AIRFLOW_TEMPLATE_DESCRIPTION, AIRFLOW_TEMPLATE_KEY, AIRFLOW_TEMPLATE_NAME } from "./templates/airflow";
import { COMFORT_TEMPLATE, COMFORT_TEMPLATE_DESCRIPTION, COMFORT_TEMPLATE_KEY, COMFORT_TEMPLATE_NAME } from "./templates/comfort";
import { PRECISION_TEMPLATE, PRECISION_TEMPLATE_DESCRIPTION, PRECISION_TEMPLATE_KEY, PRECISION_TEMPLATE_NAME } from "./templates/precision";

export type TemplateRecord = {
  /** The stable identity of the Template (`site_templates.key`). */
  key: string;
  name: string;
  /** What kind of business it is for (`site_templates.category`). */
  category: string;
  description: string;
  /** A short label for its style, and at most two tags: shown on the Gallery's card. Display only. */
  style: string;
  tags: readonly string[];
  definition: TemplateDefinition;
};

/** The Templates in the order the Gallery shows them. */
export const TEMPLATE_CATALOG: readonly TemplateRecord[] = [
  {
    key: DEFAULT_TEMPLATE_KEY,
    name: DEFAULT_TEMPLATE_NAME,
    category: DEFAULT_TEMPLATE_CATEGORY,
    description: DEFAULT_TEMPLATE_DESCRIPTION,
    style: "Balanced",
    tags: ["Neutral", "General purpose"],
    definition: DEFAULT_TEMPLATE,
  },
  {
    key: PRECISION_TEMPLATE_KEY,
    name: PRECISION_TEMPLATE_NAME,
    category: DEFAULT_TEMPLATE_CATEGORY,
    description: PRECISION_TEMPLATE_DESCRIPTION,
    style: "Structured",
    tags: ["Modern", "Compact"],
    definition: PRECISION_TEMPLATE,
  },
  {
    key: COMFORT_TEMPLATE_KEY,
    name: COMFORT_TEMPLATE_NAME,
    category: DEFAULT_TEMPLATE_CATEGORY,
    description: COMFORT_TEMPLATE_DESCRIPTION,
    style: "Residential",
    tags: ["Warm", "Friendly"],
    definition: COMFORT_TEMPLATE,
  },
  {
    key: AIRFLOW_TEMPLATE_KEY,
    name: AIRFLOW_TEMPLATE_NAME,
    category: DEFAULT_TEMPLATE_CATEGORY,
    description: AIRFLOW_TEMPLATE_DESCRIPTION,
    style: "Editorial",
    tags: ["Minimal", "Spacious"],
    definition: AIRFLOW_TEMPLATE,
  },
];

export const TEMPLATE_KEYS: readonly string[] = TEMPLATE_CATALOG.map((template) => template.key);

export const findTemplateRecord = (key: string): TemplateRecord | undefined => TEMPLATE_CATALOG.find((template) => template.key === key);
