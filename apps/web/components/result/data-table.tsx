"use client";

import type { DatasetContract, RecordDTO, RunDetail } from "@repo/contracts";
import { ExternalLink, Search } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { columnTitle } from "@/components/plan/column-chips";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RecordFilters } from "@/lib/api";
import { cellText, linkField, tableColumns } from "@/lib/cells";
import { formatNumber } from "@/lib/format";
import { useDiff, useRecords, useWorkflow } from "@/lib/queries";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";
import { CertaintyMark } from "./certainty-mark";
import { LeadMark } from "./lead-mark";
import { ReceiptDrawer } from "./receipt-drawer";

const PAGE_SIZE = 50;
// Column headers in mono on a 2px ink rule, like the head of a printout.
const HEAD = "border-b-2 border-ink font-mono font-normal text-ink";
const ANY = "any";

type Status = RecordDTO["status"] | typeof ANY;
const STATUS_TABS: Array<[Status, string]> = [
  ["valid", "In your list"],
  ["incomplete", "Missing a value"],
  ["invalid", "Set aside"],
  [ANY, "All"],
];

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "h-9 rounded-full border px-3 font-mono text-small transition-colors",
        pressed ? "border-ink bg-highlighter font-medium" : "border-hairline-strong bg-sheet text-graphite hover:border-ink hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** The list itself: search, a few plain filters, and rows that open their receipt. */
