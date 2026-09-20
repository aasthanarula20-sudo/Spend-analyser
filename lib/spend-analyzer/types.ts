/**
 * Shared types for the Smart Spend Analyzer.
 * See PRD: "Smart Spend Analyzer" — P0 categorization + anomaly detection.
 */

export type Category =
  | "Groceries"
  | "Dining"
  | "Subscriptions"
  | "Utilities"
  | "Rent/EMI"
  | "Shopping"
  | "Transport"
  | "Health"
  | "Transfers"
  | "Cash Withdrawal"
  | "Uncategorized";

/** A single statement line, as parsed from the uploaded CSV. */
export interface RawTransaction {
  date: string;
  description: string;
  amount: number;
}

export interface CategorizedTransaction extends RawTransaction {
  category: Category;
  /** Normalized merchant key used for grouping (new-merchant, duplicate, recurring-increase checks). */
  merchantKey: string;
}

export type AnomalyReason =
  | "statistical_outlier"
  | "new_merchant_high_amount"
  | "recurring_charge_increase"
  | "duplicate_transaction"
  | "high_cash_withdrawal";

export interface Anomaly {
  transaction: CategorizedTransaction;
  reason: AnomalyReason;
  /** Plain-language explanation of why this transaction was flagged. */
  explanation: string;
}

export interface CategorySummary {
  category: Category;
  total: number;
  count: number;
  percentOfTotal: number;
}

export interface AnalysisResult {
  transactions: CategorizedTransaction[];
  categorySummaries: CategorySummary[];
  totalSpend: number;
  anomalies: Anomaly[];
}
