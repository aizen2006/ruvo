import type { Metadata } from "next";
import { Archivo, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
import { Providers } from "./providers";
import "./globals.css";

// One grotesque in two widths (the width axis gives the condensed display cut); mono only for quoted source text.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", axes: ["wdth"] });
const splineMono = Spline_Sans_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-spline-mono" });

export const metadata: Metadata = {
  title: "RUVO",
  description: "Describe the list you need. RUVO collects it from public sources and shows where every value came from.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${splineMono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-highlighter focus:px-3 focus:py-2 focus:font-bold focus:text-ink">
            Skip to content
          </a>
          <header className="on-ink bg-ink text-sheet">
            <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1280px] items-stretch gap-group px-4 sm:px-6">
              <Link href="/" className="flex items-center bg-highlighter px-3 font-display text-[2.25rem] leading-none font-black text-ink">
                ruvo
              </Link>
              <NavLinks />
            </nav>
          </header>
          <main id="main" className="mx-auto max-w-[1280px] px-4 py-stack sm:px-6 sm:pt-10 sm:pb-section">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