export function DataTable({ run }: { run: RunDetail }) {
  const contract = run.contract as DatasetContract;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("valid");
  const [remote, setRemote] = useState<NonNullable<RecordFilters["remote"]> | typeof ANY>(ANY);
  const [salaryOnly, setSalaryOnly] = useState(false);
  const [sureOnly, setSureOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [source, setSource] = useState(ANY);
  const [page, setPage] = useState(1);
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = (id: string, from: HTMLElement) => {
    opener.current = from;
    setOpenRecord(id);
  };

  const filters: RecordFilters = {
    q: useDebounced(search) || undefined,
    status: status === ANY ? undefined : status,
    remote: remote === ANY ? undefined : remote,
    hasSalary: salaryOnly || undefined,
    isNew: newOnly || undefined,
    source: source === ANY ? undefined : source,
    minConfidence: sureOnly ? 0.9 : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isFetching, error } = useRecords(run.id, filters, run.status);
  const { data: workflow } = useWorkflow(run.id, run.status);
  // Rows are only new against a previous run of the same request.
  const { data: diff } = useDiff(run.id, run.status);

  // Every filter change starts again at the first page.
  const refilter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };
  const clearFilters = () => {
    setSearch("");
    setStatus(ANY);
    setRemote(ANY);
    setSalaryOnly(false);
    setSureOnly(false);
    setNewOnly(false);
    setSource(ANY);
    setPage(1);
  };

  const columns = tableColumns(contract);
  const link = linkField(contract);
  const hasRemote = contract.fields.some((f) => f.catalogKey === "remote");
  const hasSalary = contract.fields.some((f) => f.catalogKey === "salary");
  const total = data?.total ?? 0;
  const kept = run.metrics.validRecords + run.metrics.incompleteRecords;
  const onlyDefault = status === "valid" && !search && remote === ANY && !salaryOnly && !sureOnly && !newOnly && source === ANY;
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, total);
  const primary = contract.fields.find((f) => f.catalogKey === "title") ?? columns[0];

  return (
    <section aria-label="Your list" className="space-y-item">
      <div className="flex flex-wrap items-center gap-tight">
        <div role="group" aria-label="Which rows" className="flex max-w-full gap-0.5 overflow-x-auto rounded-full border border-hairline-strong bg-sheet p-0.5">
          {STATUS_TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => refilter(setStatus)(value)}
              className={cn("h-8 shrink-0 rounded-full px-3 font-mono text-small whitespace-nowrap", status === value ? "bg-highlighter text-ink" : "text-graphite hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-48 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-pencil" aria-hidden />
          <Input type="search" value={search} onChange={(e) => refilter(setSearch)(e.target.value)} placeholder="Search the list" aria-label="Search the list" className="pl-9" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-tight">
        {diff?.previousRunId && (
          <Chip pressed={newOnly} onClick={() => refilter(setNewOnly)(!newOnly)}>
            New only
          </Chip>
        )}
        <Chip pressed={sureOnly} onClick={() => refilter(setSureOnly)(!sureOnly)}>
          Sure only
        </Chip>
        {hasSalary && (
          <Chip pressed={salaryOnly} onClick={() => refilter(setSalaryOnly)(!salaryOnly)}>
            Has a salary
          </Chip>
        )}
        {hasRemote && (
          <Select value={remote} onValueChange={(v) => refilter(setRemote)(v as typeof remote)}>
            <SelectTrigger aria-label="Where the work is" className="h-9 w-auto rounded-full font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="font-mono">
              <SelectItem value={ANY}>Remote or not</SelectItem>
              <SelectItem value="remote">Remote</SelectItem>
              <SelectItem value="hybrid">Hybrid</SelectItem>
              <SelectItem value="onsite">On-site</SelectItem>
            </SelectContent>
          </Select>
        )}
        {workflow && workflow.ir.sources.length > 1 && (
          <Select value={source} onValueChange={refilter(setSource)}>
            <SelectTrigger aria-label="Source" className="h-9 w-auto max-w-56 rounded-full font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="font-mono">
              <SelectItem value={ANY}>Every source</SelectItem>
              {workflow.ir.sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {error && <p className="text-small text-brick">{error.message}</p>}

      <div className={cn("overflow-hidden rounded-control border border-hairline bg-sheet transition-opacity", isFetching && "opacity-70")}>
        {/* Wide screens: a table. Phones: one stacked row per record. */}
        <div className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((f) => (
                  <TableHead key={f.name} className={HEAD}>
                    {columnTitle(f)}
                  </TableHead>
                ))}
                <TableHead className={HEAD}>Lead</TableHead>
                <TableHead className={HEAD}>How sure</TableHead>
                {link && (
                  <TableHead className={HEAD}>
                    <span className="sr-only">Link</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((record) => (
                <TableRow
                  key={record.id}
                  tabIndex={0}
                  aria-label={`Open the receipt for ${cellText(record.data[primary?.name ?? ""])}`}
                  onClick={(e) => open(record.id, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    // Otherwise the same key press also activates the receipt's Close button once it takes focus.
                    e.preventDefault();
                    open(record.id, e.currentTarget);
                  }}
                  className="cursor-pointer transition-colors hover:bg-canvas/70 focus-visible:bg-highlighter-wash/60"
                >
                  {columns.map((f) => (
                    <TableCell
                      key={f.name}
                      className={cn(
                        f.catalogKey === "title" && "min-w-56 font-medium",
                        f.catalogKey === "match_reason" && "max-w-xs text-graphite",
                        f.catalogKey === "location" && "max-w-56",
                        f.catalogKey === "salary" && "whitespace-nowrap",
                      )}
                    >
                      <span className={cn((f.catalogKey === "match_reason" || f.catalogKey === "location") && "line-clamp-2")}>{cellText(record.data[f.name])}</span>
                      {f === primary && record.isNew && <NewBadge />}
                    </TableCell>
                  ))}
                  <TableCell>
                    <LeadMark record={record} />
                  </TableCell>
                  <TableCell>
                    <CertaintyMark confidence={record.confidence} />
                  </TableCell>
                  {link && (
                    <TableCell>
                      <OpenLink href={String(record.data[link] ?? "")} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="divide-y divide-hairline sm:hidden">
          {data?.items.map((record) => (
            <li key={record.id}>
              <button type="button" onClick={(e) => open(record.id, e.currentTarget)} className="w-full space-y-1 px-item py-3 text-left active:bg-canvas/70">
                <span className="flex items-start justify-between gap-tight">
                  <span className="font-medium">
                    {cellText(record.data[primary?.name ?? ""])}
                    {record.isNew && <NewBadge />}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <LeadMark record={record} />
                    <CertaintyMark confidence={record.confidence} />
                  </span>
                </span>
                <span className="block text-small text-graphite">
                  {columns
                    .filter((f) => f !== primary && f.catalogKey !== "match_reason")
                    .map((f) => cellText(record.data[f.name]))
                    .filter((v) => v !== "—")
                    .join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {data && data.items.length === 0 && (
          <div className="space-y-item px-group py-stack text-center text-small text-graphite">
            {run.status === "running" ? (
              <p>No rows yet. They appear as each source finishes.</p>
            ) : kept === 0 ? (
              <p>No rows made it into this list. Turn on Show details to see why rows were set aside and which sources failed.</p>
            ) : onlyDefault && run.metrics.incompleteRecords > 0 ? (
              <>
                <p>No row has every must-have value; {formatNumber(run.metrics.incompleteRecords)} are missing at least one.</p>
                <Button onClick={() => refilter(setStatus)("incomplete")}>Show rows missing a value</Button>
              </>
            ) : (
              <>
                <p>No rows match these filters.</p>
                <Button onClick={clearFilters}>Clear filters</Button>
              </>
            )}
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between font-mono text-small text-graphite">
          <p className="tabular">
            {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
          </p>
          <div className="flex gap-tight">
            <Button variant="quiet" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant="quiet" size="sm" disabled={last >= total} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <ReceiptDrawer runId={run.id} recordId={openRecord} contract={contract} onClose={() => setOpenRecord(null)} returnFocusTo={opener.current} />
    </section>
  );
}

/**
 * Marks a row the previous run of the same request didn't have; new rows are found rows, so it wears
 * the signal. A space, not a margin, sets it apart, so a badge that wraps starts its line flush.
 */
const NewBadge = () => (
  <>
    {" "}
    <Badge tone="chosen" className="align-middle">
      New
    </Badge>
  </>
);

function OpenLink({ href }: { href: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 font-mono text-micro text-ink underline underline-offset-4 hover:decoration-2"
      aria-label="Open the original page"
    >
      Open <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
