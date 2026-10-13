import { lookOf, type SiteTheme, type ThemeLook } from "@/lib/site-theme";

/**
 * How a DESIGN STYLE draws the parts every section is made of: how wide its content runs, how roomy it is, how its headings, cards and
 * buttons look. A site's theme names one style (`theme.look`, see lib/site-theme); the renderer reads these tokens, so the same section
 * (a contact card, a heading, a form) is drawn in the style of the site it sits on, including a section added after the Template was chosen.
 *
 * These are fixed Tailwind class strings written here, in application code, and picked by an identifier: nothing a customer types ever
 * becomes a class. The "standard" style is exactly what the renderer drew before styles existed, so a site that names none is unchanged.
 *
 * What a style does NOT decide is a section's STRUCTURE (a split opening, a ruled grid of Services, numbered steps): that is the
 * section's variant, chosen by the Template. A Template is its variants plus its style plus its theme tokens.
 */
export type LookTokens = {
  id: ThemeLook;
  /** Bounds the width of a section's content and centres it. Empty: the content runs the full width of the frame. */
  inner: string;
  /** A section's gutters and vertical rhythm (compact spacing in the theme tightens the vertical part). */
  pad: string;
  /** The extra vertical room a banner opening has. */
  heroPad: string;
  tone: { plain: string; tinted: string; brand: string };
  /** A section heading block: its width, the heading, and the line under it (colour is added by the caller). */
  head: { wrap: string; title: string; lead: string };
  /** A page introduction's heading and line. */
  intro: { wrap: string; title: string; lead: string };
  /** A card or panel: its surface without padding, the same raised, and the padding of a card and of a form. */
  surface: string;
  raised: string;
  cardPad: string;
  formPad: string;
  /** The small title over a block of information (contact details, business hours). */
  infoTitle: string;
  /**
   * Extra classes for the buttons a style draws (shape and weight). They carry the important modifier because they override the base
   * button's own classes and class names are only joined, never merged: which one wins must not depend on the order of the stylesheet.
   */
  button: string;
};

export const LOOKS: Readonly<Record<ThemeLook, LookTokens>> = {
  standard: {
    id: "standard",
    inner: "",
    pad: "px-5 py-8 @xl:px-8 @xl:py-10",
    heroPad: "@xl:py-14",
    tone: { plain: "bg-surface", tinted: "bg-surface-low", brand: "bg-primary text-white" },
    head: { wrap: "max-w-2xl", title: "text-xl font-bold tracking-tight @xl:text-2xl", lead: "mt-2 text-sm @xl:text-base" },
    intro: { wrap: "max-w-2xl", title: "text-2xl font-bold tracking-tight @xl:text-3xl", lead: "mt-2 text-sm @xl:text-base" },
    surface: "rounded-card border border-line bg-surface",
    raised: "rounded-card border border-line bg-surface shadow-card",
    cardPad: "p-4",
    formPad: "p-5",
    infoTitle: "mb-3 text-xs font-bold tracking-wider text-ink-muted uppercase",
    button: "",
  },
  precision: {
    id: "precision",
    inner: "mx-auto max-w-6xl",
    pad: "px-5 py-7 @xl:px-8 @xl:py-9",
    heroPad: "@xl:py-12",
    tone: { plain: "bg-surface", tinted: "border-y border-line bg-surface-low", brand: "bg-primary text-white" },
    head: { wrap: "max-w-3xl", title: "border-l-4 border-primary pl-3 text-xl font-extrabold tracking-tight @xl:text-2xl", lead: "mt-2 pl-4 text-sm @xl:text-base" },
    intro: { wrap: "max-w-3xl", title: "border-l-4 border-primary pl-4 text-3xl font-extrabold tracking-tight @xl:text-4xl", lead: "mt-3 pl-5 text-sm @xl:text-base" },
    surface: "rounded-card border border-line-strong bg-surface",
    raised: "rounded-card border border-line-strong bg-surface",
    cardPad: "p-4",
    formPad: "p-5",
    infoTitle: "mb-3 border-b border-line pb-2 text-xs font-bold tracking-widest text-primary uppercase",
    button: "font-semibold!",
  },
  comfort: {
    id: "comfort",
    inner: "mx-auto max-w-5xl",
    pad: "px-5 py-10 @xl:px-8 @xl:py-14",
    heroPad: "@xl:py-16",
    tone: { plain: "bg-surface", tinted: "bg-primary-subtle/50", brand: "bg-primary text-white" },
    head: { wrap: "max-w-2xl", title: "text-2xl font-semibold tracking-tight @xl:text-3xl", lead: "mt-3 text-base @xl:text-lg" },
    intro: { wrap: "max-w-2xl", title: "text-3xl font-semibold tracking-tight @xl:text-5xl", lead: "mt-4 text-base @xl:text-lg" },
    surface: "rounded-card bg-surface ring-1 ring-line",
    raised: "rounded-card bg-surface shadow-overlay ring-1 ring-line",
    cardPad: "p-5",
    formPad: "p-6",
    infoTitle: "mb-3 text-sm font-semibold text-primary",
    button: "rounded-full! px-6! font-semibold!",
  },
  airflow: {
    id: "airflow",
    inner: "mx-auto max-w-6xl",
    pad: "px-5 py-12 @xl:px-10 @xl:py-20",
    heroPad: "@xl:py-24",
    tone: { plain: "bg-surface", tinted: "border-t border-line bg-surface", brand: "bg-primary text-white" },
    head: { wrap: "max-w-3xl", title: "text-3xl font-light tracking-tight @xl:text-5xl", lead: "mt-4 text-base font-light @xl:text-lg" },
    intro: { wrap: "max-w-4xl", title: "text-4xl font-light tracking-tight @xl:text-6xl", lead: "mt-5 text-base font-light @xl:text-xl" },
    surface: "border-t border-line-strong",
    raised: "border-t border-line-strong",
    cardPad: "pt-4",
    formPad: "pt-5",
    infoTitle: "mb-3 text-xs font-medium tracking-[0.2em] text-ink-muted uppercase",
    button: "rounded-full! px-7! font-medium!",
  },
};

/** The tokens of the design style a theme names ("standard" when it names none). */
export const looksOf = (theme: Pick<SiteTheme, "look">): LookTokens => LOOKS[lookOf(theme)];
