import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Newsreader } from "next/font/google";
import Link from "next/link";
import { Providers } from "./providers";
import "./globals.css";

const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", style: ["normal", "italic"] });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "RUVO",
  description: "Describe the data you need. RUVO collects it, checks it and shows where every value came from.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${newsreader.variable} ${plexMono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <header className="border-b border-rule bg-surface">
            <nav className="mx-auto flex max-w-7xl items-center gap-8 px-6 py-3">
              <Link href="/" className="font-serif text-xl tracking-tight">
                ruvo
              </Link>
              <Link href="/" className="text-sm text-muted hover:text-ink">
                New request
              </Link>
              <Link href="/runs" className="text-sm text-muted hover:text-ink">
                History
              </Link>
            </nav>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
