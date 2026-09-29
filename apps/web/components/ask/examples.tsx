import { cn } from "@/lib/utils";

/** Starting points, grouped by what RUVO can read: job boards it knows, or any list page you link. */
const GROUPS: Array<{ label: string; examples: Array<{ short: string; prompt: string; urls?: string[] }> }> = [
  {
    label: "Jobs",
    examples: [
      {
        short: "Backend and AI roles at good tech companies",
        prompt:
          "Find me backend + AI engineering roles, preferably remote, from good technology companies. Return company, title, location, salary if available, job URL, and why the role matches.",
      },
      { short: "Remote ML infrastructure jobs with salary", prompt: "Remote-only ML infrastructure jobs at AI labs, with salary. Max 50." },
      { short: "Senior backend jobs at Stripe and Datadog", prompt: "Senior backend engineering jobs at Stripe and Datadog." },
    ],
  },
  {
    label: "Any website",
    examples: [
      {
        short: "Today's Hacker News front page",
        prompt: "List the stories on the Hacker News front page with their title, link, points and number of comments.",
        urls: ["https://news.ycombinator.com/"],
      },
    ],
  },
];

export type Example = { prompt: string; urls?: string[] };

/** Plain links in two columns; each starts with a small square, the dot of the dot field. */
export function Examples({ onPick, className }: { onPick: (example: Example) => void; className?: string }) {
  return (
    <section aria-labelledby="examples" className={cn("space-y-item border-t border-hairline pt-group", className)}>
      <h2 id="examples" className="font-mono text-micro text-graphite">
        Or try one
      </h2>
      <div className="grid gap-group sm:grid-cols-2">
        {GROUPS.map((group) => (
          <div key={group.label} className="space-y-tight">
            <h3 className="font-mono text-micro text-pencil">{group.label}</h3>
            <ul className="space-y-1.5">
              {group.examples.map((example) => (
                <li key={example.short}>
                  <button
                    type="button"
                    onClick={() => onPick(example)}
                    className="group inline-flex items-baseline gap-tight text-left text-small text-ink"
                  >
                    <span aria-hidden className="size-1.5 shrink-0 -translate-y-0.5 bg-ink" />
                    <span className="underline decoration-hairline-strong underline-offset-4 group-hover:decoration-ink">{example.short}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
