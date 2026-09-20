/**
 * Golden set for the rule-based categorizer: real-ish transaction
 * narrations, each labeled with the category a human would assign.
 *
 * This is deliberately NOT the same thing as the unit tests in
 * test-spend-analyzer.ts. Those tests lock in specific behavior of the
 * code as written (e.g. "this exact keyword list categorizes SWIGGY as
 * Dining") — they should never fail unless you change the code on
 * purpose. This golden set instead asks "does the categorizer match what
 * a human would actually label?", against realistic and occasionally
 * adversarial narrations. It's expected to have some failures — that's
 * the whole point of running it: it tells you where the rule-based
 * approach's blind spots are, which the PRD flags as inherent to
 * keyword matching (vs. an LLM-based approach).
 *
 * `knownLimitation` cases are ones we already know the current keyword
 * rules get wrong (documented, not silently skipped) — run-eval.ts
 * reports them in a separate bucket so a real regression (a case that
 * used to pass and now doesn't) isn't buried in a pile of expected
 * failures.
 */
import type { Category } from "../types";

export interface CategorizationCase {
  description: string;
  expected: Category;
  /** Why this case is here — what makes it realistic or tricky. */
  note?: string;
  /** True if the current rule-based categorizer is known to mislabel this one. */
  knownLimitation?: boolean;
}

