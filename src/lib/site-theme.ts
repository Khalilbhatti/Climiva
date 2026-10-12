/**
 * A Site Version's theme: a small set of named design TOKENS, never CSS.
 *
 * The theme belongs to the version (a published version keeps the look it was published with). It is validated structured JSON with
 * a fixed set of keys and, for each, a fixed set of allowed values. There is no free-form style, class name, stylesheet or font file in
 * it, so nothing a customer types can become CSS. A future Theme editor changes these tokens; it does not widen what a theme can hold.
 *
 *   accent       null (the Climvia teal) or "#RRGGBB"   -> applied today as the site's primary colour
 *   radius       small | medium | large                  -> reserved for the Theme editor (the site uses `medium`)
 *   density      compact | comfortable                   -> reserved for the Theme editor (the site uses `comfortable`)
 *   headingFont  an identifier from FONTS                -> reserved (only the self-hosted Inter exists)
 *   bodyFont     an identifier from FONTS                -> reserved
 *
 * `schema` is the version of this shape, so a later phase can migrate stored themes instead of guessing.
 */
export const THEME_SCHEMA = 1;

export const THEME_RADII = ["small", "medium", "large"] as const;
export const THEME_DENSITIES = ["compact", "comfortable"] as const;
export const THEME_FONTS = ["inter"] as const;

export type SiteTheme = {
  schema: typeof THEME_SCHEMA;
  accent: string | null;
  radius: (typeof THEME_RADII)[number];
  density: (typeof THEME_DENSITIES)[number];
  headingFont: (typeof THEME_FONTS)[number];
  bodyFont: (typeof THEME_FONTS)[number];
};

export const DEFAULT_THEME: SiteTheme = { schema: THEME_SCHEMA, accent: null, radius: "medium", density: "comfortable", headingFont: "inter", bodyFont: "inter" };

const KEYS = ["schema", "accent", "radius", "density", "headingFont", "bodyFont"] as const;
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

export type ThemeResult = { ok: true; theme: SiteTheme } | { ok: false; error: string };

export function validateTheme(input: unknown): ThemeResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "The theme was not understood." };
  const raw = input as Record<string, unknown>;
  const extra = Object.keys(raw).filter((key) => !(KEYS as readonly string[]).includes(key));
  if (extra.length > 0) return { ok: false, error: `The theme has settings it cannot hold: ${extra.join(", ")}.` };
  if (raw.schema !== THEME_SCHEMA) return { ok: false, error: "The theme is not a version this application understands." };
  if (!(raw.accent === null || (typeof raw.accent === "string" && /^#[0-9A-F]{6}$/.test(raw.accent)))) return { ok: false, error: "The accent must be a colour like #0D5C63, or none." };
  if (!oneOf(THEME_RADII, raw.radius)) return { ok: false, error: "The corner style is not one of the available styles." };
  if (!oneOf(THEME_DENSITIES, raw.density)) return { ok: false, error: "The spacing is not one of the available styles." };
  if (!oneOf(THEME_FONTS, raw.headingFont) || !oneOf(THEME_FONTS, raw.bodyFont)) return { ok: false, error: "The font is not one of the available fonts." };
  return { ok: true, theme: { schema: THEME_SCHEMA, accent: raw.accent, radius: raw.radius, density: raw.density, headingFont: raw.headingFont, bodyFont: raw.bodyFont } };
}

/** A stored theme for drawing: a stored value that does not validate is replaced by the default, never drawn. */
export function readTheme(input: unknown): SiteTheme {
  const result = validateTheme(input);
  return result.ok ? result.theme : DEFAULT_THEME;
}

/** The CSS custom properties that apply a theme's accent. A theme is the only source of these; nothing else writes them. */
export function accentStyle(theme: SiteTheme): Record<string, string> | undefined {
  if (!theme.accent) return undefined;
  return {
    "--color-primary": theme.accent,
    "--color-primary-hover": `color-mix(in srgb, ${theme.accent} 80%, black)`,
    "--color-primary-subtle": `color-mix(in srgb, ${theme.accent} 10%, white)`,
  };
}
