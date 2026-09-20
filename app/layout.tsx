import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Spend Analyzer",
  description: "Upload a bank/card statement and see spend by category and flagged anomalies — entirely in your browser.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
