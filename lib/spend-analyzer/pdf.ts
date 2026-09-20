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
 * Extracts the PDF's text, reconstructed into lines using each text
 * item's vertical position (pdf.js returns text fragments, not lines).
 */
export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;

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
