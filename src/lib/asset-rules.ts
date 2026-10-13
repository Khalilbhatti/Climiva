/**
 * The rules about Assets that a browser and the server share: what a logo upload may be, what the person is told when it is not, and the
 * one place an Asset's public address is built.
 *
 * Pure, with no Node and no secrets, so a Client Component may import it (the Branding form checks a file before sending it; the server
 * checks again and is the authority). Nothing about where the bytes are kept is here: that is src/storage, which no browser reaches.
 */

/** The largest upload accepted. The body is limited to this (plus the form's own framing) before it is read. */
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
/** The types accepted, by what the FILE is, not by what it is called or what the browser says it is. SVG is deliberately absent. */
export const LOGO_ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_ACCEPT_ATTRIBUTE = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
/** The longest side an upload may have. A header claiming more is refused without decoding it. */
export const LOGO_MAX_SIDE = 4096;
/** No decoder is asked for more pixels than this (a 4096 × 4096 image), whatever the header says. */
export const LOGO_MAX_PIXELS = LOGO_MAX_SIDE * LOGO_MAX_SIDE;
/** The stored logo is scaled to fit this square (never enlarged), so a very large upload costs one small file. */
export const LOGO_STORED_SIDE = 1024;

/** The ways an upload can be refused, each with the words the person sees. None names a bucket, a key or a path. */
export const UPLOAD_FAILURES = {
  unsupported: "Choose a PNG, JPG or WebP image.",
  tooLarge: "That image is too large. Use a file up to 5 MB, no larger than 4096 × 4096 pixels.",
  invalid: "That file could not be read as an image. Choose a different one.",
  failed: "The logo could not be uploaded. Try again.",
} as const;
export type UploadFailure = keyof typeof UPLOAD_FAILURES;

/** The first thing a browser can check without reading the file: its declared type and size. The server decides on the content. */
export function checkLogoFile(file: { type: string; size: number }): UploadFailure | null {
  if (!(LOGO_ACCEPTED_TYPES as readonly string[]).includes(file.type)) return "unsupported";
  if (file.size > LOGO_MAX_BYTES) return "tooLarge";
  return null;
}

/** An Asset's address on this site. Built here and nowhere else; it carries the Asset's id and no storage detail. */
export const assetUrl = (assetId: string): string => `/assets/${assetId}`;

/** A file name made safe to store and show: no path, no control characters, no markup brackets, and a sensible length. Never used as a key. */
export function cleanFilename(name: string | undefined | null): string | null {
  if (!name) return null;
  // Control characters (line breaks and the like) are taken out by what they are, not by a pattern that has to spell them.
  const printable = Array.from(name.split(/[\\/]/).pop()!).filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);
  const base = printable.join("").replace(/[<>"`|?*:]/g, "").replace(/\s+/g, " ").trim();
  if (base === "" || base === "." || base === "..") return null;
  return base.length > 120 ? `${base.slice(0, 117)}...` : base;
}
