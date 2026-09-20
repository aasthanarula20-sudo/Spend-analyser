"use client";

import { useState } from "react";
import { analyzeStatementCsv, analyzeStatementText } from "@/lib/spend-analyzer/analyze";
import type { AnalysisResult, AnomalyReason } from "@/lib/spend-analyzer/types";

const ANOMALY_LABELS: Record<AnomalyReason, string> = {
  statistical_outlier: "Unusually large for this category",
  new_merchant_high_amount: "New merchant, high amount",
  recurring_charge_increase: "Recurring charge increased",
  duplicate_transaction: "Possible duplicate",
  high_cash_withdrawal: "Unusually large cash withdrawal",
};

const SAMPLE_CSV = `Date,Description,Amount
2024-01-02,SWIGGY ORDER 8213,-320
2024-01-06,BIG BAZAAR GROCERY,-1450
2024-01-10,NETFLIX.COM,-499
2024-01-14,UBER TRIP,-260
2024-01-18,ATM WDL CASH,-2000
2024-01-18,ATM WDL CASH,-2000
2024-01-22,ELECTRICITY BILL,-1800
2024-01-25,RENT PAYMENT,-25000
2024-01-28,AMAZON PURCHASE,-3200
2024-02-06,NETFLIX.COM,-799
2024-02-12,SWIGGY ORDER 9021,-6500
2024-02-20,BRAND NEW ELECTRONICS STORE,-45000
`;

const SAMPLE_PASTED_TEXT = `01/02/2024 SWIGGY ORDER 8213           320.00 Dr   118,680.00
06/02/2024 BIG BAZAAR GROCERY        1,450.00 Dr   117,230.00
10/02/2024 NETFLIX.COM                 499.00 Dr   116,731.00
18/02/2024 ATM WDL CASH               2,000.00 Dr   114,731.00
18/02/2024 ATM WDL CASH               2,000.00 Dr   112,731.00
25/02/2024 RENT PAYMENT              25,000.00 Dr    87,731.00
28/02/2024 SALARY CREDIT             50,000.00 Cr   137,731.00
`;

type Source = { kind: "csv"; text: string } | { kind: "text"; text: string };

export default function SpendAnalyzerPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  function runAnalysis(next: Source) {
    setError(null);
    try {
      const analyzed = next.kind === "csv" ? analyzeStatementCsv(next.text) : analyzeStatementText(next.text);
      setSource(next);
      setResult(analyzed);
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    }
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setLoading(true);
    setError(null);
    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".csv") || file.type === "text/csv") {
        const text = await file.text();
        runAnalysis({ kind: "csv", text });
      } else if (lowerName.endsWith(".pdf") || file.type === "application/pdf") {
        const { extractPdfText } = await import("@/lib/spend-analyzer/pdf");
        const text = await extractPdfText(file);
        if (!text.trim()) {
          throw new Error("Could not extract any text from this PDF — it may be a scanned/image-only statement.");
        }
        runAnalysis({ kind: "text", text });
      } else {
        throw new Error("Unsupported file type. Upload a .csv or .pdf statement, or paste statement text below.");
      }
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex-1 bg-slate-50 px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Smart Spend Analyzer</h1>
        <p className="text-sm text-slate-600 mb-8 max-w-2xl">
          Upload a bank/card statement — CSV or PDF — or paste statement text directly, to see spend by category and
          flagged anomalies. Everything runs in your browser; nothing is uploaded to a server or stored anywhere.
        </p>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6 mb-8">
          <label className="block mb-3">
            <span className="block text-sm font-medium text-slate-700 mb-1">Statement file (CSV or PDF)</span>
            <input
              type="file"
              accept=".csv,text/csv,.pdf,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
              className="block w-full text-sm text-slate-600 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-slate-900 file:text-white file:text-sm file:font-medium hover:file:bg-slate-800"
            />
          </label>
          {loading && <p className="text-xs text-slate-500 mb-2">Reading {fileName}…</p>}
          {!loading && fileName && source && <p className="text-xs text-slate-400 mb-2">Loaded: {fileName}</p>}
          <button
            type="button"
            onClick={() => {
              setFileName("sample-statement.csv");
              runAnalysis({ kind: "csv", text: SAMPLE_CSV });
            }}
            className="text-xs text-slate-500 underline hover:text-slate-700 mr-4"
          >
            Try a sample CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setFileName(null);
              setPastedText(SAMPLE_PASTED_TEXT);
              runAnalysis({ kind: "text", text: SAMPLE_PASTED_TEXT });
            }}
            className="text-xs text-slate-500 underline hover:text-slate-700"
          >
            Try sample pasted text
          </button>

          <div className="border-t border-slate-100 mt-4 pt-4">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">
                Or paste statement text (from a PDF, banking app, or anywhere else)
              </span>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                rows={4}
                placeholder="01/02/2024  SWIGGY ORDER  320.00 Dr  118,680.00"
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white text-slate-900 font-mono"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setFileName(null);
                runAnalysis({ kind: "text", text: pastedText });
              }}
              disabled={!pastedText.trim()}
              className="mt-2 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-1.5 text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-40"
            >
              Analyze pasted text
            </button>
          </div>

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
          <p className="text-xs text-slate-400 mt-3">
            CSV: expects a header row with Date + Description/Narration columns, and either an Amount column
            (negative = debit) or separate Debit/Credit columns. PDF and pasted text: each transaction line needs a
            date and an amount — a &quot;Dr&quot;/&quot;Cr&quot; marker on the amount helps distinguish spend from
            income. A scanned/image-only PDF has no extractable text and won&apos;t work.
          </p>
        </div>

        {result && (
          <>
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6 mb-8">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">Spend by category</h2>
                <span className="text-sm text-slate-500">
                  Total: ₹{result.totalSpend.toLocaleString("en-IN")} · {result.transactions.length} transactions
                </span>
              </div>
              <div className="space-y-2">
                {result.categorySummaries.map((s) => (
                  <div key={s.category} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-sm text-slate-700">{s.category}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div className="bg-slate-900 h-full rounded-full" style={{ width: `${Math.min(s.percentOfTotal, 100)}%` }} />
                    </div>
                    <span className="w-28 shrink-0 text-right text-sm text-slate-600">
                      ₹{s.total.toLocaleString("en-IN")} ({s.percentOfTotal.toFixed(0)}%)
                    </span>
                  </div>
                ))}
                {result.categorySummaries.length === 0 && (
                  <p className="text-sm text-slate-400">No debit transactions found in this statement.</p>
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">
                Flagged anomalies {result.anomalies.length > 0 && `(${result.anomalies.length})`}
              </h2>
              <p className="text-sm text-slate-500 mb-4">
                Transactions that look out of place compared to the rest of the statement.
              </p>
              {result.anomalies.length === 0 && (
                <p className="text-sm text-slate-400">No anomalies detected.</p>
              )}
              <div className="divide-y divide-slate-100">
                {result.anomalies.map((a, i) => (
                  <div key={i} className="py-3">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        {ANOMALY_LABELS[a.reason]}
                      </span>
                      <span className="text-sm text-slate-900 font-medium">{a.transaction.description}</span>
                      <span className="text-sm text-slate-500">
                        ₹{a.transaction.amount.toLocaleString("en-IN")} · {a.transaction.date}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{a.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
