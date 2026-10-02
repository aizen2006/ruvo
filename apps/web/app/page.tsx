import type { FieldSpec } from "@repo/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DotField } from "@/components/dot-field";
import { CollectingBand } from "@/components/landing/collecting-band";
import { ListExample } from "@/components/landing/list-example";
import { ColumnChips } from "@/components/plan/column-chips";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REPO = "https://github.com/aizen2006/ruvo";
const DESCRIPTION = "Ask for a list in plain words. RUVO collects it from public sources and shows where every value came from, with the words it was read from.";

export const metadata: Metadata = {
  title: "RUVO | Ask for a list, get it back with receipts",
  description: DESCRIPTION,
  openGraph: { title: "RUVO", description: DESCRIPTION, type: "website", siteName: "RUVO" },
  twitter: { card: "summary", title: "RUVO", description: DESCRIPTION },
};

const REQUEST = "Backend and AI engineering jobs at good tech companies, preferably remote. Company, title, location, salary if they list one, and the link.";

const column = (name: string, catalogKey: FieldSpec["catalogKey"], required: boolean): FieldSpec => ({ name, catalogKey, type: "string", required, description: "" });
const COLUMNS = [
  column("company", "company", true),
  column("title", "title", true),
  column("location", "location", true),
  column("remote", "remote", false),
  column("salary", "salary", false),
  column("url", "url", true),
];

const MODES = [
  { label: "Quick", time: "up to 2 minutes" },
  { label: "Balanced", time: "up to 4 minutes", chosen: true },
  { label: "Thorough", time: "up to 8 minutes" },
];

const LIMITS = [
  "It reads what's public. It doesn't log in, click through pages or scroll.",
  "Instagram, X and LinkedIn forbid crawlers, so profiles come from search results only, and say so.",
  "When a site's robots.txt says no, RUVO stops there.",
  "Jobs are what it knows best. For other lists it needs a Firecrawl key to search the web, or pages you link.",
  "The AI that judges borderline rows can be wrong. That is why every value shows its source.",
];

const frame = "mx-auto w-full max-w-[1200px] px-4 sm:px-6";

/** A step's number in dot-matrix, its heading and what happens. The number is the list's own marker. */
function StepText({ n, title, id, children, className, muted = "text-graphite" }: { n: number; title: string; id?: string; children: ReactNode; className?: string; muted?: string }) {
  return (
    <div className={cn("max-w-md space-y-item", className)}>
      <span aria-hidden className="block font-dot text-title font-black">
        {n}
      </span>
      <h3 id={id} className="text-[1.75rem] leading-[2.125rem] font-semibold">
        {title}
      </h3>
      <div className={cn("space-y-item", muted)}>{children}</div>
    </div>
  );
}

/** One step beside what you would see; `wide` puts the example underneath at full width. */
function Step({ n, title, children, example, wide }: { n: number; title: string; children: ReactNode; example: ReactNode; wide?: boolean }) {
  return (
    <li className={frame}>
      <div className={cn("grid gap-group py-section", wide ? "gap-stack" : "border-t border-hairline-strong md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-section")}>
        <StepText n={n} title={title} className={cn(wide && "max-w-2xl")}>
          {children}
        </StepText>
        <div className="min-w-0">{example}</div>
      </div>
    </li>
  );
}

