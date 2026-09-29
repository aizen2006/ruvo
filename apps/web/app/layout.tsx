import type { Metadata } from "next";
import { Bricolage_Grotesque, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
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
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-sheet">
            Skip to content
          </a>
          <header className="border-b border-hairline">
            <nav aria-label="Main" className="mx-auto flex h-14 max-w-[1200px] items-center gap-group px-4 sm:px-6">
              <Link href="/" className="text-heading font-bold tracking-tight">
                ruvo
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
