/**
 * Eval harness for the rule-based Smart Spend Analyzer engine.
 *
 * This is deliberately separate from `npm run test` (test-spend-analyzer.ts):
 * unit tests lock in specific code behavior and should only fail when you
 * change the code on purpose. This eval instead asks "does the engine's
 * output match what a human would actually want?", against golden datasets
 * (golden-categorization.ts, golden-anomalies.ts, golden-parsing.ts) that
 * are allowed to contain cases the engine currently gets wrong — finding
 * those is the point. It reports:
 *
 *   1. Categorization accuracy, per-category precision/recall, and a
 *      confusion matrix — against golden-categorization.ts.
 *   2. Anomaly-detection precision/recall (aggregate, across all golden
 *      statements) — against golden-anomalies.ts. Per the PRD, precision
 *      (few false positives) matters more here than recall.
 *   3. Statement-parsing correctness — against golden-parsing.ts. A parsing
 *      failure is silent (a mis-parsed row just vanishes from the
 *      statement), so this exists to make that failure visible.
 *   4. Consistency/robustness checks: determinism (same input -> same
 *      output on repeat runs), order-invariance (shuffling transaction
 *      order doesn't change per-transaction results), case/whitespace/
 *      punctuation/order-ID robustness in categorization, and
 *      processor-prefix invariance in merchant-key normalization (a
 *      payment processor routing a charge is not the merchant — see
 *      normalizeMerchant() in categorize.ts).
 *
 * Every golden set can mark a case `knownLimitation: true` — a documented
 * gap that's reported separately (⚠️ still reproduces / ✨ now fixed) rather
 * than failing the run, so a real regression (a case that used to pass and
 * now doesn't) is never buried in a pile of already-known gaps.
 *
 * Usage: npx tsx lib/spend-analyzer/eval/run-eval.ts
 */
import { detectAnomalies } from "../anomalies";
import { categorizeTransaction, categorizeTransactions, normalizeMerchant } from "../categorize";
import { parseStatementCsv } from "../csv";
import type { Anomaly, AnomalyReason, Category, RawTransaction } from "../types";
import { GOLDEN_ANOMALY_CASES } from "./golden-anomalies";
import { GOLDEN_CATEGORIZATION_CASES } from "./golden-categorization";
import { GOLDEN_PARSING_CASES } from "./golden-parsing";

const CATEGORIES: Category[] = [
  "Groceries", "Dining", "Subscriptions", "Utilities", "Rent/EMI",
  "Shopping", "Transport", "Health", "Transfers", "Cash Withdrawal", "Uncategorized",
];

let exitCode = 0;