function RequestExample() {
  return (
    <div className="rounded-panel border border-hairline-strong bg-sheet">
      <p className="px-group pt-group pb-stack text-heading">{REQUEST}</p>
      <ul aria-label="How thorough" className="grid grid-cols-3 gap-tight border-t border-hairline p-tight">
        {MODES.map((m) => (
          <li key={m.label} className={cn("rounded-control px-3 py-2", m.chosen ? "bg-highlighter" : "bg-canvas")}>
            <span className="block text-small font-semibold">
              {m.label}
              {m.chosen && <span className="sr-only"> (chosen)</span>}
            </span>
            <span className={cn("block text-micro", m.chosen ? "text-ink" : "text-graphite")}>{m.time}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanExample() {
  return (
    <dl className="space-y-group rounded-panel border border-hairline bg-sheet p-group">
      <div className="space-y-tight">
        <dt className="text-small font-semibold">Columns</dt>
        <dd className="space-y-tight">
          <ColumnChips fields={COLUMNS} />
          <p className="text-micro text-graphite">Solid is must have: rows without it are set aside. Dashed is nice to have.</p>
        </dd>
      </div>
      <div className="space-y-tight">
        <dt className="text-small font-semibold">How RUVO read your words</dt>
        <dd className="space-y-1 text-small">
          <p>
            <q>good tech companies</q> means companies known for AI or developer tools.
          </p>
          <p>
            <q>preferably remote</q> means remote is nice to have, not a must.
          </p>
        </dd>
      </div>
      <div className="space-y-tight">
        <dt className="text-small font-semibold">Where it will look</dt>
        <dd className="text-small">The job boards of well-known tech companies on Greenhouse, Ashby, Lever and Workable, the Hacker News hiring thread, and a web search for boards you didn&apos;t name.</dd>
      </div>
    </dl>
  );
}

/** The landing page: the noise-to-rows idea as a live field, then the product in its own words. */
export default function Landing() {
  return (
    <div data-bleed>
      <section aria-labelledby="hero-heading" className="relative flex min-h-[calc(100svh-3.5rem)] flex-col justify-end overflow-hidden">
        {/* The loud moment: the field at full strength, bleeding off the right (above the words on phones), clear behind the text. */}
        <DotField intensity={1} interactive className="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_15%,transparent_50%)] md:[mask-image:linear-gradient(90deg,transparent_55%,black_85%)]" />
        <div className={cn(frame, "relative space-y-group pt-[40svh] pb-section")}>
          <h1 id="hero-heading" className="max-w-[16ch] font-dot text-[clamp(2.75rem,5.5vw,4.75rem)] leading-[0.95] font-black">
            Ask for a list. Get it back with receipts.
          </h1>
          <p className="max-w-[46ch] text-heading text-graphite">
            Say what you need in plain words. RUVO finds it on public job boards, websites and search results, then hands you a table where every value shows the page it
            came from and the words it was read from.
          </p>
          <div className="flex flex-wrap items-center gap-item">
            <Link href="/new" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Make a list
            </Link>
            <a href={REPO} className={buttonVariants({ variant: "secondary", size: "lg" })}>
              Read the code on GitHub
            </a>
          </div>
          <p className="hidden font-mono text-small text-graphite motion-reduce:hidden [@media(hover:hover)]:block">Move your pointer over the dots to read them into rows.</p>
        </div>
      </section>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading" className={cn(frame, "pt-section pb-stack text-title font-semibold")}>
          From one sentence to a list you can check
        </h2>
        <ol>
          <Step n={1} title="Say what you want a list of" example={<RequestExample />}>
            <p>Write it the way you would ask a colleague, and add a website if you know one. Choose how thorough it should be; each choice shows what it costs and how long it may take before you start.</p>
          </Step>
          <Step n={2} title="Check the plan before anything is collected" example={<PlanExample />}>
            <p>RUVO turns your words into columns and rules, says how it read anything vague, and lists where it will look. Change what&apos;s wrong, then start collecting.</p>
          </Step>
          <CollectingBand>
            <StepText n={3} id="collect-heading" title="Watch it collect" muted="text-sheet/80">
              <p>RUVO reads each site&apos;s own data feed first and the page itself second. It follows next-page links, keeps to robots.txt, and opens a stealth browser only when a site puts up a bot check.</p>
            </StepText>
          </CollectingBand>
          <Step n={4} title="Open the list. Every value has a receipt." example={<ListExample />} wide>
            <p>
              Click a row to see where each value came from and the exact words it was read from. A value RUVO can&apos;t find on the page is dropped, not guessed. Download the list
              as an Excel workbook with its receipts, or as a CSV.
            </p>
          </Step>
        </ol>
      </section>

      <section aria-label="Limits and setup" className={cn(frame, "grid gap-section border-t border-hairline-strong py-section md:grid-cols-2")}>
        <div className="space-y-group">
          <h2 className="text-title font-semibold">What it won&apos;t do</h2>
          <ul className="space-y-item">
            {LIMITS.map((limit) => (
              <li key={limit} className="flex gap-item">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 bg-ink" />
                {limit}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 space-y-group">
          <h2 className="text-title font-semibold">It runs on your machine</h2>
          <p>
            RUVO is open source. It runs on your computer with Docker and your own OpenAI key, so your requests and lists stay with you. There are no accounts: it is made for one
            person on one machine.
          </p>
          <pre className="overflow-x-auto rounded-panel bg-void p-group font-mono text-small leading-relaxed text-sheet">
            <code>{`git clone ${REPO} && cd ruvo
cp .env.example .env   # add your OpenAI key
docker compose -f docker-compose.prod.yml up -d --build`}</code>
          </pre>
          <p className="text-graphite">Then open localhost:3001 and make your first list.</p>
        </div>
      </section>

      <footer className={cn(frame, "flex flex-wrap items-center justify-between gap-item border-t border-hairline py-group text-small text-graphite")}>
        <p>RUVO makes lists from the open web, with receipts.</p>
        <nav aria-label="Footer" className="flex gap-group font-mono">
          <a href={REPO} className="hover:text-ink">
            Source on GitHub
          </a>
          <Link href="/datasets" className="hover:text-ink">
            Your datasets
          </Link>
        </nav>
      </footer>
    </div>
  );
}
