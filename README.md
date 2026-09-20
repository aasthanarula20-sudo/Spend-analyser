# Smart Spend Analyzer

Upload a bank/card statement — **CSV, PDF, or pasted text** — and see spend
broken down by category, plus flagged anomalies (statistical outliers, new
high-value merchants, recurring charges that increased, likely duplicate
charges, unusually large cash withdrawals).

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Design principles

- **Categorization is rule-based** (merchant/narration keyword matching,
  `lib/spend-analyzer/categorize.ts`), not LLM-based — deterministic, free
  to run, and keeps statement contents from ever leaving the browser.
- **Privacy is a stated principle, not an afterthought:** the whole
  pipeline (`lib/spend-analyzer/{csv,text-parser,categorize,anomalies,analyze}.ts`)
  is pure and runs client-side in `app/page.tsx` — the uploaded file (CSV
  or PDF) is parsed in the browser and never sent to a server or persisted
  anywhere. PDF text extraction uses `pdfjs-dist` (`lib/spend-analyzer/pdf.ts`),
  also entirely in-browser — the PDF's bytes never leave the tab.
- **Three input paths, one shared core** (`analyzeTransactions` in
  `analyze.ts`): a structured CSV export (`csv.ts`, header + delimited
  columns), a PDF's extracted text, or free-form pasted text (both go
  through the same generic line parser, `text-parser.ts` — it looks for a
  leading date and an amount on each line, using a `Dr`/`Cr` marker where
  present to tell spend from income).
- **Statement format variability** — the hardest engineering problem here
  is not categorization. The CSV parser handles a signed `Amount` column
  or separate `Debit`/`Credit` columns with flexible header matching; the
  text parser is a best-effort heuristic over whatever text a PDF's text
  layer (or a pasted statement) contains, and won't extract anything from
  a scanned/image-only PDF (no OCR).
- Not built (P1/P2, future work): subscription audit view, budget vs.
  actual tracking, merchant-level drill-down, savings-rate tracking,
  what-if simulator, bill-negotiation nudges, goal-linked tracking, and
  month-over-month trend across multiple uploaded statements.

## Tests

```bash
npm run test  # lib/spend-analyzer/test-spend-analyzer.ts
```

Unit tests lock in specific behavior of the code as written — they should
only fail when you change the code on purpose.

## Eval (quality, not correctness)

```bash
npm run eval  # lib/spend-analyzer/eval/run-eval.ts
```

This is deliberately separate from `npm run test`. The eval asks "does the
engine's output match what a human would actually want?", against golden
datasets (`eval/golden-categorization.ts`, `eval/golden-anomalies.ts`,
`eval/golden-parsing.ts`) that are *allowed* to contain cases the engine
currently gets wrong — surfacing those is the point. It reports:

1. Categorization accuracy, per-category precision/recall, and a confusion
   matrix.
2. Anomaly-detection precision/recall, aggregated across statements —
   including statements that should produce *zero* flags, which is what
   actually tests precision (false-positive rate matters more than recall:
   a noisy detector trains users to ignore it).
3. Statement-parsing correctness — a parsing failure is silent (a
   mis-parsed row doesn't get miscategorized, it just vanishes from the
   statement), so this makes that failure visible.
4. Consistency/robustness checks: determinism (same input twice ->
   identical output), order-invariance (shuffling transaction order
   doesn't change what gets flagged), case/whitespace/punctuation/order-ID
   robustness in categorization, and processor-prefix invariance in
   merchant-key normalization (`normalizeMerchant()` in `categorize.ts`) —
   a payment processor routing a charge (Razorpay, PhonePe, Paytm, ...) is
   not the merchant, so `"RAZORPAY SWIGGY ORDER"` and `"SWIGGY ORDER"` must
   resolve to the same merchant key, or recurring-charge/duplicate/
   new-merchant detection breaks whenever the processor changes between
   statements.

Every golden case can be marked `knownLimitation: true` — a documented gap
reported separately (⚠️ still reproduces / ✨ now fixed) rather than
failing the run, so a real regression is never buried in a pile of
already-known gaps. Three categorization gaps are currently open on
purpose (a courier service keyword-matched to Dining via its parent
brand's name; two entertainment-ticketing merchants with no dedicated
category) — long-tail brand-name problems better suited to an eventual
LLM-based categorizer than more keyword whack-a-mole.

Building this eval caught and fixed eight real bugs — naive substring
keyword matching, a boundary-logic bug for keywords ending in a symbol,
cash withdrawals triggering a nonsensical "recurring charge increased"
flag, a brand/settling-entity mismatch, silently-dropped foreign-currency
transactions, a foreign-date-format misread that flipped a price decrease
into a false increase, and payment-processor prefixes breaking merchant
grouping. See the eval source files for the full detail on each.

## Architecture

- `lib/spend-analyzer/csv.ts` — CSV statement parsing.
- `lib/spend-analyzer/text-parser.ts` — generic line-based parser for
  PDF-extracted or pasted text.
- `lib/spend-analyzer/pdf.ts` — in-browser PDF text extraction (`pdfjs-dist`).
- `lib/spend-analyzer/categorize.ts` — rule-based categorization + merchant
  key normalization.
- `lib/spend-analyzer/anomalies.ts` — anomaly detection rules.
- `lib/spend-analyzer/analyze.ts` — orchestrator tying the above together.
- `lib/spend-analyzer/eval/` — the golden-set eval harness (see above).
- `app/page.tsx` — the upload UI (client-side only).
