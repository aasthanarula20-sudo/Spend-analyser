/**
 * Rule-based categorization: merchant/narration keyword matching.
 * Chosen over an LLM-based approach for P0 (per PRD §4) — deterministic,
 * free to run, and keeps statement text from ever leaving the browser.
 * Rules are checked in order; the first match wins.
 */
import type { Category, CategorizedTransaction, RawTransaction } from "./types";

const CATEGORY_KEYWORDS: Array<{ category: Category; keywords: string[] }> = [
  { category: "Cash Withdrawal", keywords: ["atm", "cash wdl", "cash withdrawal", "cwdr"] },
  {
    category: "Subscriptions",
    keywords: [
      "netflix", "spotify", "hotstar", "prime video", "amazon prime", "youtube premium",
      "apple music", "apple.com/bill", "icloud", "gym membership", "subscription",
      "disney+", "zomato gold", "swiggy one", "google one", "canva", "adobe", "chatgpt",
    ],
  },
  { category: "Rent/EMI", keywords: ["rent", "emi", "loan emi", "home loan", "landlord"] },
  {
    category: "Utilities",
    keywords: [
      "electricity", "power bill", "water bill", "gas bill", "broadband", "wifi bill",
      "mobile recharge", "mobile bill", "dth", "postpaid", "airtel", "jio", "vodafone", "vi bill",
    ],
  },
  {
    category: "Groceries",
    // Quick-commerce brands (instamart, blinkit, jiomart) are listed here
    // rather than under their parent's own keyword (Swiggy, Zomato/Eternal,
    // Reliance) — Groceries is checked before Dining/Shopping below, so the
    // specific sub-brand wins over the generic parent keyword.
    keywords: [
      "grocery", "supermarket", "bigbasket", "grofers", "blinkit", "dmart", "reliance fresh", "zepto",
      "instamart", "jiomart", "smart bazaar", "star bazaar",
    ],
  },
  {
    category: "Dining",
    keywords: [
      "restaurant", "swiggy", "zomato", "cafe", "coffee", "eatery", "food court", "dominos", "starbucks", "mcdonald",
      "kfc", "pizza hut", "burger king", "wow momo", "dunkin", "popeyes", "biryani",
    ],
  },
  {
    category: "Transport",
    keywords: [
      "uber", "ola", "rapido", "petrol", "fuel", "diesel", "metro", "irctc", "fastag", "parking", "cab",
      "makemytrip", "goibibo", "redbus", "easemytrip", "ixigo", "confirmtkt", "abhibus", "indigo", "air india", "oyo",
    ],
  },
  {
    category: "Health",
    keywords: [
      "pharmacy", "hospital", "clinic", "medical", "apollo", "diagnostic", "doctor", "healthcare",
      "netmeds", "pharmeasy", "1mg",
    ],
  },
  {
    category: "Shopping",
    // "trent" and "westside" cover the settling entity behind Zara/Westside
    // in India (a Tata/Inditex JV) — the statement narration is often the
    // legal entity, not the storefront brand. Same idea extended to other
    // brand/parent pairs below (Tanishq/Titan, Zudio/Trent, etc.) — see the
    // eval's golden-categorization.ts for the full brand -> parent mapping
    // this was sourced from.
    keywords: [
      "amazon", "flipkart", "myntra", "ajio", "mall", "store", "shopping", "nykaa", "zara", "trent", "westside",
      "meesho", "tataneu", "tata neu", "firstcry", "zudio",
      "pantaloons", "lifestyle", "shoppers stop", "louis philippe", "van heusen", "allen solly", "peter england",
      "us polo", "flying machine", "raymond", "manyavar", "tanishq", "caratlane", "titan", "fastrack",
      "reliance digital", "croma", "samsung", "xiaomi", "redmi", "oneplus", "vivo", "oppo", "boat", "noise",
    ],
  },
  {
    category: "Transfers",
    keywords: ["neft", "imps", "rtgs", "upi/", "upi-", "fund transfer", "sent to", "p2p"],
  },
];

// A payment processor routing a charge is not the merchant — "RAZORPAY*SWIGGY"
// and "SWIGGY ORDER" should resolve to the same merchant key, or the same
// real merchant looks like two different ones (a new-merchant false
// positive) whenever the processor happens to change between statements.
const KNOWN_PROCESSOR_PREFIXES = [
  "razorpay", "payu", "cashfree", "phonepe", "billdesk", "paytm", "stripe", "shopify", "ccavenue", "pine labs",
];

export function normalizeMerchant(description: string): string {
  const cleaned = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const processor of KNOWN_PROCESSOR_PREFIXES) {
    const prefixPattern = new RegExp(`^${escapeRegex(processor)}\\s+`);
    if (prefixPattern.test(cleaned)) {
      return cleaned.replace(prefixPattern, "").trim();
    }
  }
  return cleaned;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Boundary matching, precompiled once: a plain substring check would match
// "jio" inside "ajio" or "emi" inside "premium"/"remittance" — both real
// false-positives an eval against realistic narrations turned up. Uses an
// explicit alphanumeric lookaround rather than \b: \b is a transition
// between a word and non-word character, which is the wrong test for a
// keyword that itself ends in a symbol (e.g. "disney+") — \b there requires
// the *next* character to be alphanumeric, so "DISNEY+ HOTSTAR" (space
// after "+") would silently fail to match even though "DISNEY+HOTSTAR"
// would. The lookaround only cares whether the match is glued to more
// alphanumeric text on either side, which is consistent regardless of what
// character the keyword itself starts or ends with. A trailing optional "s"
// keeps simple plurals matching ("hospital" still matches "HOSPITALS") —
// only added for keywords that end alphanumerically, since appending it to
// a symbol-ending keyword wouldn't mean anything.
function buildKeywordPattern(keyword: string): RegExp {
  const endsAlphanumeric = /[a-z0-9]$/i.test(keyword);
  const trailing = endsAlphanumeric ? "s?(?![a-z0-9])" : "";
  return new RegExp(`(?<![a-z0-9])${escapeRegex(keyword)}${trailing}`, "i");
}

const COMPILED_CATEGORY_KEYWORDS: Array<{ category: Category; patterns: RegExp[] }> = CATEGORY_KEYWORDS.map(
  ({ category, keywords }) => ({
    category,
    patterns: keywords.map(buildKeywordPattern),
  })
);

export function categorizeTransaction(description: string): Category {
  // Collapse irregular whitespace (common in PDF-extracted text) before
  // matching multi-word keyword phrases like "home loan".
  const text = description.toLowerCase().replace(/\s+/g, " ");
  for (const { category, patterns } of COMPILED_CATEGORY_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(text))) {
      return category;
    }
  }
  return "Uncategorized";
}

export function categorizeTransactions(transactions: RawTransaction[]): CategorizedTransaction[] {
  return transactions.map((tx) => ({
    ...tx,
    category: categorizeTransaction(tx.description),
    merchantKey: normalizeMerchant(tx.description),
  }));
}
