import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ops Hub — Daily Console",
  description: "Founder-facing ops dashboard — read-only (Sprint 6, T-59).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
