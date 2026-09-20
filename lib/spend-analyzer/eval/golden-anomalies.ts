/**
 * Golden set for the anomaly detector: whole statements, each transaction
 * hand-labeled with whether a human reviewing the statement would flag
 * it, and why. Unlike test-spend-analyzer.ts (which checks "does this
 * specific rule fire on this specific input"), this measures precision
 * and recall against a realistic mix of statements — including ones
 * that should produce *no* flags at all, which is what precision
 * actually tests. Per the PRD, false-positive rate matters more here
 * than recall: a noisy anomaly detector trains users to ignore it.
 */
import type { AnomalyReason, RawTransaction } from "../types";

export interface AnomalyCase {
  name: string;
  statement: RawTransaction[];
  /** Index into `statement` -> the anomaly reason(s) a human would flag there. */
  expected: Record<number, AnomalyReason[]>;
  note?: string;
  /** True if the current detector is known to get this case wrong (documented, not silently skipped). */
  knownLimitation?: boolean;
}

export const GOLDEN_ANOMALY_CASES: AnomalyCase[] = [
  {
    name: "statistical outlier in a repeated category",
    statement: [
      { date: "2024-01-02", description: "SWIGGY ORDER", amount: 300 },
      { date: "2024-01-06", description: "ZOMATO ORDER", amount: 350 },
      { date: "2024-01-10", description: "SWIGGY ORDER", amount: 320 },
      { date: "2024-01-14", description: "SWIGGY ORDER", amount: 340 },
      { date: "2024-01-18", description: "SWIGGY ORDER", amount: 4500 },
    ],
    // The last SWIGGY ORDER is both a category outlier AND a huge jump from
    // its own prior charge from the same merchant — both reasons legitimately
    // apply to the same transaction.
    expected: { 4: ["statistical_outlier", "recurring_charge_increase"] },
  },
  {
    name: "new merchant with a high one-off amount",
    statement: [
      { date: "2024-01-02", description: "AMAZON PURCHASE", amount: 800 },
      { date: "2024-01-06", description: "FLIPKART ORDER", amount: 600 },
      { date: "2024-01-10", description: "AMAZON PURCHASE", amount: 750 },
      { date: "2024-01-14", description: "BRAND NEW ELECTRONICS STORE", amount: 42000 },
    ],
    // "STORE" matches the Shopping keyword, so this also lands in the same
    // category as the three Amazon/Flipkart transactions and is a category
    // outlier too, on top of being a first-time merchant.
    expected: { 3: ["new_merchant_high_amount", "statistical_outlier"] },
  },
  {
    name: "recurring subscription charge that increased",
    statement: [
      { date: "2024-01-05", description: "NETFLIX.COM", amount: 499 },
      { date: "2024-02-05", description: "NETFLIX.COM", amount: 499 },
      { date: "2024-03-05", description: "NETFLIX.COM", amount: 799 },
    ],
    expected: { 2: ["recurring_charge_increase"] },
    note: "a 60% jump on the third charge from the same merchant",
  },
  {
    name: "duplicate charge within a few days",
    statement: [
      { date: "2024-01-10", description: "UBER TRIP", amount: 260 },
      { date: "2024-01-12", description: "AMAZON PURCHASE", amount: 1200 },
      { date: "2024-01-12", description: "AMAZON PURCHASE", amount: 1200 },
    ],
    expected: { 2: ["duplicate_transaction"] },
    note: "same merchant, same amount, same day — classic double-charge pattern",
  },
  {
    name: "unusually large cash withdrawal among smaller ones",
    statement: [
      { date: "2024-01-03", description: "ATM WDL CASH", amount: 2000 },
      { date: "2024-01-10", description: "ATM WDL CASH", amount: 2000 },
      { date: "2024-01-17", description: "ATM WDL CASH", amount: 2500 },
      { date: "2024-01-24", description: "ATM WDL CASH", amount: 15000 },
    ],
    // 15,000 is both >2x the average withdrawal (high_cash_withdrawal) and
    // >2.5x the average of the *other* transactions in its category
    // (statistical_outlier) — both rules independently and correctly catch it.
    expected: { 3: ["high_cash_withdrawal", "statistical_outlier"] },
  },
  {
    name: "clean statement — nothing should be flagged",
    statement: [
      { date: "2024-01-02", description: "SWIGGY ORDER", amount: 320 },
      { date: "2024-01-06", description: "BIG BAZAAR GROCERY", amount: 1450 },
      { date: "2024-01-10", description: "NETFLIX.COM", amount: 499 },
      { date: "2024-01-14", description: "UBER TRIP", amount: 260 },
      { date: "2024-01-18", description: "ATM WDL CASH", amount: 2000 },
      { date: "2024-01-22", description: "ELECTRICITY BILL", amount: 1800 },
      { date: "2024-01-28", description: "AMAZON PURCHASE", amount: 900 },
    ],
    expected: {},
    note: "every transaction is ordinary for its category — this is the precision test: any flag here is a false positive",
  },
  {
    name: "small recurring bump that should NOT be flagged (below threshold)",
    statement: [
      { date: "2024-01-05", description: "SPOTIFY PREMIUM", amount: 119 },
      { date: "2024-02-05", description: "SPOTIFY PREMIUM", amount: 129 },
    ],
    expected: {},
    note: "an 8% price bump is normal (below the 15% recurring-increase threshold) — should not be flagged",
  },
  {
    name: "two-transaction category should not trigger statistical outlier",
    statement: [
      { date: "2024-01-05", description: "APOLLO PHARMACY", amount: 400 },
      { date: "2024-01-20", description: "FORTIS HOSPITAL", amount: 8000 },
    ],
    expected: {},
    note: "the detector requires >=3 transactions in a category before judging an outlier — with only 2, even a 20x gap should not fire",
  },

  // --- International / foreign-format statements ---
  // parseDate() in anomalies.ts used to rely solely on the JS built-in
  // Date.parse, which assumes US MM/DD/YYYY ordering for slash-separated
  // dates — but this app targets Indian DD/MM/YYYY statements. Fixed by
  // parsing ambiguous numeric dates as DD/MM/YYYY explicitly (falling back
  // to MM/DD only when the second component can't be a valid month). This
  // case is a regression guard for that fix.
  {
    name: "foreign date format (MM/DD/YYYY) must not flip a price decrease into a false 'increase'",
    statement: [
      // DD/MM/YYYY reading: 5 Mar 2024 (₹799) then 3 May 2024 (₹499) — a
      // price *decrease* over time, nothing to flag. Naively parsing these
      // as MM/DD/YYYY ("05/03" -> May 3, "03/05" -> Mar 5) would sort the
      // ₹499 charge BEFORE the ₹799 one and report a fabricated increase.
      { date: "05/03/2024", description: "NETFLIX.COM", amount: 799 },
      { date: "03/05/2024", description: "NETFLIX.COM", amount: 499 },
    ],
    expected: {},
    note: "true chronological order (DD/MM/YYYY) is a price decrease — nothing should be flagged",
  },
];
