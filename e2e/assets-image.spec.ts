/**
 * Phase 18A: what becomes a logo. The pipeline in src/storage/logo-image judges a file by its BYTES (never its name or declared type),
 * refuses everything but PNG, JPEG and WebP (SVG and every document format included, renamed or not), refuses an image that claims more pixels
 * than it may have before decoding any, and stores a re-encoded, metadata-free WebP with its SHA-256. Nothing here needs a browser or a server.
 */
import { createHash } from "node:crypto";
import { expect, test } from "playwright/test";
import sharp from "sharp";
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE, LOGO_STORED_SIDE } from "../src/lib/asset-rules";
import { LogoRejected, normalizeLogo, sniffImageType } from "../src/storage/logo-image";
import { grayPng, PNG_SIGNATURE as SIGNATURE, pngChunk as chunk } from "./assets-helpers";

const solid = (width: number, height: number, alpha = 1) => ({ create: { width, height, channels: 4 as const, background: { r: 13, g: 92, b: 99, alpha } } });
const png = (width = 64, height = 48, alpha = 1) => sharp(solid(width, height, alpha)).png().toBuffer();
const jpeg = (width = 64, height = 48) => sharp(solid(width, height)).jpeg().toBuffer();
const webp = (width = 64, height = 48) => sharp(solid(width, height)).webp().toBuffer();

const reasonOf = async (input: Uint8Array): Promise<string> => {
  try {
    await normalizeLogo(input);
    return "accepted";
  } catch (error) {
    return error instanceof LogoRejected ? error.reason : `unexpected: ${String(error)}`;
  }
};

/** The same PNG with a text chunk right after the header. */
function withText(image: Buffer, text: string): Buffer {
  const at = SIGNATURE.length + 4 + 4 + 13 + 4; // the signature and the whole IHDR chunk
  return Buffer.concat([image.subarray(0, at), chunk("tEXt", Buffer.from(`Comment\0${text}`, "latin1")), image.subarray(at)]);
}

test.describe("what is accepted", () => {
  test("a PNG, a JPEG and a WebP each become a WebP, with the SHA-256 of what is stored", async () => {
    for (const [label, input, source] of [["png", await png(), "png"], ["jpeg", await jpeg(), "jpeg"], ["webp", await webp(), "webp"]] as const) {
      const logo = await normalizeLogo(input);
      expect(logo.sourceType, label).toBe(source);
      expect(logo.mediaType, label).toBe("image/webp");
      expect(sniffImageType(logo.bytes), label).toBe("webp");
      expect(logo.checksum, label).toBe(createHash("sha256").update(logo.bytes).digest("hex"));
      expect(logo.checksum, label).toMatch(/^[0-9a-f]{64}$/);
      expect([logo.width, logo.height], label).toEqual([64, 48]);
      const metadata = await sharp(logo.bytes).metadata();
      expect([metadata.format, metadata.width, metadata.height], label).toEqual(["webp", 64, 48]);
    }
  });

  test("a PNG keeps its transparency", async () => {
    const logo = await normalizeLogo(await png(32, 32, 0.4));
    expect((await sharp(logo.bytes).metadata()).hasAlpha).toBe(true);
    const { data, info } = await sharp(logo.bytes).raw().toBuffer({ resolveWithObject: true });
    const alpha = data[info.channels - 1];
    expect(alpha).toBeGreaterThan(80);
    expect(alpha).toBeLessThan(200);
  });

  test("a large image is scaled down to fit, in proportion, and a small one is never enlarged", async () => {
    const big = await normalizeLogo(await png(3000, 1000));
    expect([big.width, big.height]).toEqual([LOGO_STORED_SIDE, Math.round((1000 * LOGO_STORED_SIDE) / 3000)]);
    const small = await normalizeLogo(await png(20, 10));
    expect([small.width, small.height]).toEqual([20, 10]);
  });

  test("an image on its side is stood upright, and no metadata survives: not the orientation, not the camera, not a comment", async () => {
    const tall = await sharp(solid(40, 80)).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "Secret Studio" } } }).toBuffer();
    expect(tall.toString("latin1")).toContain("Secret Studio");
    expect((await sharp(tall).metadata()).orientation).toBe(6);
    const logo = await normalizeLogo(tall);
    // Orientation 6 means "rotate 90°": a 40 × 80 file is a 80 × 40 picture.
    expect([logo.width, logo.height]).toEqual([80, 40]);
    const out = await sharp(logo.bytes).metadata();
    expect(out.exif).toBeUndefined();
    expect(out.orientation).toBeUndefined();
    expect(Buffer.from(logo.bytes).toString("latin1")).not.toContain("Secret Studio");

    const text = "<script>alert('inside a PNG')</script>";
    const commented = withText(await png(), text);
    expect(commented.toString("latin1")).toContain(text);
    const stored = await normalizeLogo(commented);
    expect(Buffer.from(stored.bytes).toString("latin1")).not.toContain("script");
  });

  test("bytes appended after a valid image are dropped, not stored", async () => {
    const trailing = Buffer.concat([await png(), Buffer.from("<html><script>alert(1)</script></html>")]);
    const logo = await normalizeLogo(trailing);
    expect(Buffer.from(logo.bytes).toString("latin1")).not.toContain("script");
  });
});

