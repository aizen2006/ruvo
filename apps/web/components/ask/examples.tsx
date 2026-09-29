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

export function Examples({ onPick }: { onPick: (example: Example) => void }) {
  return (
    // A black sidebar block beside the composer on wide screens, below it on phones.
    <section aria-labelledby="examples" className="on-ink space-y-group self-start bg-ink p-group text-sheet lg:col-span-4">
      <h2 id="examples" className="font-display text-[2.5rem] leading-none font-black">
        Or try one
      </h2>
      <div className="grid gap-group sm:grid-cols-2 lg:grid-cols-1">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <h3 className="pb-tight text-small font-semibold text-sheet/75">{group.label}</h3>
            <ul className="border-t-2 border-sheet">
              {group.examples.map((example) => (
                <li key={example.short} className="border-b border-sheet/30">
                  <button
                    type="button"
                    onClick={() => onPick(example)}
                    className="-mx-tight block w-[calc(100%+1rem)] px-tight py-2.5 text-left font-semibold hover:bg-highlighter hover:text-ink"
                  >
                    {example.short}
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
