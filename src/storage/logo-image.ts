/**
 * Turning an upload into the logo that is stored.
 *
 * Nothing a browser says about a file is believed: not its name, not its Content-Type. The BYTES decide.
 *
 *   1. Size: more than LOGO_MAX_BYTES is refused before anything reads it.
 *   2. Signature: the file must start as a PNG, a JPEG or a WebP. SVG, HTML, XML, GIF, PDF and everything else (renamed or not) stop here
 *      and are never handed to an image library. SVG is refused on purpose: it is a document that can carry script, and sanitizing it is a
 *      separate problem this phase does not take on.
 *   3. Dimensions: read from the header, without decoding. A side over LOGO_MAX_SIDE, or more than LOGO_MAX_PIXELS in all, is refused, so a
 *      tiny file that claims to be enormous never gets a pixel buffer.
 *   4. Decode: strictly (a warning is a failure, so a truncated or damaged file is refused, not half-shown), with the decoder itself capped at
 *      LOGO_MAX_PIXELS as well.
 *   5. Re-encode: oriented upright, scaled down to fit LOGO_STORED_SIDE (never enlarged), and written as WebP, lossless for a PNG source (a logo
 *      is flat art with transparency) and high quality for a photograph. Writing the picture out again as a new file drops every piece of metadata (location, camera, comments)
 *      and anything that was not pixels, so what is stored is only the picture.
 *
 * The result carries the SHA-256 of the stored bytes. Only the sample seed, which renders its own SVG crest to a PNG first, ever sees an SVG.
 *
 * No `server-only` import on purpose (the seed and the tests use it); it is native code and no Client Component may import it.
 */
import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { LOGO_MAX_BYTES, LOGO_MAX_PIXELS, LOGO_MAX_SIDE, LOGO_STORED_SIDE, type UploadFailure } from "@/lib/asset-rules";

/** An upload that is refused, with the category the person is told. */
export class LogoRejected extends Error {
  constructor(readonly reason: UploadFailure) {
    super(`logo rejected: ${reason}`);
    this.name = "LogoRejected";
  }
}

export type NormalizedLogo = {
  bytes: Buffer;
  mediaType: "image/webp";
  width: number;
  height: number;
  /** SHA-256 of `bytes`, lower-case hex. */
  checksum: string;
  /** What the upload was, from its bytes. */
  sourceType: "png" | "jpeg" | "webp";
};

/** What the BYTES are, from their signature alone; null for anything else. */
export function sniffImageType(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  const at = (index: number) => bytes[index];
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((value, index) => at(index) === value)) return "png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  // WebP is a RIFF container: "RIFF", a 4-byte length, then "WEBP".
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "webp";
  return null;
}

export async function normalizeLogo(input: Uint8Array): Promise<NormalizedLogo> {
  if (input.byteLength === 0) throw new LogoRejected("invalid");
  if (input.byteLength > LOGO_MAX_BYTES) throw new LogoRejected("tooLarge");
  const sourceType = sniffImageType(input);
  if (!sourceType) throw new LogoRejected("unsupported");

  // The header only: no pixels are allocated to learn the dimensions.
  let header: Metadata;
  try {
    header = await sharp(input, { limitInputPixels: false }).metadata();
  } catch {
    throw new LogoRejected("invalid");
  }
  const { width, height } = header;
  if (!width || !height || header.format !== sourceType) throw new LogoRejected("invalid");
  if (width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE || width * height > LOGO_MAX_PIXELS) throw new LogoRejected("tooLarge");

  try {
    const { data, info } = await sharp(input, { limitInputPixels: LOGO_MAX_PIXELS, sequentialRead: true })
      .rotate()
      .resize({ width: LOGO_STORED_SIDE, height: LOGO_STORED_SIDE, fit: "inside", withoutEnlargement: true })
      .webp(sourceType === "png" ? { lossless: true } : { quality: 90, alphaQuality: 100 })
      .toBuffer({ resolveWithObject: true });
    if (data.byteLength === 0 || data.byteLength > LOGO_MAX_BYTES) throw new LogoRejected("tooLarge");
    return {
      bytes: data,
      mediaType: "image/webp",
      width: info.width,
      height: info.height,
      checksum: createHash("sha256").update(data).digest("hex"),
      sourceType,
    };
  } catch (error) {
    if (error instanceof LogoRejected) throw error;
    // A decoder complaint (truncated, damaged, inconsistent) is a file that is not usable as an image.
    throw new LogoRejected("invalid");
  }
}
