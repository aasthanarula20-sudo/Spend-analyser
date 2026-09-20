/**
 * Generic line-based statement parser. Unlike csv.ts (which relies on a
 * header row and delimited columns), this works on free-form text — the
 * text layer extracted from a PDF statement, or a statement copy-pasted
 * directly from a banking app/portal. Per the PRD, statement format
 * variability (not categorization) is the hardest part of this problem;
 * this parser is a best-effort heuristic, not a guarantee of full
 * extraction for every bank's layout.
 *
 * Heuristic per line: find a leading date, find the amount-like numbers
 * that follow it, and treat everything in between as the description.
 * Credits (income) are skipped — this tool categorizes spend.
 */
import type { RawTransaction } from "./types";

const DATE_PATTERN =
  /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}[,\s]+\d{2,4}/;

const AMOUNT_PATTERN = /[₹$€£¥]?\(?-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\)?\s*(?:cr|dr)?/gi;

const HEADER_KEYWORDS = ["date", "description", "narration", "particulars", "amount", "balance", "debit", "credit"];

function isHeaderLine(line: string): boolean {
  const lower = line.toLowerCase();
  const matches = HEADER_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  return matches >= 2 && !DATE_PATTERN.test(line.trim().slice(0, 15));
}

function parseAmountToken(token: string): { value: number; isCredit: boolean } | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const isCredit = /cr$/i.test(trimmed);
  const isDebit = /dr$/i.test(trimmed);
  const numeric = trimmed.replace(/[₹$€£¥,a-zA-Z\s]/g, "");
  const negative = /^\(.*\)$/.test(trimmed) || numeric.startsWith("-");
  const value = Number(numeric.replace(/[()\-]/g, ""));
  if (Number.isNaN(value) || value === 0) return null;
  // An explicit "Dr" suffix or a bare negative/parenthesized number is a debit;
  // an explicit "Cr" suffix is a credit. Ambiguous (no marker) numbers are
  // resolved by the caller using column position instead.
  return { value, isCredit: isCredit && !isDebit && !negative };
}

/**
 * Parses free-form statement text into spend-only transactions.
 */
export function parseStatementText(text: string): RawTransaction[] {
  const lines = text.split(/\r?\n/);
  const transactions: RawTransaction[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || isHeaderLine(line)) continue;

    const dateMatch = line.match(DATE_PATTERN);
    if (!dateMatch || dateMatch.index === undefined) continue;

    const afterDate = line.slice(dateMatch.index + dateMatch[0].length);
    const amountMatches = Array.from(afterDate.matchAll(AMOUNT_PATTERN)).filter((m) => m[0].trim().length > 0);
    if (amountMatches.length === 0) continue;

    // Prefer an explicitly-marked debit; otherwise, when two trailing numbers
    // are present (amount + running balance), the first is the transaction
    // amount. With only one number, take it as the amount.
    const parsedAmounts = amountMatches.map((m) => ({ match: m, parsed: parseAmountToken(m[0]) })).filter((a) => a.parsed !== null);
    if (parsedAmounts.length === 0) continue;

    const explicitDebit = parsedAmounts.find((a) => /dr$/i.test(a.match[0].trim()));
    const explicitCredit = parsedAmounts.find((a) => /cr$/i.test(a.match[0].trim()));

    if (!explicitDebit && explicitCredit) continue; // explicitly marked as a credit — income, skip

    const chosen = explicitDebit ?? parsedAmounts[0];

    const descStart = dateMatch.index + dateMatch[0].length;
    const descEnd = descStart + chosen.match.index!;
    const description = line
      .slice(descStart, descEnd)
      .replace(/\s+/g, " ")
      .trim();

    if (!description || chosen.parsed!.value <= 0) continue;

    transactions.push({ date: dateMatch[0], description, amount: Math.abs(chosen.parsed!.value) });
  }

  return transactions;
}
