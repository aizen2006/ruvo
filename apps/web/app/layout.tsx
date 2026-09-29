import type { Metadata } from "next";
import { Doto, Geist, Geist_Mono } from "next/font/google";
import { AmbientField } from "@/components/ambient-field";
import { Logo } from "@/components/logo";
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
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${doto.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen">
        <AmbientField />
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-sheet">
            Skip to content
          </a>
          <header className="border-b border-hairline bg-canvas">
            <nav aria-label="Main" className="mx-auto flex h-14 max-w-[1200px] items-center gap-group px-4 sm:px-6">
              <Logo />
              <NavLinks />
            </nav>
          </header>
          {/* A page marked data-bleed (the landing) lays out its own full-width bands. */}
          <main id="main" className="mx-auto max-w-[1200px] px-4 py-stack sm:px-6 sm:py-section has-[[data-bleed]]:max-w-none has-[[data-bleed]]:p-0 sm:has-[[data-bleed]]:p-0">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
