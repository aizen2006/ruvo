"use client";

import { Download, Play, RotateCcw, Settings2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DotField } from "@/components/dot-field";
import { FallingCat } from "@/components/falling-cat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Textarea } from "@/components/ui/input";
import { RadioGroup, RadioTile } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabList, TabPanel, Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";

// Mirrors the tokens in app/globals.css and the Colour table in docs/design.md.
const COLOURS: Array<[token: string, hex: string, role: string]> = [
  ["canvas", "#E9E9E6", "Page paper"],
  ["sheet", "#F7F7F5", "Flat surfaces; frosted at 72%"],
  ["ink", "#000000", "Text, primary buttons, focus"],
  ["graphite", "#3D3D3B", "Secondary text"],
  ["pencil", "#62625F", "Placeholders, hints"],
  ["hairline", "#D2D2CE", "Rules"],
  ["hairline-strong", "#B4B4AF", "Control outlines"],
  ["highlighter", "#FF7A2E", "Signal: found, proven, chosen"],
  ["highlighter-wash", "#FFE3D1", "Focus halo, new-row flash"],
  ["stamp", "#1D7248", "Sure"],
  ["amber", "#8F5400", "Check this"],
  ["brick", "#AE2116", "Errors, stopping"],
];

// Literal class names, so Tailwind finds them.
const TYPE: Array<[name: string, className: string, sample: string, spec: string]> = [
  ["count", "font-dot text-count font-black", "248", "96 / 88 Doto"],
  ["display", "font-dot text-display font-extrabold", "What do you need?", "64 / 64 Doto"],
  ["title", "font-dot text-title font-extrabold", "Remote backend jobs", "40 / 44 Doto"],
  ["heading", "text-heading font-semibold", "Remote backend jobs", "20 / 28 Geist 600"],
  ["body", "text-body", "Remote backend jobs, with salary", "16 / 24 Geist"],
  ["small", "text-small", "Remote backend jobs, with salary", "14 / 20 Geist"],
  ["micro", "font-mono text-micro", "Salary range", "12 / 16 Geist Mono"],
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
    <section className="space-y-group border-t border-hairline-strong pt-stack">
      <h2 className="text-heading font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A mono caption beside a specimen. */
function Label({ children }: { children: ReactNode }) {
  return <span className="w-20 shrink-0 font-mono text-micro text-pencil">{children}</span>;
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
  const [details, setDetails] = useState(true);
  return (
    <div className="mx-auto max-w-5xl space-y-section pb-section">
      <header className="space-y-item">
        <h1 className="font-dot text-display font-extrabold">Design system</h1>
        <p className="max-w-prose text-graphite">
          Noise resolves into rows: soft grey paper, true black ink, dot-matrix imagery, and <span className="mark">one signal</span> for what
          RUVO found or you chose.
        </p>
      </header>

      <Section title="Dot field">
        <DotFieldDemo />
      </Section>

      <Section title="Loader">
        <p className="max-w-prose text-small text-graphite">While a whole page loads: a small pixel cat falling on its back, centred. Panels keep their dither skeletons.</p>
        <FallingCat className="h-40" />
      </Section>

      <Section title="Surfaces">
        <p className="max-w-prose text-small text-graphite">Content sits flat on sheet with a hairline. Only what floats is frosted.</p>
        <div className="relative overflow-hidden rounded-panel border border-hairline">
          <DotField intensity={0.7} className="absolute inset-0" />
          <div className="relative grid gap-item p-item sm:grid-cols-2 sm:p-stack">
            <div className="space-y-tight rounded-control border border-hairline bg-sheet p-item">
              <p className="font-mono text-micro text-pencil">Flat</p>
              <p className="text-small">Tables, tiles and anything you read in place.</p>
            </div>
            <div className="frost space-y-item rounded-panel p-item">
              <p className="font-mono text-micro text-pencil">Frosted</p>
              <Textarea aria-label="Request" defaultValue="Remote backend jobs, with salary" className="min-h-16" />
              <div className="flex items-center justify-between gap-tight">
                <span className="tabular font-mono text-micro text-graphite">about $0.03</span>
                <Button variant="primary">Make my list</Button>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Colour">
        <ul className="grid grid-cols-2 gap-item sm:grid-cols-3 lg:grid-cols-4">
          {COLOURS.map(([token, hex, role]) => (
            <li key={token} className="overflow-hidden rounded-control border border-hairline bg-sheet">
              <div className="h-16 border-b border-hairline" style={{ background: `var(--color-${token})` }} />
              <div className="space-y-0.5 p-3">
                <p className="font-mono text-small">{token}</p>
                <p className="font-mono text-micro text-pencil">{hex}</p>
                <p className="text-micro text-graphite">{role}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <p className="max-w-prose text-small text-graphite">
          Doto for the few big moments, Geist for everything you read, Geist Mono for everything you press or scan and for text quoted from a
          source page.
        </p>
        <div className="space-y-item">
          {TYPE.map(([name, className, sample, spec]) => (
            <div key={name} className="flex flex-col gap-x-group gap-y-1 sm:flex-row sm:items-baseline">
              <Label>{name}</Label>
              <span className={`min-w-0 break-words ${className}`}>{sample}</span>
              <span className="font-mono text-micro text-pencil">{spec}</span>
            </div>
          ))}
          <p className="rounded-control bg-sheet px-3 py-2 font-mono text-small">
            &ldquo;Compensation: <span className="mark">$180,000 to $240,000</span> USD&rdquo;
          </p>
        </div>
      </Section>

      <Section title="Space and radius">
        <div className="space-y-tight">
          {SPACE.map(([name, px]) => (
            <div key={name} className="flex items-center gap-item">
              <Label>{name}</Label>
              <span className="h-3 bg-ink" style={{ width: px * 2 }} />
              <span className="font-mono text-micro text-pencil">{px}px</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-item">
          {RADII.map(([name, radius]) => (
            <div key={name} className={`flex size-24 items-end border border-hairline-strong bg-sheet p-2 font-mono text-micro text-graphite ${radius}`}>
              {name}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-tight">
          <Button variant="primary" size="lg">
            <Play /> Make my list
          </Button>
          <Button>Change my request</Button>
          <Button variant="quiet">Show details</Button>
          <Button variant="danger">Stop</Button>
          <Button size="icon" aria-label="Settings">
            <Settings2 />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-tight">
          <Label>sizes</Label>
          <Button variant="primary" size="sm">
            Start
          </Button>
          <Button variant="primary">Start</Button>
          <Button variant="primary" size="lg">
            Start
          </Button>
          <Button size="sm">
            <RotateCcw /> Run again
          </Button>
          <Button>Run again</Button>
          <Button size="lg">Run again</Button>
        </div>
        <div className="flex flex-wrap items-center gap-tight">
          <Label>disabled</Label>
          <Button variant="primary" disabled>
            Start
          </Button>
          <Button disabled>Run again</Button>
          <Button variant="quiet" disabled>
            Show details
          </Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-tight">
          <Badge tone="sure">Sure</Badge>
          <Badge tone="neutral">Likely</Badge>
          <Badge tone="check">Check this</Badge>
          <Badge tone="error">Didn&apos;t finish</Badge>
          <Badge tone="chosen">Chosen</Badge>
          <Badge tone="outline">Must have</Badge>
        </div>
      </Section>

      <Section title="Inputs and choices">
        <div className="grid gap-item sm:grid-cols-2">
          <Textarea placeholder="What do you need a list of?" />
          <div className="space-y-item">
            <Input placeholder="https://example.com/careers" />
            <Input aria-invalid defaultValue="example" aria-label="Website with an error" />
            <Select defaultValue="luna">
              <SelectTrigger aria-label="Reading model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="luna" hint="$0.10 in, $0.50 out per million words">
                  Luna
                </SelectItem>
                <SelectItem value="sol" hint="$2 in, $10 out per million words">
                  Sol
                </SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-group">
              <label className="flex items-center gap-tight font-mono text-small">
                <Switch checked={details} onCheckedChange={setDetails} /> Show details
              </label>
              <label className="flex items-center gap-tight font-mono text-small">
                <Switch /> Email me
              </label>
            </div>
          </div>
        </div>
        <RadioGroup defaultValue="balanced" className="grid-cols-1 sm:grid-cols-3" aria-label="How thorough">
          {[
            ["Quick", "A first look", "$0.01"],
            ["Balanced", "Most requests", "$0.03"],
            ["Thorough", "Every page it can reach", "$0.12"],
          ].map(([label, blurb, cost]) => (
            <RadioTile key={label} value={label!.toLowerCase()} className="gap-1">
              <span className="font-semibold">{label}</span>
              <span className="text-small text-graphite">{blurb}</span>
              <span className="tabular pt-tight text-small">about {cost}</span>
            </RadioTile>
          ))}
        </RadioGroup>
      </Section>

      <Section title="Tabs and table">
        <Tabs defaultValue="rows">
          <TabList
            tabs={[
              { value: "rows", label: "Rows", hint: "248" },
              { value: "sources", label: "Sources", hint: "12" },
              { value: "plan", label: "Plan" },
            ]}
          />
          <TabPanel value="rows" className="pt-item">
            <div className="overflow-hidden rounded-control border border-hairline bg-sheet">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Salary</TableHead>
                    <TableHead>Certainty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="animate-row-in">
                    <TableCell>Anthropic</TableCell>
                    <TableCell>Research Engineer, Life Sciences</TableCell>
                    <TableCell className="tabular">$350,000 to $500,000</TableCell>
                    <TableCell>
                      <Badge tone="sure">Sure</Badge>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Linear</TableCell>
                    <TableCell>Senior Backend Engineer</TableCell>
                    <TableCell className="tabular">$190,000 to $240,000</TableCell>
                    <TableCell>
                      <Badge tone="check">Check this</Badge>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    {["w-24", "w-48", "w-32", "w-16"].map((w) => (
                      <TableCell key={w}>
                        <Skeleton className={`h-4 ${w}`} />
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabPanel>
          <TabPanel value="sources" className="pt-item text-small text-graphite">
            Twelve pages were read.
          </TabPanel>
          <TabPanel value="plan" className="pt-item text-small text-graphite">
            The plan behind this list.
          </TabPanel>
        </Tabs>
        <div className="grid gap-item sm:grid-cols-3">
          <Skeleton className="h-20 rounded-panel" />
          <Skeleton className="h-20 rounded-panel" />
          <Skeleton className="h-20 rounded-panel" />
        </div>
      </Section>

      <Section title="Floating">
        <div className="flex flex-wrap gap-tight">
          <Sheet>
            <SheetTrigger asChild>
              <Button>Open a receipt</Button>
            </SheetTrigger>
            <SheetContent title="Research Engineer, Life Sciences" description="Anthropic">
              <p className="rounded-control bg-sheet px-3 py-2 font-mono text-small">
                &ldquo;Annual salary: <span className="mark">$350,000 to $500,000</span> USD&rdquo;
              </p>
            </SheetContent>
          </Sheet>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="danger">Delete dataset</Button>
            </DialogTrigger>
            <DialogContent title="Delete this dataset?" description="Its rows and receipts are removed for good.">
              <div className="flex justify-end gap-tight">
                <DialogClose asChild>
                  <Button variant="quiet">Keep it</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="primary">Delete</Button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>
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
          <Tooltip content="Read directly from the site's own data">
            <Button variant="quiet">Hover me</Button>
          </Tooltip>
          <Button variant="quiet" onClick={() => toast("Started", { description: "Collecting from 12 pages" })}>
            Show a toast
          </Button>
        </div>
      </Section>
    </div>
  );
}
