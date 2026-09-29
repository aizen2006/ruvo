import type { Metadata } from "next";
import { Doto, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
import { Providers } from "./providers";
import "./globals.css";

// Doto's heavy cuts for the big moments (its ROND axis defaults to 0: square dots); Geist to read; Geist Mono to press and scan.
const doto = Doto({ subsets: ["latin"], weight: ["800", "900"], variable: "--font-doto" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "RUVO",
  description: "Describe the list you need. RUVO collects it from public sources and shows where every value came from.",
};

/** The wordmark's dot mark: scattered dots settling into a full row, the product in miniature. */
function DotMark() {
  const dots = [[1, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2], [3, 2]];
  return (
    <svg aria-hidden viewBox="0 0 15 11" className="h-[11px] w-[15px]">
      {dots.map(([x, y]) => (
        <rect key={`${x}${y}`} x={x! * 4} y={y! * 4} width="3" height="3" />
      ))}
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${doto.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-sheet">
            Skip to content
          </a>
          <header className="border-b border-hairline">
            <nav aria-label="Main" className="mx-auto flex h-14 max-w-[1200px] items-center gap-group px-4 sm:px-6">
              <Link href="/" className="flex items-center gap-2 text-body font-semibold">
                ruvo
                <DotMark />
              </Link>
              <NavLinks />
            </nav>
          </header>
          <main id="main" className="mx-auto max-w-[1200px] px-4 py-stack sm:px-6 sm:py-section">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
