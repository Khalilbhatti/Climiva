"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  DEFAULT_THEME,
  THEME_DENSITIES,
  THEME_DENSITY_LABEL,
  THEME_FONTS,
  THEME_FONT_LABEL,
  THEME_LOOKS,
  THEME_LOOK_HINT,
  THEME_LOOK_LABEL,
  THEME_RADII,
  THEME_RADIUS_LABEL,
  lookOf,
  type ThemeLook,
} from "@/lib/site-theme";
import { useBuilder } from "./BuilderProvider";
import { Segmented } from "./FieldControl";

/** The accent colour that fills the picker when the theme has none: the Climvia teal the website uses by default. */
const DEFAULT_ACCENT = "#0D5C63";
const HEX = /^#[0-9A-F]{6}$/;

const RADIUS_OPTIONS = THEME_RADII.map((value) => ({ value, label: THEME_RADIUS_LABEL[value] }));
const DENSITY_OPTIONS = THEME_DENSITIES.map((value) => ({ value, label: THEME_DENSITY_LABEL[value] }));

/**
 * The site theme: the few design choices every page shares. Each is a named token the website's renderer understands (a colour, a corner
 * style, a spacing, two fonts from a fixed list, a design style), so nothing typed here can become CSS. Changes show in the canvas at once and are stored on Save.
 */
export function ThemeInspector() {
  const b = useBuilder();
  const theme = b.content.theme;
  const accent = theme.accent ?? DEFAULT_ACCENT;
  // The text a person is typing for the accent. It is only applied once it is a whole colour, so half a colour never reaches the site.
  const [typed, setTyped] = useState<{ for: string | null; text: string } | null>(null);
  const text = typed && typed.for === theme.accent ? typed.text : (theme.accent ?? "");
  const invalid = text !== "" && !HEX.test(text.toUpperCase());
  const themeError = b.serverFields.theme;

  function typeAccent(value: string) {
    const upper = value.toUpperCase().slice(0, 7);
    setTyped({ for: theme.accent, text: upper });
    if (upper === "") b.setTheme({ accent: null }, "theme:accent");
    else if (HEX.test(upper)) {
      setTyped({ for: upper, text: upper });
      b.setTheme({ accent: upper }, "theme:accent");
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-ink-muted">These choices apply to every page of the website. Your business name, hours and Services are managed in Settings and Services.</p>

      <div className="space-y-2">
        {/* "Standard" is the absence of the key, so a site that goes back to it is exactly what it was before it chose a style. */}
        <Select label="Design style" value={lookOf(theme)} disabled={b.readOnly} onChange={(event) => b.setTheme({ look: event.target.value === "standard" ? undefined : (event.target.value as ThemeLook) })}>
          {THEME_LOOKS.map((look) => (
            <option key={look} value={look}>
              {THEME_LOOK_LABEL[look]}
            </option>
          ))}
        </Select>
        <p className="text-xs text-ink-muted">{THEME_LOOK_HINT[lookOf(theme)]} It sets how wide the pages are, how roomy, and how headings, cards, the header and the footer look.</p>
      </div>

      <fieldset disabled={b.readOnly} className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-ink">Accent colour</legend>
        <div className="flex items-end gap-2">
          <input
            type="color"
            aria-label="Pick the accent colour"
            value={accent.toLowerCase()}
            onChange={(event) => typeAccent(event.target.value)}
            onBlur={b.endEdit}
            className="h-10 w-12 shrink-0 cursor-pointer rounded-btn border border-line bg-canvas p-1 disabled:cursor-default disabled:opacity-60"
          />
          <div className="min-w-0 flex-1">
            <Input
              label="Accent colour code"
              value={text}
              placeholder={DEFAULT_ACCENT}
              maxLength={7}
              spellCheck={false}
              autoCapitalize="characters"
              error={invalid ? "Use a colour like #0D5C63." : themeError}
              onChange={(event) => typeAccent(event.target.value)}
              onBlur={b.endEdit}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-muted">{theme.accent ? "Buttons, links and highlights use this colour." : "Using the Climvia teal."}</p>
          {theme.accent && (
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => {
                setTyped(null);
                b.setTheme({ accent: DEFAULT_THEME.accent });
              }}
            >
              Use the default
            </Button>
          )}
        </div>
      </fieldset>

      <Segmented legend="Corners" name="theme-radius" value={theme.radius} options={RADIUS_OPTIONS} disabled={b.readOnly} onChange={(radius) => b.setTheme({ radius })} />
      <Segmented legend="Spacing" name="theme-density" value={theme.density} options={DENSITY_OPTIONS} disabled={b.readOnly} onChange={(density) => b.setTheme({ density })} />

      <div className="space-y-4">
        <Select label="Heading font" value={theme.headingFont} disabled={b.readOnly} onChange={(event) => b.setTheme({ headingFont: event.target.value as (typeof THEME_FONTS)[number] })}>
          {THEME_FONTS.map((font) => (
            <option key={font} value={font}>
              {THEME_FONT_LABEL[font]}
            </option>
          ))}
        </Select>
        <Select label="Body font" value={theme.bodyFont} disabled={b.readOnly} onChange={(event) => b.setTheme({ bodyFont: event.target.value as (typeof THEME_FONTS)[number] })}>
          {THEME_FONTS.map((font) => (
            <option key={font} value={font}>
              {THEME_FONT_LABEL[font]}
            </option>
          ))}
        </Select>
        <p className="text-xs text-ink-muted">Fonts come from a fixed list the website already has. Nothing is downloaded for a visitor.</p>
      </div>

      {b.readOnly && <p className="text-xs text-ink-muted">You can look at the theme. Only an owner or admin can change it.</p>}
    </div>
  );
}