test.describe("what is refused", () => {
  test("a file is judged by its bytes: a name or a type does not matter, and SVG, HTML, XML, GIF, PDF and the rest are not images here", async () => {
    const cases: [string, Buffer][] = [
      ["a text file called logo.png", Buffer.from("this is not an image")],
      ["an SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>')],
      ["an SVG with an XML header", Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>')],
      ["HTML", Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>")],
      ["XML", Buffer.from('<?xml version="1.0"?><root><a>1</a></root>')],
      ["a GIF", Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00;", "latin1")],
      ["a PDF", Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")],
      ["a Windows program", Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "latin1")],
      ["a shell script", Buffer.from("#!/bin/sh\nrm -rf /\n")],
      ["a ZIP", Buffer.from("PK\x03\x04\x14\x00\x00\x00", "latin1")],
      ["JSON", Buffer.from('{"logo":"yes"}')],
    ];
    for (const [label, input] of cases) expect(await reasonOf(input), label).toBe("unsupported");
  });

  test("a real SVG or HTML page is not sneaked through by starting with an image's signature either", async () => {
    // The signature is right and everything after it is not an image.
    expect(await reasonOf(Buffer.concat([SIGNATURE, Buffer.from("<svg><script>alert(1)</script></svg>")]))).toBe("invalid");
    expect(await reasonOf(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("<html><script>alert(1)</script></html>")]))).toBe("invalid");
    expect(await reasonOf(Buffer.concat([Buffer.from("RIFF\x10\x00\x00\x00WEBP", "latin1"), Buffer.from("<svg onload=alert(1)>")]))).toBe("invalid");
  });

  test("nothing, a truncated file and a damaged file are 'could not be read', not accepted half-way", async () => {
    expect(await reasonOf(new Uint8Array())).toBe("invalid");
    const whole = await png(200, 200);
    expect(await reasonOf(whole.subarray(0, Math.floor(whole.length / 2)))).toBe("invalid");
    const photo = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).jpeg().toBuffer();
    expect(await reasonOf(photo.subarray(0, Math.floor(photo.length / 2)))).toBe("invalid");
    const damaged = Buffer.from(whole);
    damaged.fill(0x41, 40, 80);
    expect(await reasonOf(damaged)).toBe("invalid");
  });

  test("a file over the size limit is too large, whatever it claims to be, before anything reads it", async () => {
    const huge = Buffer.concat([SIGNATURE, Buffer.alloc(LOGO_MAX_BYTES)]);
    expect(huge.length).toBeGreaterThan(LOGO_MAX_BYTES);
    expect(await reasonOf(huge)).toBe("tooLarge");
    // Exactly at the limit is judged by what it is, not refused for its size.
    expect(await reasonOf(Buffer.concat([SIGNATURE, Buffer.alloc(LOGO_MAX_BYTES - SIGNATURE.length)]))).toBe("invalid");
  });

  test("an image that claims more pixels than it may have is refused from its header, with no pixel buffer ever made for it", async () => {
    // 144 million pixels, a few hundred KB on disk.
    const bomb = await grayPng(12_000, 12_000);
    expect(bomb.length).toBeLessThan(LOGO_MAX_BYTES);
    const started = Date.now();
    expect(await reasonOf(bomb)).toBe("tooLarge");
    expect(await reasonOf(await grayPng(65_000, 1))).toBe("tooLarge");
    expect(await reasonOf(await grayPng(LOGO_MAX_SIDE + 1, 10))).toBe("tooLarge");
    expect(await reasonOf(await grayPng(10, LOGO_MAX_SIDE + 1))).toBe("tooLarge");
    // Refusing is quick because nothing is decoded; decoding even one of them would take a long time and hundreds of MB.
    expect(Date.now() - started).toBeLessThan(3000);
    // The largest allowed image, by contrast, is accepted.
    expect(await reasonOf(await grayPng(LOGO_MAX_SIDE, 8))).toBe("accepted");
  });

  test("a real image longer than the side limit is too large even when it has few pixels", async () => {
    expect(await reasonOf(await png(LOGO_MAX_SIDE + 4, 8))).toBe("tooLarge");
    expect(await reasonOf(await png(8, LOGO_MAX_SIDE + 4))).toBe("tooLarge");
    expect(await reasonOf(await png(LOGO_MAX_SIDE, 8))).toBe("accepted");
  });
});

test.describe("the signature check", () => {
  test("it names the three formats and nothing else, from the first bytes only", async () => {
    expect(sniffImageType(await png())).toBe("png");
    expect(sniffImageType(await jpeg())).toBe("jpeg");
    expect(sniffImageType(await webp())).toBe("webp");
    for (const bytes of [new Uint8Array(), new Uint8Array([0x89, 0x50]), Buffer.from("GIF89a"), Buffer.from("<svg"), Buffer.from("RIFF\0\0\0\0WAVE", "latin1"), Buffer.from("%PDF")]) {
      expect(sniffImageType(bytes)).toBeNull();
    }
  });
});
