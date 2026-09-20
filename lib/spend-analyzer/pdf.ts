/**
 * Browser-only PDF text extraction for statement uploads. Runs entirely
 * client-side via pdf.js (WebAssembly-free text layer extraction, no
 * network calls once the worker asset is bundled) — the PDF's bytes never
 * leave the browser, same privacy guarantee as the CSV path.
 *
 * Does not do OCR: a scanned/image-only PDF has no text layer and will
 * yield no transactions.
 */
import * as pdfjsLib from "pdfjs-dist";

// Bundler-resolved worker asset — Next.js (webpack and Turbopack) resolves
// `new URL(specifier, import.meta.url)` as a static asset reference and
// emits it alongside the page bundle, so no CDN fetch is needed at runtime.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface TextItem {
  str: string;
  transform: number[];
}

/**
 * Thrown when a PDF is encrypted and needs a password to open — very
 * common for Indian bank statements (typically your PAN or date of birth).
 * `reason` distinguishes "no password was tried yet" from "the one tried
 * was wrong", so the caller can show the right prompt copy.
 */
export class PdfPasswordError extends Error {
  reason: "needed" | "incorrect";
  constructor(reason: "needed" | "incorrect") {
    super(reason === "incorrect" ? "Incorrect password." : "This PDF is password-protected.");
    this.name = "PdfPasswordError";
    this.reason = reason;
  }
}

/**
 * Extracts the PDF's text, reconstructed into lines using each text
 * item's vertical position (pdf.js returns text fragments, not lines).
 * Pass `password` when the caller already has one (e.g. a retry after
 * PdfPasswordError) — reads fresh bytes from `file` each call, so a
 * failed attempt never leaves a detached/consumed buffer behind.
 */
export async function extractPdfText(file: File, password?: string): Promise<string> {
  const buffer = await file.arrayBuffer();

  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: buffer, password }).promise;
  } catch (err) {
    // pdf.js's PasswordException isn't re-exported from the package's
    // top-level entry point, so it's detected by name rather than
    // `instanceof` — `.code` distinguishes "none tried yet" from "wrong".
    if (err instanceof Error && err.name === "PasswordException") {
      const code = (err as Error & { code?: number }).code;
      throw new PdfPasswordError(code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "needed");
    }
    throw err;
  }

  const pageLines: string[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    const rows = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as TextItem[]) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      const row = rows.get(y) ?? [];
      row.push({ x, str: item.str });
      rows.set(y, row);
    }

    const sortedRows = Array.from(rows.entries()).sort((a, b) => b[0] - a[0]);
    for (const [, fragments] of sortedRows) {
      const line = fragments
        .sort((a, b) => a.x - b.x)
        .map((f) => f.str)
        .join(" ");
      pageLines.push(line);
    }
  }

  return pageLines.join("\n");
}
