/**
 * Orchestrator: raw statement transactions in, categorized transactions +
 * category summary + anomalies out. Pure and side-effect-free — no I/O,
 * no storage. Three entry points share this core, one per supported input
 * shape: CSV export, PDF (via its extracted text), or pasted free-form text.
 */
import { detectAnomalies } from "./anomalies";
import { categorizeTransactions } from "./categorize";
import { parseStatementCsv } from "./csv";
import { parseStatementText } from "./text-parser";
import type { AnalysisResult, Category, CategorySummary, RawTransaction } from "./types";

function summarizeByCategory(transactions: AnalysisResult["transactions"], totalSpend: number): CategorySummary[] {
  const totals = new Map<Category, { total: number; count: number }>();
  for (const tx of transactions) {
    const entry = totals.get(tx.category) ?? { total: 0, count: 0 };
    entry.total += tx.amount;
    entry.count += 1;
    totals.set(tx.category, entry);
  }

  return Array.from(totals.entries())
    .map(([category, { total, count }]) => ({
      category,
      total,
      count,
      percentOfTotal: totalSpend > 0 ? (total / totalSpend) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function analyzeTransactions(raw: RawTransaction[]): AnalysisResult {
  const transactions = categorizeTransactions(raw);
  const totalSpend = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const categorySummaries = summarizeByCategory(transactions, totalSpend);
  const anomalies = detectAnomalies(transactions);

  return { transactions, categorySummaries, totalSpend, anomalies };
}

export function analyzeStatementCsv(csvText: string): AnalysisResult {
  return analyzeTransactions(parseStatementCsv(csvText));
}

/** For PDF-extracted text or a statement copy-pasted from a banking app/portal. */
export function analyzeStatementText(text: string): AnalysisResult {
  return analyzeTransactions(parseStatementText(text));
}
