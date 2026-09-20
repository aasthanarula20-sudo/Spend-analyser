/**
 * Golden set for statement parsing (csv.ts / text-parser.ts): each case is
 * a raw statement snippet plus the transactions a human reading it would
 * expect to get out. Unlike the categorization/anomaly golden sets, a
 * parsing failure here is silent and total — a mis-parsed row doesn't get
 * miscategorized, it just vanishes from the statement entirely, so these
 * cases exist to make that failure visible instead of invisible.
 */
import type { RawTransaction } from "../types";

export interface ParsingCase {
  name: string;
  csv: string;
  /** Transactions a human reading the raw statement would expect to see. */
  expected: RawTransaction[];
  note?: string;
  /** True if the current parser is known to get this case wrong (documented, not silently skipped). */
  knownLimitation?: boolean;
}

export const GOLDEN_PARSING_CASES: ParsingCase[] = [
  {
    name: "plain rupee amount (baseline, should already pass)",
    csv: "Date,Description,Amount\n2024-01-05,ZARA PARIS FR,-45.00\n",
    expected: [{ date: "2024-01-05", description: "ZARA PARIS FR", amount: 45 }],
  },

  // --- Foreign currency symbols ---
  // parseAmount() in csv.ts used to only strip ₹ and $ before parsing — any
  // other currency symbol or code left non-numeric characters in the
  // string, Number(...) returned NaN, and parseStatementCsv silently
  // dropped the row (the spend wasn't miscategorized, it just vanished —
  // worse than a wrong category, since the user has no idea an
  // international purchase went uncounted). Fixed by also stripping
  // €/£/¥ and any remaining letters (covering bare currency codes like
  // "USD"). These three are regression guards for that fix.
  {
    name: "Euro amount",
    csv: "Date,Description,Amount\n2024-01-05,ZARA PARIS FR,-€45.00\n",
    expected: [{ date: "2024-01-05", description: "ZARA PARIS FR", amount: 45 }],
  },
  {
    name: "Pound amount",
    csv: "Date,Description,Amount\n2024-01-06,MARKS AND SPENCER LONDON,-£32.50\n",
    expected: [{ date: "2024-01-06", description: "MARKS AND SPENCER LONDON", amount: 32.5 }],
  },
  {
    name: "currency-code prefix instead of a symbol",
    csv: "Date,Description,Amount\n2024-01-07,APPLE.COM/BILL,USD -0.99\n",
    expected: [{ date: "2024-01-07", description: "APPLE.COM/BILL", amount: 0.99 }],
  },
];