export const GOLDEN_CATEGORIZATION_CASES: CategorizationCase[] = [
  // --- Groceries ---
  { description: "BIGBASKET ONLINE ORDER 44521", expected: "Groceries" },
  { description: "DMART AVENUE SUPERMARKET", expected: "Groceries" },
  { description: "BLINKIT INSTANT GROCERY", expected: "Groceries" },
  { description: "RELIANCE FRESH STORE #12", expected: "Groceries" },
  { description: "ZEPTO 10 MIN DELIVERY", expected: "Groceries" },
  { description: "MORE SUPERMARKET PVT LTD", expected: "Groceries", note: "matches the 'supermarket' keyword even without a brand-specific one" },
  {
    description: "SWIGGY*INSTAMART BLR 48291",
    expected: "Groceries",
    note: "quick-commerce sub-brand of Swiggy — Groceries is checked before Dining, so 'instamart' wins over the generic 'swiggy' keyword",
  },
  {
    description: "ZOMATO*BLINKIT",
    expected: "Groceries",
    note: "quick-commerce sub-brand of Zomato/Eternal — same precedence fix as Instamart above",
  },
  { description: "JIOMART GROCERY ORDER", expected: "Groceries" },

  // --- Dining ---
  { description: "SWIGGY*ORDER 88213 BANGALORE", expected: "Dining" },
  { description: "ZOMATO ONLINE ORDER", expected: "Dining" },
  { description: "STARBUCKS COFFEE MG ROAD", expected: "Dining" },
  { description: "DOMINOS PIZZA INDIA", expected: "Dining" },
  { description: "THE COFFEE BEAN CAFE", expected: "Dining" },
  { description: "MCDONALD'S DRIVE THRU", expected: "Dining" },
  { description: "BARBEQUE NATION RESTAURANT", expected: "Dining" },
  { description: "KFC BANGALORE", expected: "Dining" },
  { description: "PIZZA HUT DELIVERY", expected: "Dining" },
  { description: "BURGER KING DRIVE THRU", expected: "Dining" },
  { description: "WOW MOMO EXPRESS", expected: "Dining" },

  // --- Subscriptions ---
  { description: "NETFLIX.COM SUBSCRIPTION", expected: "Subscriptions" },
  { description: "SPOTIFY PREMIUM MONTHLY", expected: "Subscriptions" },
  { description: "HOTSTAR VIP ANNUAL", expected: "Subscriptions" },
  { description: "AMAZON PRIME MEMBERSHIP", expected: "Subscriptions" },
  { description: "GOLD'S GYM MEMBERSHIP FEE", expected: "Subscriptions" },
  { description: "YOUTUBE PREMIUM RENEWAL", expected: "Subscriptions" },
  { description: "APPLE.COM/BILL ICLOUD+", expected: "Subscriptions" },
  { description: "DISNEY+ HOTSTAR", expected: "Subscriptions", note: "keyword is a substring, catches this variant too" },
  {
    description: "DISNEY+ MOVIE NIGHT",
    expected: "Subscriptions",
    note: "regression check: a keyword ending in a symbol ('disney+') must still match when followed by a space, not just when glued to the next word",
  },
  { description: "GOOGLE ONE STORAGE", expected: "Subscriptions" },
  { description: "CANVA PRO ANNUAL", expected: "Subscriptions" },

  // --- Utilities ---
  { description: "BESCOM ELECTRICITY BILL PAYMENT", expected: "Utilities" },
  { description: "AIRTEL POSTPAID MOBILE BILL", expected: "Utilities" },
  { description: "JIO FIBER BROADBAND RECHARGE", expected: "Utilities" },
  { description: "TATA SKY DTH RECHARGE", expected: "Utilities" },
  { description: "BWSSB WATER BILL", expected: "Utilities" },
  { description: "INDANE GAS BILL CYLINDER", expected: "Utilities" },
  { description: "VODAFONE IDEA VI BILL", expected: "Utilities" },

  // --- Rent/EMI ---
  { description: "RENT PAYMENT TO LANDLORD", expected: "Rent/EMI" },
  { description: "HOME LOAN EMI HDFC BANK", expected: "Rent/EMI" },
  { description: "BAJAJ FINANCE EMI DEDUCTION", expected: "Rent/EMI" },
  { description: "MONTHLY RENT - FLAT 4B", expected: "Rent/EMI" },
  { description: "AUTO LOAN EMI PAYMENT", expected: "Rent/EMI" },

  // --- Shopping ---
  { description: "AMAZON.IN PURCHASE", expected: "Shopping" },
  { description: "FLIPKART ONLINE SHOPPING", expected: "Shopping" },
  { description: "MYNTRA FASHION ORDER", expected: "Shopping" },
  {
    description: "AJIO CLOTHING PURCHASE",
    expected: "Shopping",
    note: "regression check: word-boundary matching must not let 'jio' (a Utilities keyword) match inside 'ajio'",
  },
  { description: "NYKAA BEAUTY PRODUCTS", expected: "Shopping" },
  { description: "PHOENIX MARKETCITY MALL", expected: "Shopping" },
  { description: "H&M RETAIL STORE", expected: "Shopping", note: "matches the generic 'store' keyword even without a brand-specific one" },

  // --- Transport ---
  { description: "UBER TRIP BANGALORE", expected: "Transport" },
  { description: "OLA CABS RIDE", expected: "Transport" },
  { description: "INDIAN OIL PETROL PUMP", expected: "Transport" },
  { description: "IRCTC TRAIN TICKET BOOKING", expected: "Transport" },
  { description: "FASTAG RECHARGE NHAI", expected: "Transport" },
  { description: "NAMMA METRO CARD RECHARGE", expected: "Transport" },
  { description: "RAPIDO BIKE TAXI", expected: "Transport" },
  { description: "AIRPORT PARKING FEE", expected: "Transport" },
  { description: "MAKEMYTRIP FLIGHT BOOKING", expected: "Transport" },
  { description: "GOIBIBO HOTEL BOOKING", expected: "Transport" },
  { description: "REDBUS TICKET", expected: "Transport" },
  { description: "OYO ROOMS BOOKING", expected: "Transport", note: "hotel booking, grouped under Transport/travel — no dedicated Travel category exists yet" },
  { description: "INDIGO AIRLINES 6E-123", expected: "Transport" },

  // --- Health ---
  { description: "APOLLO PHARMACY MEDICINES", expected: "Health" },
  { description: "FORTIS HOSPITAL CONSULTATION", expected: "Health" },
  { description: "DR LAL PATHLABS DIAGNOSTIC", expected: "Health" },
  { description: "MEDPLUS PHARMACY STORE", expected: "Health" },
  { description: "MANIPAL HOSPITALS BILLING", expected: "Health" },
  { description: "PRACTO DOCTOR CONSULTATION", expected: "Health", note: "keyword 'doctor' present in platform name" },
  { description: "NETMEDS PHARMACY ORDER", expected: "Health" },
  { description: "TATA 1MG MEDICINES", expected: "Health", note: "regression check: word-boundary matching must not let '1mg' match inside a dosage like '500mg'" },

  // --- Transfers ---
  { description: "NEFT TRANSFER TO A/C 1234", expected: "Transfers" },
  { description: "IMPS FUND TRANSFER", expected: "Transfers" },
  { description: "UPI/P2P/SENT TO RAHUL", expected: "Transfers" },
  {
    description: "RTGS OUTWARD REMITTANCE",
    expected: "Transfers",
    note: "regression check: word-boundary matching must not let 'emi' (a Rent/EMI keyword) match inside 'remittance'",
  },

  // --- Cash Withdrawal ---
  { description: "ATM WDL CASH SBI", expected: "Cash Withdrawal" },
  { description: "CASH WITHDRAWAL HDFC ATM", expected: "Cash Withdrawal" },
  { description: "NWD ATM CWDR TRANSACTION", expected: "Cash Withdrawal" },

  // --- Uncategorized (deliberately no keyword should match) ---
  { description: "MISC PAYMENT REF 88213", expected: "Uncategorized" },
  { description: "CHEQUE NO 445521 CLEARED", expected: "Uncategorized" },
  { description: "SERVICE CHARGE GST", expected: "Uncategorized" },

  // --- Adversarial / ambiguous cases (known current limitations) ---
  {
    description: "SWIGGY GENIE PICKUP DELIVERY",
    expected: "Transport",
    note: "Swiggy Genie is a courier/pickup service, not food — but the 'swiggy' keyword routes it to Dining",
    knownLimitation: true,
  },
  {
    description: "AMAZON PAY ELECTRICITY BILL",
    expected: "Utilities",
    note: "paid via Amazon Pay, but the underlying spend is a utility bill — 'electricity' (Utilities) is checked before 'amazon' (Shopping) in the rule order, so this already resolves correctly",
  },
  {
    description: "BOOKMYSHOW MOVIE TICKET",
    expected: "Shopping",
    note: "no keyword covers entertainment/ticketing merchants at all",
    knownLimitation: true,
  },
  {
    description: "LIC PREMIUM PAYMENT",
    expected: "Uncategorized",
    note: "insurance premiums have no dedicated category or keyword — correctly falls through to Uncategorized. Also a regression check: word-boundary matching must not let 'emi' (a Rent/EMI keyword) match inside 'premium'",
  },
  {
    description: "PVR CINEMAS BOOKING",
    expected: "Dining",
    note: "arguable which bucket a cinema belongs in; picked Dining/entertainment adjacency as the 'human' label — no keyword matches at all",
    knownLimitation: true,
  },

  // --- Brand vs. settling-entity mismatch ---
  // The statement narration is often the legal entity that settled the
  // charge, not the storefront brand the cardholder recognizes. Zara and
  // Westside in India are both operated by Trent Ltd (a Tata/Inditex JV),
  // so a real statement line may say "TRENT LTD" and never mention "Zara"
  // at all. Fixed by adding "zara"/"trent"/"westside" as Shopping keywords
  // — these three are regression guards for that fix, not a general
  // solution: the long-tail brand-to-entity lookup problem (Lifestyle ->
  // "Landmark Group", Pantaloons -> "Aditya Birla Fashion", ...) is exactly
  // the kind of thing an LLM-based categorizer (PRD §4) handles better than
  // a keyword list ever will.
  {
    description: "ZARA",
    expected: "Shopping",
    note: "bare brand name with no other context",
  },
  {
    description: "TRENT LTD",
    expected: "Shopping",
    note: "Zara's Indian settling entity — the narration never says 'Zara' at all",
  },
  {
    description: "WESTSIDE BANGALORE",
    expected: "Shopping",
    note: "another Trent-owned brand with the same brand/entity mismatch",
  },
  { description: "ZUDIO FASHION STORE", expected: "Shopping", note: "also Trent-owned, budget fashion sub-brand" },
  { description: "PANTALOONS FASHION", expected: "Shopping", note: "operated by Aditya Birla Fashion & Retail" },
  { description: "LIFESTYLE STORES", expected: "Shopping", note: "operated by Landmark Group" },
  { description: "SHOPPERS STOP MUMBAI", expected: "Shopping" },
  { description: "LOUIS PHILIPPE FORMAL WEAR", expected: "Shopping", note: "operated by Aditya Birla's Madura Fashion" },
  { description: "VAN HEUSEN INDIA", expected: "Shopping" },
  { description: "ALLEN SOLLY OUTLET", expected: "Shopping" },
  { description: "PETER ENGLAND STORE", expected: "Shopping" },
  { description: "US POLO ASSN STORE", expected: "Shopping", note: "operated by Arvind Fashions" },
  { description: "RAYMOND THE COMPLETE MAN", expected: "Shopping" },
  { description: "MANYAVAR ETHNIC WEAR", expected: "Shopping", note: "operated by Vedant Fashions" },
  { description: "TANISHQ JEWELLERS", expected: "Shopping", note: "operated by Titan Company — jewellery has no dedicated category" },
  { description: "CARATLANE ONLINE", expected: "Shopping", note: "also operated by Titan Company" },
  { description: "TITAN WATCHES", expected: "Shopping" },
  { description: "FASTRACK ACCESSORIES", expected: "Shopping", note: "also a Titan Company brand" },
  { description: "MEESHO ORDER 55123", expected: "Shopping" },
  { description: "TATANEU", expected: "Shopping", note: "operated by Tata Digital; also matches the two-word 'tata neu' variant" },
  { description: "FIRSTCRY BABY PRODUCTS", expected: "Shopping" },
  { description: "RELIANCE DIGITAL ELECTRONICS", expected: "Shopping" },
  { description: "CROMA ELECTRONICS STORE", expected: "Shopping" },
  { description: "SAMSUNG SMARTPHONE PURCHASE", expected: "Shopping" },
  { description: "XIAOMI INDIA STORE", expected: "Shopping" },
  { description: "BOAT LIFESTYLE EARBUDS", expected: "Shopping" },
];
