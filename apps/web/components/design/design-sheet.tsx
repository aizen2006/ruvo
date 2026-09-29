"use client";

import { Download, Play } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DotField } from "@/components/dot-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Textarea } from "@/components/ui/input";
import { RadioGroup, RadioTile } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";

const COLOURS: Array<[token: string, hex: string, role: string]> = [
  ["canvas", "#EEF1F3", "Page background"],
  ["sheet", "#FFFFFF", "Surfaces: composer, table, drawers"],
  ["ink", "#16202A", "Text, primary buttons, focus"],
  ["graphite", "#4A5761", "Secondary text"],
  ["pencil", "#646F79", "Placeholders, hints, inactive labels"],
  ["hairline", "#DCE2E6", "Rules and borders"],
  ["highlighter", "#FFE45C", "Found, proven, chosen, progress"],
  ["highlighter-wash", "#FFF6C7", "Soft highlight, focus halo"],
  ["stamp", "#1E7A4F", "Sure, verified, done"],
  ["amber", "#9A5B00", "Check this, warnings"],
  ["brick", "#B42318", "Errors, destructive actions"],
];

// Literal class names, so Tailwind finds them.
const TYPE: Array<[name: string, className: string, spec: string]> = [
  ["display", "text-display font-semibold", "44 / 48, semibold"],
  ["title", "text-title font-semibold", "28 / 34, semibold"],
  ["heading", "text-heading font-semibold", "20 / 28, semibold"],
  ["body", "text-body", "16 / 24"],
  ["small", "text-small", "14 / 20"],
  ["micro", "text-micro", "12 / 16"],
];

const RADII = [
  ["control", "rounded-control"],
  ["panel", "rounded-panel"],
  ["sheet", "rounded-sheet"],
] as const;

