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
const DESCRIPTION =
  "Ask for a list in plain words. RUVO searches the web, reads every public source it can, and hands back the best leads first, each value with the words it was read from.";

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

/** Lines RUVO never crosses: each reads as "It won't …", then why. */
const WONT = [
  { line: "Log in, click through pages or scroll.", why: "It reads what's public." },
  { line: "Open Instagram, X or LinkedIn.", why: "They forbid crawlers, so profiles come from search results only, and say so." },
  { line: "Go where robots.txt says no.", why: "Not even where its stealth browser could get in." },
  { line: "Reach into your own network.", why: "A guard checks every page RUVO opens and refuses private addresses." },
  { line: "Read a page blocked for legal reasons.", why: "An HTTP 451 stops that source." },
  { line: "Guess a value.", why: "Anything it can't find on the page is dropped." },
];

/** Honest caveats, separate from the lines it never crosses. */
const GOOD_TO_KNOW = [
  "Its stealth browser gets past bot checks, which can break a site's terms. Receipts mark every page read that way.",
  "Signing in with ChatGPT goes through openai-oauth, which is unofficial: it could stop working, and a ChatGPT plan has usage limits.",
  "Jobs are what it knows best. Other lists come from web search and pages you link, so they're only as good as what the search finds.",
  "The AI that judges borderline rows can be wrong. That's why every value shows its source.",
];

/** What RUVO is built on, for the "What's inside" strip under the hero. */
const INSIDE = [
  {
    title: "Scrapling gets the page",
    body: "Every page is fetched by Scrapling: a plain request with Chrome's fingerprint, a real browser for pages built in JavaScript, and a stealth browser that gets past Cloudflare checks.",
    link: { href: "https://github.com/D4Vinci/Scrapling", label: "Scrapling on GitHub" },
  },
  {
    title: "Free AI with your ChatGPT plan",
    body: "Sign in with ChatGPT in Settings and RUVO's AI calls run on your plan through openai-oauth, at no extra cost. Prefer an OpenAI API key? Add one and it is used instead.",
    link: { href: "https://github.com/EvanZhouDev/openai-oauth", label: "openai-oauth on GitHub" },
  },
  {
    title: "Its own search engine",
    body: "SearXNG runs on your machine, so every request searches the web for free, in rounds, until the leads stop coming.",
    link: { href: "https://github.com/searxng/searxng", label: "SearXNG on GitHub" },
  },
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
        <dd className="text-small">
          A web search, every time, in rounds: more companies hiring on Greenhouse, Ashby, Lever and Workable, and job lists on any site RUVO may read. Plus its own list of
          well-known tech companies and the Hacker News hiring thread.
        </dd>
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
            Say what you need in plain words. RUVO searches the web for it every time, reads job boards, websites and search results, and hands you the best leads first, in a
            table where every value shows the page it came from and the words it was read from.
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

      <section aria-labelledby="inside-heading" className={cn(frame, "space-y-group border-t border-hairline-strong py-section")}>
        <h2 id="inside-heading" className="text-title font-semibold">
          What&apos;s inside
        </h2>
        <ul className="grid gap-group md:grid-cols-3">
          {INSIDE.map((item) => (
            <li key={item.title} className="space-y-item rounded-panel border border-hairline bg-sheet p-group">
              <h3 className="text-heading font-semibold">{item.title}</h3>
              <p className="text-graphite">{item.body}</p>
              <a href={item.link.href} className="inline-block font-mono text-small text-ink underline underline-offset-4 hover:decoration-2">
                {item.link.label}
              </a>
            </li>
          ))}
        </ul>
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
              <p>
                RUVO searches the web in rounds, then reads each site&apos;s own data feed first and the page itself second: a plain request, a real browser for pages built in
                JavaScript, and a stealth browser only when a bot check stands in the way. It keeps to robots.txt, and when a run comes up short of good leads, it goes back
                for more.
              </p>
            </StepText>
          </CollectingBand>
          <Step n={4} title="Open the list. Best leads first, every value with a receipt." example={<ListExample />} wide>
            <p>
              Each lead gets a score out of 100 and a rating, Strong, Good or Possible, and a funnel shows what every step kept and where the rest were lost. Click a row to see
              where each value came from and the exact words it was read from; a value RUVO can&apos;t find on the page is dropped, not guessed. Run it again later and New marks
              what the last run didn&apos;t have. Download the list as an Excel workbook with its receipts, or as a CSV.
            </p>
          </Step>
        </ol>
      </section>

      <section aria-label="Limits and setup" className={cn(frame, "grid gap-section border-t border-hairline-strong py-section md:grid-cols-2")}>
        <div className="space-y-stack">
          <div className="space-y-group">
            <h2 className="text-title font-semibold">What it won&apos;t do</h2>
            <ul className="space-y-item">
              {WONT.map(({ line, why }) => (
                <li key={line} className="flex gap-item">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 bg-ink" />
                  <span>
                    <strong className="font-semibold">{line}</strong> <span className="text-graphite">{why}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-item">
            <h3 className="text-heading font-semibold">Good to know</h3>
            <ul className="space-y-item text-graphite">
              {GOOD_TO_KNOW.map((note) => (
                <li key={note} className="flex gap-item">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 bg-hairline-strong" />
                  {note}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="min-w-0 space-y-group">
          <h2 className="text-title font-semibold">It runs on your machine</h2>
          <p>
            RUVO is open source and runs on your computer: Postgres and its own search engine in Docker, Scrapling on your Python, and your OpenAI key or your ChatGPT plan,
            signed in from Settings. Your requests and lists stay with you. There are no accounts: it is made for one person on one machine.
          </p>
          <pre className="overflow-x-auto rounded-panel bg-void p-group font-mono text-small leading-relaxed text-sheet">
            <code>{`pip install "scrapling[all]" && scrapling install
git clone ${REPO} && cd ruvo
bun install && bun run setup   # then add your OpenAI key, or sign in with ChatGPT
bun run dev`}</code>
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