function section(title: string) {
  console.log(`\n${"=".repeat(3)} ${title} ${"=".repeat(Math.max(0, 60 - title.length))}`);
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// 1. Categorization accuracy + confusion matrix
// ---------------------------------------------------------------------------

function runCategorizationEval() {
  section("Categorization eval");

  const confusion = new Map<Category, Map<Category, number>>();
  for (const c of CATEGORIES) confusion.set(c, new Map());

  let correct = 0;
  let correctExcludingKnown = 0;
  let totalExcludingKnown = 0;
  const unexpectedFailures: { description: string; expected: Category; actual: Category }[] = [];
  const unexpectedPasses: { description: string; expected: Category; note?: string }[] = [];

  for (const c of GOLDEN_CATEGORIZATION_CASES) {
    const actual = categorizeTransaction(c.description);
    const isMatch = actual === c.expected;
    if (isMatch) correct++;

    const row = confusion.get(c.expected)!;
    row.set(actual, (row.get(actual) ?? 0) + 1);

    if (!c.knownLimitation) {
      totalExcludingKnown++;
      if (isMatch) correctExcludingKnown++;
      else unexpectedFailures.push({ description: c.description, expected: c.expected, actual });
    } else if (isMatch) {
      unexpectedPasses.push({ description: c.description, expected: c.expected, note: c.note });
    }
  }

  const total = GOLDEN_CATEGORIZATION_CASES.length;
  console.log(`Overall accuracy: ${correct}/${total} (${pct(correct, total)})`);
  console.log(
    `Accuracy excluding known limitations: ${correctExcludingKnown}/${totalExcludingKnown} (${pct(correctExcludingKnown, totalExcludingKnown)})`
  );

  console.log("\nPer-category precision / recall:");
  console.log("category".padEnd(18) + "precision".padStart(12) + "recall".padStart(10) + "  support");
  for (const cat of CATEGORIES) {
    let tp = 0, fp = 0, fn = 0, support = 0;
    for (const c of GOLDEN_CATEGORIZATION_CASES) {
      const actual = categorizeTransaction(c.description);
      if (c.expected === cat) {
        support++;
        if (actual === cat) tp++;
        else fn++;
      } else if (actual === cat) {
        fp++;
      }
    }
    if (support === 0 && tp + fp === 0) continue;
    const precision = tp + fp === 0 ? null : tp / (tp + fp);
    const recall = tp + fn === 0 ? null : tp / (tp + fn);
    console.log(
      cat.padEnd(18) +
        (precision === null ? "n/a" : `${(precision * 100).toFixed(0)}%`).padStart(12) +
        (recall === null ? "n/a" : `${(recall * 100).toFixed(0)}%`).padStart(10) +
        `  ${support}`
    );
  }

  console.log("\nConfusion matrix (rows = expected, cols = predicted; only non-zero cells shown):");
  for (const [expected, row] of confusion) {
    if (row.size === 0) continue;
    const cells = Array.from(row.entries())
      .map(([actual, count]) => (actual === expected ? `${actual}: ${count} ✓` : `${actual}: ${count} ✗`))
      .join(", ");
    console.log(`  ${expected.padEnd(18)} -> ${cells}`);
  }

  if (unexpectedFailures.length > 0) {
    exitCode = 1;
    console.log(`\n❌ REGRESSIONS — cases not marked as known limitations but failing (${unexpectedFailures.length}):`);
    for (const f of unexpectedFailures) {
      console.log(`   "${f.description}" — expected ${f.expected}, got ${f.actual}`);
    }
  }

  if (unexpectedPasses.length > 0) {
    console.log(`\n✨ Cases marked knownLimitation but now passing (${unexpectedPasses.length}) — consider removing the flag:`);
    for (const p of unexpectedPasses) {
      console.log(`   "${p.description}" (${p.note ?? ""})`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Anomaly detection precision / recall
// ---------------------------------------------------------------------------

function anomalyKey(tx: RawTransaction): string {
  return `${tx.date}|${tx.description}|${tx.amount}`;
}

function scoreAnomalyCase(c: (typeof GOLDEN_ANOMALY_CASES)[number]) {
  const categorized = categorizeTransactions(c.statement);
  const flagged = detectAnomalies(categorized);

  const expectedByKey = new Map<string, AnomalyReason[]>();
  for (const [indexStr, reasons] of Object.entries(c.expected)) {
    expectedByKey.set(anomalyKey(c.statement[Number(indexStr)]), reasons);
  }

  const flaggedByKey = new Map<string, Anomaly[]>();
  for (const a of flagged) {
    const key = anomalyKey(a.transaction);
    const list = flaggedByKey.get(key) ?? [];
    list.push(a);
    flaggedByKey.set(key, list);
  }

  let tp = 0, fp = 0, fn = 0;
  const falsePositives: string[] = [];
  const falseNegatives: string[] = [];

  for (const [key, anomalies] of flaggedByKey) {
    const expectedReasons = expectedByKey.get(key);
    for (const a of anomalies) {
      if (expectedReasons && expectedReasons.includes(a.reason)) {
        tp++;
      } else {
        fp++;
        falsePositives.push(`[${c.name}] "${a.transaction.description}" flagged as ${a.reason} — not expected`);
      }
    }
  }

  for (const [key, reasons] of expectedByKey) {
    const flaggedReasons = new Set((flaggedByKey.get(key) ?? []).map((a) => a.reason));
    for (const reason of reasons) {
      if (!flaggedReasons.has(reason)) {
        fn++;
        const tx = c.statement.find((t) => anomalyKey(t) === key)!;
        falseNegatives.push(`[${c.name}] "${tx.description}" expected ${reason} — not flagged`);
      }
    }
  }

  return { tp, fp, fn, falsePositives, falseNegatives };
}

function runAnomalyEval() {
  section("Anomaly detection eval");

  const regularCases = GOLDEN_ANOMALY_CASES.filter((c) => !c.knownLimitation);
  const knownLimitationCases = GOLDEN_ANOMALY_CASES.filter((c) => c.knownLimitation);

  let tp = 0, fp = 0, fn = 0;
  const falsePositiveDetails: string[] = [];
  const falseNegativeDetails: string[] = [];
  for (const c of regularCases) {
    const result = scoreAnomalyCase(c);
    tp += result.tp;
    fp += result.fp;
    fn += result.fn;
    falsePositiveDetails.push(...result.falsePositives);
    falseNegativeDetails.push(...result.falseNegatives);
  }

  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  console.log(`True positives: ${tp}, False positives: ${fp}, False negatives: ${fn}`);
  console.log(`Precision: ${precision === null ? "n/a" : pct(tp, tp + fp)} (false-positive rate matters most per the PRD)`);
  console.log(`Recall: ${recall === null ? "n/a" : pct(tp, tp + fn)}`);

  if (falsePositiveDetails.length > 0) {
    exitCode = 1;
    console.log(`\n❌ REGRESSIONS — false positives (${falsePositiveDetails.length}):`);
    falsePositiveDetails.forEach((d) => console.log(`   ${d}`));
  }
  if (falseNegativeDetails.length > 0) {
    exitCode = 1;
    console.log(`\n❌ REGRESSIONS — false negatives (${falseNegativeDetails.length}):`);
    falseNegativeDetails.forEach((d) => console.log(`   ${d}`));
  }
  if (falsePositiveDetails.length === 0 && falseNegativeDetails.length === 0) {
    console.log("\n✅ Every non-limitation golden anomaly case matched exactly.");
  }

  if (knownLimitationCases.length > 0) {
    console.log(`\nKnown limitations (${knownLimitationCases.length}, not counted above):`);
    for (const c of knownLimitationCases) {
      const result = scoreAnomalyCase(c);
      const stillFails = result.fp > 0 || result.fn > 0;
      if (stillFails) {
        console.log(`  ⚠️  "${c.name}" — still reproduces (${c.note ?? ""})`);
      } else {
        console.log(`  ✨ "${c.name}" — now passing, consider removing the knownLimitation flag (${c.note ?? ""})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing: currency/format handling
// ---------------------------------------------------------------------------

function runParsingEval() {
  section("Statement parsing eval");

  let regularPassed = 0;
  let regularTotal = 0;
  const regressions: string[] = [];
  const knownLimitationResults: string[] = [];

  for (const c of GOLDEN_PARSING_CASES) {
    const actual = parseStatementCsv(c.csv);
    const matches = JSON.stringify(actual) === JSON.stringify(c.expected);

    if (!c.knownLimitation) {
      regularTotal++;
      if (matches) regularPassed++;
      else regressions.push(`"${c.name}" — expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(actual)}`);
    } else if (matches) {
      knownLimitationResults.push(`✨ "${c.name}" — now passing, consider removing the knownLimitation flag (${c.note ?? ""})`);
    } else {
      knownLimitationResults.push(`⚠️  "${c.name}" — still reproduces: got ${JSON.stringify(actual)} (${c.note ?? ""})`);
    }
  }

  console.log(`Non-limitation cases: ${regularPassed}/${regularTotal} (${pct(regularPassed, regularTotal)})`);
  if (regressions.length > 0) {
    exitCode = 1;
    console.log(`\n❌ REGRESSIONS (${regressions.length}):`);
    regressions.forEach((d) => console.log(`   ${d}`));
  }
  if (knownLimitationResults.length > 0) {
    console.log(`\nKnown limitations (${knownLimitationResults.length}, not counted above):`);
    knownLimitationResults.forEach((d) => console.log(`  ${d}`));
  }
}

// ---------------------------------------------------------------------------
// 3. Consistency / robustness checks
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function runConsistencyChecks() {
  section("Consistency & robustness checks");
  let passed = 0;
  let failed = 0;

  function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
      passed++;
    } else {
      failed++;
      exitCode = 1;
      console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    }
  }

  // Determinism: same input twice -> identical output.
  for (const c of GOLDEN_ANOMALY_CASES) {
    const categorized = categorizeTransactions(c.statement);
    const run1 = JSON.stringify(detectAnomalies(categorized));
    const run2 = JSON.stringify(detectAnomalies(categorized));
    check(`determinism: "${c.name}"`, run1 === run2);
  }

  // Order invariance: shuffling transaction order shouldn't change which
  // transactions get flagged or why (only the detection order might differ).
  for (const c of GOLDEN_ANOMALY_CASES) {
    if (c.statement.length < 2) continue;
    const original = categorizeTransactions(c.statement);
    const shuffled = categorizeTransactions(shuffle(c.statement, 42));

    const toSet = (txs: typeof original) =>
      new Set(detectAnomalies(txs).map((a) => `${anomalyKey(a.transaction)}|${a.reason}`));

    const originalSet = toSet(original);
    const shuffledSet = toSet(shuffled);
    const same =
      originalSet.size === shuffledSet.size && Array.from(originalSet).every((k) => shuffledSet.has(k));
    check(`order-invariance: "${c.name}"`, same, same ? undefined : "flagged set changed when input order was shuffled");
  }

  // Categorization robustness: case and whitespace variants of a sample of
  // golden descriptions should categorize identically to the original.
  const sample = GOLDEN_CATEGORIZATION_CASES.filter((c) => !c.knownLimitation).slice(0, 15);
  for (const c of sample) {
    const original = categorizeTransaction(c.description);
    const lower = categorizeTransaction(c.description.toLowerCase());
    const upper = categorizeTransaction(c.description.toUpperCase());
    const padded = categorizeTransaction(`   ${c.description.replace(/\s+/g, "   ")}   `);

    check(`case-insensitivity: "${c.description}" (lowercase)`, lower === original);
    check(`case-insensitivity: "${c.description}" (uppercase)`, upper === original);
    check(`whitespace robustness: "${c.description}"`, padded === original);

    // Descriptor noise a real statement export commonly adds: an order/
    // reference ID tacked on the end, or punctuation swapped for spaces
    // (e.g. "SWIGGY*ORDER" -> "SWIGGY ORDER") — neither should change the
    // category.
    const withOrderId = categorizeTransaction(`${c.description} REF${Math.abs(c.description.length * 7919) % 100000}`);
    const punctuationNormalized = categorizeTransaction(c.description.replace(/[*./#-]/g, " "));
    check(`order-id suffix robustness: "${c.description}"`, withOrderId === original);
    check(`punctuation robustness: "${c.description}"`, punctuationNormalized === original);
  }

  // Processor-prefix invariance: a payment processor routing a charge is
  // not the merchant (per the brand/parent-company golden-set spec) — the
  // same real merchant reached via different processors must normalize to
  // the same merchant key, or recurring-charge/duplicate/new-merchant
  // detection breaks whenever the processor happens to change between
  // statements.
  const processorCases = [
    { bare: "SWIGGY ORDER", prefixed: "RAZORPAY SWIGGY ORDER" },
    { bare: "AMAZON PURCHASE", prefixed: "PHONEPE AMAZON PURCHASE" },
    { bare: "NETFLIX SUBSCRIPTION", prefixed: "PAYTM NETFLIX SUBSCRIPTION" },
    { bare: "ZOMATO ORDER", prefixed: "CASHFREE ZOMATO ORDER" },
  ];
  for (const { bare, prefixed } of processorCases) {
    const bareKey = normalizeMerchant(bare);
    const prefixedKey = normalizeMerchant(prefixed);
    check(
      `processor-prefix invariance: "${prefixed}"`,
      bareKey === prefixedKey,
      bareKey === prefixedKey ? undefined : `"${bare}" -> "${bareKey}", "${prefixed}" -> "${prefixedKey}"`
    );
  }

  console.log(`\n${passed} checks passed, ${failed} failed`);
}

// ---------------------------------------------------------------------------

runCategorizationEval();
runAnomalyEval();
runParsingEval();
runConsistencyChecks();

section("Summary");
if (exitCode === 0) {
  console.log("✅ No regressions, no unexpected false positives/negatives, all consistency checks passed.");
} else {
  console.log("❌ Eval surfaced issues — see sections above.");
}

process.exit(exitCode);
