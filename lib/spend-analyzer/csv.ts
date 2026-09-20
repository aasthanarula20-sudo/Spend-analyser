/**
 * CSV parsing for bank/card statements. Handles the two common export
 * shapes: a single signed "Amount" column, or separate "Debit"/"Credit"
 * columns. Credits (income, refunds) are dropped — this tool categorizes
 * spend, not income.
 */
import type { RawTransaction } from "./types";

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function findColumn(header: string[], candidates: string[]): number {
  const lower = header.map((h) => h.toLowerCase());
  for (const candidate of candidates) {
    const idx = lower.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  // Strip common currency symbols, thousands separators, and whitespace,
  // then any remaining letters — covers a bare currency code like "USD"
  // that a symbol strip alone wouldn't catch. Without this, a foreign-
  // currency amount (€45.00, £32.50, "USD -0.99") fails Number() parsing
  // and the whole transaction silently vanishes from the statement.
  const cleaned = raw.replace(/[₹$€£¥,\s]/g, "").replace(/[a-zA-Z]/g, "");
  if (!cleaned) return null;
  const negative = /^\(.*\)$/.test(cleaned);
  const numeric = Number(cleaned.replace(/[()]/g, ""));
  if (Number.isNaN(numeric)) return null;
  return negative ? -Math.abs(numeric) : numeric;
}

/**
 * Parses a bank/card statement CSV into spend-only transactions (debits).
 * Throws if no date/description column can be found.
 */
export function parseStatementCsv(csvText: string): RawTransaction[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]);
  const dateCol = findColumn(header, ["date"]);
  const descCol = findColumn(header, ["description", "narration", "particulars", "details", "merchant"]);
  const amountCol = findColumn(header, ["amount"]);
  const debitCol = findColumn(header, ["debit", "withdrawal"]);
  const creditCol = findColumn(header, ["credit", "deposit"]);

  if (dateCol === -1 || descCol === -1) {
    throw new Error("Could not find Date/Description columns in the uploaded CSV.");
  }
  if (amountCol === -1 && debitCol === -1) {
    throw new Error("Could not find an Amount or Debit column in the uploaded CSV.");
  }

  const transactions: RawTransaction[] = [];

  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    const date = fields[dateCol] ?? "";
    const description = fields[descCol] ?? "";
    if (!date || !description) continue;

    let amount: number | null = null;

    if (debitCol !== -1 || creditCol !== -1) {
      const debit = debitCol !== -1 ? parseAmount(fields[debitCol] ?? "") : null;
      if (debit && debit > 0) amount = debit;
      // A row with only a credit amount is income, not spend — skip it.
    } else if (amountCol !== -1) {
      const value = parseAmount(fields[amountCol] ?? "");
      // Signed-amount statements use negative for debits.
      if (value !== null && value < 0) amount = Math.abs(value);
    }

    if (amount === null || amount <= 0) continue;
    transactions.push({ date, description, amount });
  }

  return transactions;
}
