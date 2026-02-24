import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Authority Distribution Engine",
  description: "Sprint 1 workspace for SRT ingestion and processing status"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
