/**
 * A tiny PDF writer for text reports: Letter pages, the built-in Helvetica fonts, no compression and no images.
 * It exists so Analytics can offer a real .pdf download without a library or a service. Text is limited to what the
 * built-in fonts can draw, so anything else is replaced with a close ASCII character.
 */

/** `value`, when given, is drawn in a second column so figures line up whatever the width of the label. */
export type PdfLine = { text: string; value?: string; style?: "title" | "heading" | "body" | "muted" };

const PAGE = { width: 612, height: 792, margin: 56, valueColumn: 380 };

const STYLE = {
  title: { font: "F2", size: 18, leading: 28 },
  heading: { font: "F2", size: 12, leading: 24 },
  body: { font: "F1", size: 10.5, leading: 16 },
  muted: { font: "F1", size: 9, leading: 14 },
} as const;

const REPLACEMENTS: Record<string, string> = { "–": "-", "—": "-", "·": "|", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", " ": " " };

/** Printable ASCII only, with the characters PDF strings treat specially escaped. */
function toPdfText(text: string): string {
  return text
    .replace(/[–—·‘’“”… ]/g, (char) => REPLACEMENTS[char])
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\()]/g, (char) => `\\${char}`);
}

/** Lays the lines out top to bottom, starting a new page when one is full. */
function paginate(lines: readonly PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [[]];
  let y = PAGE.height - PAGE.margin;
  for (const line of lines) {
    const { leading } = STYLE[line.style ?? "body"];
    if (y - leading < PAGE.margin) {
      pages.push([]);
      y = PAGE.height - PAGE.margin;
    }
    pages[pages.length - 1].push(line);
    y -= leading;
  }
  return pages;
}

function pageContent(lines: readonly PdfLine[]): string {
  let y = PAGE.height - PAGE.margin;
  const out: string[] = [];
  for (const line of lines) {
    const { font, size, leading } = STYLE[line.style ?? "body"];
    y -= leading;
    const baseline = y + (leading - size) / 2;
    if (line.text) out.push(`BT /${font} ${size} Tf ${PAGE.margin} ${baseline} Td (${toPdfText(line.text)}) Tj ET`);
    if (line.value) out.push(`BT /${font} ${size} Tf ${PAGE.valueColumn} ${baseline} Td (${toPdfText(line.value)}) Tj ET`);
  }
  return out.join("\n");
}

/** The bytes of a PDF document holding `lines`. */
export function buildPdf(lines: readonly PdfLine[]): Uint8Array {
  const pages = paginate(lines);
  // Objects: 1 Catalog, 2 Pages, 3 Helvetica, 4 Helvetica-Bold, then a Page and its Contents per page.
  const bodies: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  pages.forEach((pageLines, index) => {
    const content = pageContent(pageLines);
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });

  // Everything is ASCII, so a string's length is its byte length and the offsets below are exact.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Uint8Array.from(pdf, (char) => char.charCodeAt(0));
}
