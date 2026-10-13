/**
 * A Site Version's theme: a small set of named design TOKENS, never CSS.
 *
 * The theme belongs to the version (a published version keeps the look it was published with). It is validated structured JSON with
 * a fixed set of keys and, for each, a fixed set of allowed values. There is no free-form style, class name, stylesheet or font file in
 * it, so nothing a customer types can become CSS. The Website Builder's Theme editor changes these tokens; it does not widen what a theme can hold.
 *
 *   accent       null (the Climvia teal) or "#RRGGBB"   -> the site's primary colour
 *   radius       small | medium | large                  -> how rounded buttons, cards and inputs are
 *   density      compact | comfortable                   -> how much space sections have
 *   headingFont  an identifier from THEME_FONTS          -> the family headings use
 *   bodyFont     an identifier from THEME_FONTS          -> the family everything else uses
 *   look         an identifier from THEME_LOOKS (optional) -> the design style the whole site is drawn in (see below)
 *
 * A font is an IDENTIFIER the application maps to a font stack it already has (the self-hosted Inter, or the visitor's own system fonts):
 * a theme cannot name a font file or a web address, and nothing is downloaded for it.
 *
 * `look` is the one token the Template system added. It names a design STYLE the renderer knows (lib/site-look draws it: how wide the
 * content is, how roomy the sections, how the headings, cards, header and footer are drawn). It is an identifier, not CSS, and it is
 * OPTIONAL: a theme without it is the "standard" look, so every theme stored before it existed is still valid and unchanged, and the schema
 * number stays 1. A look decides the chrome of every section, including ones added later, which is why a Template can be more than a
 * different set of colours: its sections are chosen by the Template, its style by this token.
 *
 * `schema` is the version of this shape, so a later phase can migrate stored themes instead of guessing. Adding an allowed value to a list
 * above (a new font) or an optional key with a default (look) is backward compatible and keeps the schema number; changing a key's meaning
 * or adding a required key is not.
 */
export const THEME_SCHEMA = 1;

export const THEME_RADII = ["small", "medium", "large"] as const;
export const THEME_DENSITIES = ["compact", "comfortable"] as const;
export const THEME_FONTS = ["inter", "system-sans", "serif"] as const;
export const THEME_LOOKS = ["standard", "precision", "comfort", "airflow"] as const;
export type ThemeLook = (typeof THEME_LOOKS)[number];

export const THEME_RADIUS_LABEL: Record<(typeof THEME_RADII)[number], string> = { small: "Sharp", medium: "Soft", large: "Round" };
export const THEME_DENSITY_LABEL: Record<(typeof THEME_DENSITIES)[number], string> = { compact: "Compact", comfortable: "Comfortable" };
export const THEME_FONT_LABEL: Record<(typeof THEME_FONTS)[number], string> = { inter: "Inter", "system-sans": "System sans-serif", serif: "Classic serif" };
export const THEME_LOOK_LABEL: Record<ThemeLook, string> = { standard: "Standard", precision: "Precision", comfort: "Comfort", airflow: "Airflow" };
export const THEME_LOOK_HINT: Record<ThemeLook, string> = {
  standard: "Balanced and neutral: the Climvia starter style.",
  precision: "Structured and crisp: a bounded layout, sharp detail and a contact strip.",
  comfort: "Warm and approachable: soft spacing, friendly type and rounded panels.",
  airflow: "Editorial and spacious: large type, plenty of white space and little chrome.",
};

/** The font stack an identifier stands for. Only stacks the application already has: nothing is fetched from anywhere. */
const FONT_STACK: Record<(typeof THEME_FONTS)[number], string> = {
  inter: 'var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  "system-sans": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
};

const RADIUS_VARS: Record<(typeof THEME_RADII)[number], { btn: string; card: string }> = {
  small: { btn: "0.25rem", card: "0.375rem" },
  medium: { btn: "0.5rem", card: "0.75rem" },
  large: { btn: "0.875rem", card: "1.25rem" },
};

export type SiteTheme = {
  schema: typeof THEME_SCHEMA;
  accent: string | null;
  radius: (typeof THEME_RADII)[number];
  density: (typeof THEME_DENSITIES)[number];
  headingFont: (typeof THEME_FONTS)[number];
  bodyFont: (typeof THEME_FONTS)[number];
  /** The design style; absent means "standard". Stored only when a theme chose one, so older themes are unchanged. */
  look?: ThemeLook;
};

export const DEFAULT_THEME: SiteTheme = { schema: THEME_SCHEMA, accent: null, radius: "medium", density: "comfortable", headingFont: "inter", bodyFont: "inter" };

const KEYS = ["schema", "accent", "radius", "density", "headingFont", "bodyFont", "look"] as const;
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
  if (raw.look !== undefined && !oneOf(THEME_LOOKS, raw.look)) return { ok: false, error: "The design style is not one of the available styles." };
  const theme: SiteTheme = { schema: THEME_SCHEMA, accent: raw.accent, radius: raw.radius, density: raw.density, headingFont: raw.headingFont, bodyFont: raw.bodyFont };
  // Carried only when the theme has one: a theme without a look stays byte-for-byte what it was.
  if (raw.look !== undefined) theme.look = raw.look;
  return { ok: true, theme };
}

/** The design style a theme draws in: "standard" when it names none. */
export const lookOf = (theme: Pick<SiteTheme, "look">): ThemeLook => theme.look ?? "standard";

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

/**
 * Everything a theme sets on the element that wraps a drawn site, as CSS custom properties built here from validated tokens: the accent
 * (when there is one), the corner radius of buttons and cards, and the heading and body families. Nothing else writes these.
 */
export function themeStyle(theme: SiteTheme): Record<string, string> {
  return {
    ...accentStyle(theme),
    "--radius-btn": RADIUS_VARS[theme.radius].btn,
    "--radius-card": RADIUS_VARS[theme.radius].card,
    "--site-font-heading": FONT_STACK[theme.headingFont],
    "--site-font-body": FONT_STACK[theme.bodyFont],
  };
}

/**
 * The attributes that go with `themeStyle` on the wrapper: the stylesheet keys the fonts off one, and sections read the density. A
 * non-standard design style is named too (`data-site-look`), so a test or a stylesheet can tell which style a drawn site is in.
 */
export const themeAttributes = (theme: SiteTheme): { "data-site-theme": string; "data-site-density": string; "data-site-look"?: string } => ({
  "data-site-theme": "",
  "data-site-density": theme.density,
  ...(lookOf(theme) === "standard" ? {} : { "data-site-look": lookOf(theme) }),
});
