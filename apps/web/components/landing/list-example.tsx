import type { EvidenceMethod } from "@repo/contracts";
import { CertaintyMark } from "@/components/result/certainty-mark";
import { NewBadge } from "@/components/result/data-table";
import { Quote } from "@/components/result/quote";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LEAD_TIER_LABEL, leadOf, SOURCE_PHRASE, type Certainty } from "@/lib/plain";

// An example list with made-up companies, shaped like a real run of the jobs request above: best leads first,
// scored by the real formula from how well each fits (matchScore) and how sure RUVO is of its values (confidence).
const ROWS: { company: string; title: string; location: string; salary: string; certainty: Certainty; matchScore: number; confidence: number; isNew?: boolean }[] = [
  { company: "Halden Labs", title: "Staff Backend Engineer, Inference", location: "Remote, US", salary: "$210k–260k", certainty: "sure", matchScore: 0.95, confidence: 0.91 },
  { company: "Quillmark", title: "Senior Software Engineer, AI Platform", location: "New York or remote", salary: "$185k–225k", certainty: "likely", matchScore: 0.85, confidence: 0.83, isNew: true },
  { company: "Northgate Systems", title: "Backend Engineer, Data Pipelines", location: "Remote, Europe", salary: "", certainty: "sure", matchScore: 0.6, confidence: 0.92 },
  { company: "Tessellate", title: "Senior Backend Engineer, Developer Tools", location: "Remote", salary: "$170k–200k", certainty: "likely", matchScore: 0.6, confidence: 0.82, isNew: true },
  { company: "Parallax AI", title: "Machine Learning Engineer, Evaluation", location: "San Francisco", salary: "$190k–240k", certainty: "check", matchScore: 0.5, confidence: 0.66 },
];
const leadFor = (row: (typeof ROWS)[number]) => leadOf({ status: "valid", matchScore: row.matchScore, confidence: row.confidence })!;

/** The first row's receipt: each value, how sure RUVO is, where it came from and the words it was read from. */
const RECEIPT: { column: string; value: string; certainty: Certainty; method: EvidenceMethod; snippet: string; found: string }[] = [
  {
    column: "Salary",
    value: "USD 210,000–260,000 a year",
    certainty: "likely",
    method: "REGEX",
    snippet: "The base salary range for this role is $210,000—$260,000 USD. Offers also include equity.",
    found: "$210,000—$260,000 USD",
  },
  {
    column: "Title",
    value: "Staff Backend Engineer, Inference",
    certainty: "sure",
    method: "API",
    snippet: '"title": "Staff Backend Engineer, Inference"',
    found: "Staff Backend Engineer, Inference",
  },
  {
    column: "Location",
    value: "Remote, US",
    certainty: "likely",
    method: "DOM",
    snippet: "Location: Remote (United States)",
    found: "Remote (United States)",
  },
  {
    column: "What the company does",
    value: "Inference infrastructure for open models",
    certainty: "check",
    method: "SEARCH",
    snippet: "Halden Labs | Inference infrastructure for open-weight models. Series B, about 80 people.",
    found: "Inference infrastructure for open-weight models",
  },
];

/** A finished list with one row's receipt open beside it, as static markup. */
export function ListExample() {
  return (
    <div className="grid gap-group lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <figure className="min-w-0 rounded-panel border border-hairline bg-sheet">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Salary</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>How sure</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row, i) => {
              const lead = leadFor(row);
              return (
                <TableRow key={row.company} className={i === 0 ? "bg-highlighter-wash" : undefined}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {row.company}
                    {row.isNew && <NewBadge />}
                  </TableCell>
                  <TableCell className="min-w-56">{row.title}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.location}</TableCell>
                  <TableCell className="whitespace-nowrap tabular">{row.salary ? <span className={i === 0 ? "mark" : undefined}>{row.salary}</span> : <span className="text-pencil">Not listed</span>}</TableCell>
                  <TableCell>
                    {/* As LeadMark shows it in a real list: "Strong 93". */}
                    <span className="inline-flex items-baseline gap-1.5 font-mono text-micro whitespace-nowrap">
                      {LEAD_TIER_LABEL[lead.tier]}
                      <span className="text-graphite tabular">{lead.score}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <CertaintyMark certainty={row.certainty} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <figcaption className="border-t border-hairline px-3 py-3 text-small text-graphite">
          Showing 5 of 214 rows, best leads first. Salary was nice to have, so a row without one still counts.
        </figcaption>
      </figure>

      <aside aria-label="Receipt for the first row" className="rounded-sheet border border-hairline bg-sheet p-group">
        <p className="text-heading font-semibold">Staff Backend Engineer, Inference</p>
        <p className="text-small text-graphite">Halden Labs, from its Greenhouse job board</p>
        <p className="mt-tight text-small">
          {LEAD_TIER_LABEL[leadFor(ROWS[0]!).tier]} lead, <span className="tabular">{leadFor(ROWS[0]!).score}</span> of 100.
        </p>
        <ul className="mt-item">
          {RECEIPT.map((item) => (
            <li key={item.column} className="space-y-tight border-t border-hairline py-item last:pb-0">
              <div className="flex items-start justify-between gap-item">
                <div className="min-w-0">
                  <p className="text-micro text-graphite">{item.column}</p>
                  <p>{item.value}</p>
                </div>
                <CertaintyMark certainty={item.certainty} />
              </div>
              <Quote snippet={item.snippet} value={item.found} />
              <p className="text-micro text-graphite">{SOURCE_PHRASE[item.method]}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
