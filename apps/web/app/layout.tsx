import type { Metadata } from "next";
import { Bricolage_Grotesque, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { Providers } from "./providers";
import "./globals.css";

// One variable grotesque for the interface; mono only for text quoted from source pages.
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", axes: ["opsz"] });
const splineMono = Spline_Sans_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-spline-mono" });

export const metadata: Metadata = {
  title: "RUVO",
  description: "Describe the list you need. RUVO collects it from public sources and shows where every value came from.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${splineMono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <header className="border-b border-hairline">
            <nav aria-label="Main" className="mx-auto flex h-14 max-w-[1200px] items-center gap-group px-4 sm:px-6">
              <Link href="/" className="text-heading font-bold tracking-tight">
                ruvo
              </Link>
              <div className="ml-auto flex items-center gap-item text-small">
                <Link href="/datasets" className="text-graphite hover:text-ink">
                  Your datasets
                </Link>
                <Link href="/" className="rounded-control border border-hairline-strong bg-sheet px-3 py-1.5 font-medium hover:border-ink">
                  New list
                </Link>
              </div>
            </nav>
          </header>
          <main className="mx-auto max-w-[1200px] px-4 py-stack sm:px-6 sm:py-section">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
