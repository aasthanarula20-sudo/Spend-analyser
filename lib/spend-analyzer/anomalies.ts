/**
 * Anomaly detection over a categorized statement. Every rule here trades
 * off precision against recall in favor of precision (per PRD §5 —
 * alert fatigue kills trust), so thresholds are deliberately conservative.
 */
import type { Anomaly, CategorizedTransaction } from "./types";

const OUTLIER_MULTIPLIER = 2.5;
const NEW_MERCHANT_MULTIPLIER = 2;
const RECURRING_INCREASE_THRESHOLD = 0.15;
const CASH_WITHDRAWAL_MULTIPLIER = 2;
const DUPLICATE_WINDOW_DAYS = 3;

// Slash- or dash-separated numeric dates (e.g. "05/03/2024") are ambiguous —
// Date.parse assumes US MM/DD/YYYY, but this app targets Indian statements,
// which write DD/MM/YYYY. Left to Date.parse, a foreign-format statement
// gets silently misordered, which can flip a genuine price decrease into a
// false-positive recurring_charge_increase flag. ISO dates ("2024-03-05")
// and dates with a month name ("5 Jan 2024") are unambiguous either way and
// left to Date.parse.
const NUMERIC_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/;

function parseDate(date: string): number {
  const trimmed = date.trim();
  const match = trimmed.match(NUMERIC_DATE);
  if (match) {
    const [, first, second, yearPart] = match;
    let day = Number(first);
    let month = Number(second);
    // If the second component can't be a month, the format must actually be
    // MM/DD/YYYY (the first component is the month instead).
    if (month > 12 && day <= 12) {
      [day, month] = [month, day];
    }
    const year = yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart);
    const timestamp = Date.UTC(year, month - 1, day);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function detectAnomalies(transactions: CategorizedTransaction[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const byCategory = new Map<string, CategorizedTransaction[]>();
  const byMerchant = new Map<string, CategorizedTransaction[]>();
  for (const tx of transactions) {
    (byCategory.get(tx.category) ?? byCategory.set(tx.category, []).get(tx.category)!).push(tx);
    (byMerchant.get(tx.merchantKey) ?? byMerchant.set(tx.merchantKey, []).get(tx.merchantKey)!).push(tx);
  }

  const overallAverage = average(transactions.map((tx) => tx.amount));

  // 1. Statistical outliers: far above the transaction's own category average.
  for (const [, categoryTxs] of byCategory) {
    if (categoryTxs.length < 3) continue;
    for (const tx of categoryTxs) {
      const others = categoryTxs.filter((t) => t !== tx).map((t) => t.amount);
      const avg = average(others);
      if (avg > 0 && tx.amount > avg * OUTLIER_MULTIPLIER) {
        anomalies.push({
          transaction: tx,
          reason: "statistical_outlier",
          explanation: `₹${tx.amount.toFixed(0)} is ${(tx.amount / avg).toFixed(1)}x the average ${tx.category} transaction (₹${avg.toFixed(0)}).`,
        });
      }
    }
  }

  // 2. New/first-time merchant with a high amount.
  for (const [, merchantTxs] of byMerchant) {
    if (merchantTxs.length !== 1) continue;
    const tx = merchantTxs[0];
    if (overallAverage > 0 && tx.amount > overallAverage * NEW_MERCHANT_MULTIPLIER) {
      anomalies.push({
        transaction: tx,
        reason: "new_merchant_high_amount",
        explanation: `First transaction with this merchant, and ₹${tx.amount.toFixed(0)} is well above your typical transaction size (₹${overallAverage.toFixed(0)}).`,
      });
    }
  }

  // 3. Recurring charge that increased vs. the prior charge from the same merchant.
  // Cash withdrawals are excluded: the amount someone chooses to withdraw is
  // inherently variable, unlike a subscription/bill line item, so treating a
  // larger withdrawal as a "recurring charge increase" is just noise (the
  // separate high_cash_withdrawal check below already covers this category).
  for (const [, merchantTxs] of byMerchant) {
    if (merchantTxs.length < 2 || merchantTxs[0].category === "Cash Withdrawal") continue;
    const sorted = [...merchantTxs].sort((a, b) => parseDate(a.date) - parseDate(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.amount <= 0) continue;
      const increase = (curr.amount - prev.amount) / prev.amount;
      if (increase > RECURRING_INCREASE_THRESHOLD) {
        anomalies.push({
          transaction: curr,
          reason: "recurring_charge_increase",
          explanation: `Charge increased from ₹${prev.amount.toFixed(0)} to ₹${curr.amount.toFixed(0)} (+${(increase * 100).toFixed(0)}%) since the last charge from this merchant.`,
        });
      }
    }
  }

  // 4. Duplicate transactions: same merchant + amount within a short window.
  for (const [, merchantTxs] of byMerchant) {
    if (merchantTxs.length < 2) continue;
    const sorted = [...merchantTxs].sort((a, b) => parseDate(a.date) - parseDate(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const daysApart = Math.abs(parseDate(curr.date) - parseDate(prev.date)) / (1000 * 60 * 60 * 24);
      if (curr.amount === prev.amount && daysApart <= DUPLICATE_WINDOW_DAYS) {
        anomalies.push({
          transaction: curr,
          reason: "duplicate_transaction",
          explanation: `Same amount (₹${curr.amount.toFixed(0)}) from the same merchant as a transaction ${daysApart.toFixed(0)} day(s) earlier — possible duplicate charge.`,
        });
      }
    }
  }

  // 5. Unusually high cash withdrawals.
  const cashTxs = byCategory.get("Cash Withdrawal") ?? [];
  if (cashTxs.length >= 2) {
    for (const tx of cashTxs) {
      const others = cashTxs.filter((t) => t !== tx).map((t) => t.amount);
      const avg = average(others);
      if (avg > 0 && tx.amount > avg * CASH_WITHDRAWAL_MULTIPLIER) {
        anomalies.push({
          transaction: tx,
          reason: "high_cash_withdrawal",
          explanation: `₹${tx.amount.toFixed(0)} cash withdrawal is well above your typical withdrawal (₹${avg.toFixed(0)}).`,
        });
      }
    }
  }

  return anomalies;
}