const SPACE: Array<[name: string, px: number]> = [
  ["tight", 8],
  ["item", 16],
  ["group", 24],
  ["stack", 32],
  ["section", 48],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-group border-t border-hairline pt-stack">
      <h2 className="text-heading font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Both tones at full strength; the slider stands in for rows arriving. Hover to read rows with the lens. */
function DotFieldDemo() {
  const [resolve, setResolve] = useState(0);
  return (
    <div className="space-y-item">
      <div className="grid gap-item sm:grid-cols-2">
        <DotField resolve={resolve} interactive className="h-72 rounded-control border border-hairline bg-canvas" />
        <DotField tone="void" resolve={resolve} interactive className="h-72 rounded-control" />
      </div>
      <label className="flex max-w-md items-center gap-item font-mono text-small">
        Resolve
        <input type="range" min={0} max={1} step={0.01} value={resolve} onChange={(e) => setResolve(Number(e.target.value))} className="flex-1 accent-ink" />
        <span className="tabular w-10 text-right">{resolve.toFixed(2)}</span>
      </label>
    </div>
  );
}

export function DesignSheet() {
  return (
    <div className="mx-auto max-w-5xl space-y-section pb-section">
      <header className="space-y-tight">
        <h1 className="text-display font-semibold">Design system</h1>
        <p className="max-w-prose text-graphite">
          A list-maker with receipts: quiet ink on cool paper, and <span className="mark">one highlighter</span> for what RUVO found or you chose.
        </p>
      </header>

      <Section title="Dot field">
        <DotFieldDemo />
      </Section>

      <Section title="Colour">
        <ul className="grid grid-cols-2 gap-item sm:grid-cols-3 lg:grid-cols-4">
          {COLOURS.map(([token, hex, role]) => (
            <li key={token} className="overflow-hidden rounded-panel border border-hairline bg-sheet">
              <div className="h-16" style={{ background: `var(--color-${token})` }} />
              <div className="space-y-0.5 p-3">
                <p className="text-small font-medium">{token}</p>
                <p className="text-micro text-graphite">{hex}</p>
                <p className="text-micro text-graphite">{role}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <p className="text-small text-graphite">Bricolage Grotesque for everything. Spline Sans Mono only for text quoted from a source page.</p>
        <div className="space-y-item">
          {TYPE.map(([name, className, spec]) => (
            <div key={name} className="flex flex-wrap items-baseline gap-x-group">
              <span className="w-20 text-micro text-graphite">{name}</span>
              <span className={className}>Remote backend jobs</span>
              <span className="text-micro text-pencil">{spec}</span>
            </div>
          ))}
          <p className="font-mono text-small">
            &ldquo;Compensation: <span className="mark">$180,000 – $240,000</span> USD&rdquo;
          </p>
        </div>
      </Section>

      <Section title="Space and radius">
        <div className="space-y-tight">
          {SPACE.map(([name, px]) => (
            <div key={name} className="flex items-center gap-item">
              <span className="w-20 text-micro text-graphite">{name}</span>
              <span className="h-3 rounded-sm bg-ink/70" style={{ width: px * 2 }} />
              <span className="text-micro text-pencil">{px}px</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-item">
          {RADII.map(([name, radius]) => (
            <div key={name} className={`flex size-24 items-end border border-hairline-strong bg-sheet p-2 text-micro text-graphite ${radius}`}>
              {name}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons and badges">
        <div className="flex flex-wrap items-center gap-tight">
          <Button variant="primary" size="lg">
            <Play /> Make my list
          </Button>
          <Button variant="primary">Start</Button>
          <Button>Change my request</Button>
          <Button variant="quiet">Show details</Button>
          <Button variant="danger">Stop</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-tight">
          <Badge tone="sure">Sure</Badge>
          <Badge tone="neutral">Likely</Badge>
          <Badge tone="check">Check this</Badge>
          <Badge tone="error">Didn&apos;t finish</Badge>
          <Badge tone="chosen">Chosen</Badge>
          <Badge tone="outline">must have</Badge>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid gap-item sm:grid-cols-2">
          <Textarea placeholder="What do you want a list of?" />
          <div className="space-y-item">
            <Input placeholder="https://example.com/careers" />
            <Select defaultValue="luna">
              <SelectTrigger aria-label="Reading model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="luna" hint="$0.10 in / $0.50 out per million words">
                  Luna
                </SelectItem>
                <SelectItem value="sol" hint="$2 in / $10 out per million words">
                  Sol
                </SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-tight text-small">
              <Switch /> Show details
            </label>
          </div>
        </div>
        <RadioGroup defaultValue="balanced" className="grid-cols-1 sm:grid-cols-3" aria-label="How thorough">
          {["Quick", "Balanced", "Thorough"].map((label) => (
            <RadioTile key={label} value={label.toLowerCase()}>
              <span className="font-medium">{label}</span>
              <span className="text-small text-graphite">about $0.05</span>
            </RadioTile>
          ))}
        </RadioGroup>
      </Section>

      <Section title="Table, sheet, menu, tooltip, toast">
        <div className="overflow-hidden rounded-panel border border-hairline bg-sheet">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Salary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="animate-row-in">
                <TableCell>Anthropic</TableCell>
                <TableCell>Research Engineer, Life Sciences</TableCell>
                <TableCell>$350,000 – $500,000</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-48" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap gap-tight">
          <Sheet>
            <SheetTrigger asChild>
              <Button>Open a receipt</Button>
            </SheetTrigger>
            <SheetContent title="Research Engineer, Life Sciences" description="Anthropic">
              <p className="text-small text-graphite">Receipt content.</p>
            </SheetContent>
          </Sheet>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Download /> Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Spreadsheet (CSV)</DropdownMenuItem>
              <DropdownMenuItem>Data file (JSON)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip content="Read directly from the source's own data">
            <Button variant="quiet">Hover me</Button>
          </Tooltip>
          <Button variant="quiet" onClick={() => toast("Collecting started")}>
            Show a toast
          </Button>
        </div>
      </Section>
    </div>
  );
}
