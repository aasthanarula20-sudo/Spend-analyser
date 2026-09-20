/**
 * Executable assertions for the Smart Spend Analyzer's parsing,
 * categorization, and anomaly-detection logic.
 *
 * Usage: npx tsx lib/spend-analyzer/test-spend-analyzer.ts
 */
import { analyzeStatementCsv, analyzeStatementText } from "./analyze";
import { categorizeTransaction } from "./categorize";
import { parseStatementCsv } from "./csv";
import { parseStatementText } from "./text-parser";

let passed = 0;
let failed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(label: string, condition: boolean) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}

// Categorization
{
  assertEqual("categorize swiggy", categorizeTransaction("SWIGGY*ORDER 12345"), "Dining");
  assertEqual("categorize netflix", categorizeTransaction("NETFLIX.COM"), "Subscriptions");
  assertEqual("categorize atm", categorizeTransaction("ATM WDL CASH XYZ"), "Cash Withdrawal");
  assertEqual("categorize unknown", categorizeTransaction("SOME RANDOM PAYEE"), "Uncategorized");
}

// CSV parsing: signed Amount column
{
  const csv = ["Date,Description,Amount", "2024-01-01,Salary Credit,50000", "2024-01-02,Amazon Purchase,-1200"].join("\n");
  const rows = parseStatementCsv(csv);
  assertEqual("signed csv: only debit kept", rows.length, 1);
  assertEqual("signed csv: amount is positive", rows[0]?.amount, 1200);
  assertEqual("signed csv: description", rows[0]?.description, "Amazon Purchase");
}

// CSV parsing: Debit/Credit columns
{
  const csv = ["Date,Narration,Debit,Credit", "2024-01-01,Salary,,50000", "2024-01-02,Big Bazaar,1500,"].join("\n");
  const rows = parseStatementCsv(csv);
  assertEqual("debit/credit csv: only debit kept", rows.length, 1);
  assertEqual("debit/credit csv: amount", rows[0]?.amount, 1500);
}

// Full analysis: category summary + anomalies
{
  const csv = [
    "Date,Description,Amount",
    "2024-01-01,SWIGGY ORDER,-300",
    "2024-01-05,SWIGGY ORDER,-350",
    "2024-01-10,SWIGGY ORDER,-320",
    "2024-01-15,SWIGGY ORDER,-4000",
    "2024-02-01,NETFLIX.COM,-499",
    "2024-03-01,NETFLIX.COM,-999",
    "2024-01-20,ATM WDL,-2000",
    "2024-01-21,ATM WDL,-2000",
    "2024-01-25,BRAND NEW SHOP,-9000",
    "2024-04-01,BIG BAZAAR,-500",
    "2024-04-02,BIG BAZAAR,-500",
  ].join("\n");

  const result = analyzeStatementCsv(csv);
  assertEqual("total transactions", result.transactions.length, 11);

  const diningSummary = result.categorySummaries.find((s) => s.category === "Dining");
  assert("dining summary exists", Boolean(diningSummary));
  assertEqual("dining total", diningSummary?.total, 300 + 350 + 320 + 4000);

  const reasons = result.anomalies.map((a) => a.reason);
  assert("flags statistical outlier", reasons.includes("statistical_outlier"));
  assert("flags recurring charge increase", reasons.includes("recurring_charge_increase"));
  assert("flags duplicate transaction", reasons.includes("duplicate_transaction"));
  assert("flags new merchant high amount", reasons.includes("new_merchant_high_amount"));
}

// Free-form text parsing (PDF-extracted text / pasted statement text)
{
  const text = [
    "Statement of Account",
    "Date       Description              Amount    Balance",
    "01/01/2024 SALARY CREDIT           50,000.00 Cr   62,000.00",
    "02/01/2024 AMAZON PURCHASE          1,200.00 Dr   60,800.00",
    "05/01/2024 SWIGGY ORDER               350.00 Dr   60,450.00",
  ].join("\n");

  const rows = parseStatementText(text);
  assertEqual("text parser: only debits kept", rows.length, 2);
  assert("text parser: amazon row found", rows.some((r) => r.description.includes("AMAZON PURCHASE") && r.amount === 1200));
  assert("text parser: swiggy row found", rows.some((r) => r.description.includes("SWIGGY ORDER") && r.amount === 350));

  const result = analyzeStatementText(text);
  assertEqual("text analysis: total spend", result.totalSpend, 1550);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
