"use client";

import type { DatasetContract, RecordDTO, RunDetail } from "@repo/contracts";
import clsx from "clsx";
import { useState } from "react";
import { api, type RecordFilters } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useRecords, useWorkflow } from "@/lib/queries";
import { useDebounced } from "@/lib/use-debounced";
import { Button } from "../ui/button";
import { EvidenceSheet } from "./evidence-sheet";
import { STATUS_STYLE, STATUS_TEXT } from "./status";

const PAGE_SIZE = 50;
/** Long-text columns stay out of the table; they are shown in the evidence panel. */
const HIDDEN_KEYS = new Set(["description", "url"]);


function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | "";
  options: Array<[T | "", string]>;
  onChange: (v: T | "") => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T | "")}
        className="rounded-(--radius-control) border border-rule-strong bg-surface px-2 py-1.5 text-ink"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const sentenceCase = (name: string) => {
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const cellText = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));

/** Searchable, filterable table of a run's records; a row opens its evidence. */
export function DatasetView({ run }: { run: RunDetail }) {
  const contract = run.contract as DatasetContract;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RecordDTO["status"] | "">("valid");
  const [remote, setRemote] = useState<NonNullable<RecordFilters["remote"]> | "">("");
  const [salary, setSalary] = useState<"yes" | "no" | "">("");
  const [source, setSource] = useState("");
  const [minConfidence, setMinConfidence] = useState<"0.9" | "0.75" | "">("");
  const [page, setPage] = useState(1);
  const [openRecord, setOpenRecord] = useState<string | null>(null);

  const filters: RecordFilters = {
    q: useDebounced(search) || undefined,
    status: status || undefined,
    remote: remote || undefined,
    hasSalary: salary ? salary === "yes" : undefined,
    source: source || undefined,
    minConfidence: minConfidence ? Number(minConfidence) : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isFetching, error } = useRecords(run.id, filters, run.status);
  const { data: workflow } = useWorkflow(run.id, run.status);
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  const columns = contract.fields.filter((f) => !HIDDEN_KEYS.has(f.catalogKey));
  const urlField = contract.fields.find((f) => f.catalogKey === "url")?.name;
  const hasRemote = contract.fields.some((f) => f.catalogKey === "remote");
  const hasSalary = contract.fields.some((f) => f.catalogKey === "salary");
  const total = data?.total ?? 0;
  const kept = run.metrics.validRecords + run.metrics.incompleteRecords;
  const onlyDefaultFilter = status === "valid" && !search && !remote && !salary && !source && !minConfidence;
  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setRemote("");
    setSalary("");
    setSource("");
    setMinConfidence("");
    setPage(1);
  };
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, total);

  if (run.status !== "running" && run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled") {
    return <p className="py-6 text-muted">Records appear here as soon as collection starts.</p>;
  }

  return (
    <div className="space-y-4 py-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <input
          type="search"
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Search records"
          aria-label="Search records"
          className="w-64 rounded-(--radius-control) border border-rule-strong bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <Select label="Status" value={status} onChange={resetPage(setStatus)} options={[["valid", "Valid"], ["incomplete", "Incomplete"], ["invalid", "Rejected"], ["", "All"]]} />
        {hasRemote && (
          <Select label="Work" value={remote} onChange={resetPage(setRemote)} options={[["", "Any"], ["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On-site"]]} />
        )}
        {hasSalary && (
          <Select label="Salary" value={salary} onChange={resetPage(setSalary)} options={[["", "Any"], ["yes", "Published"], ["no", "Not published"]]} />
        )}
        {workflow && (
          <Select
            label="Source"
            value={source}
            onChange={resetPage(setSource)}
            options={[["", "All"], ...workflow.ir.sources.map((s): [string, string] => [s.id, s.label])]}
          />
        )}
        <Select label="Confidence" value={minConfidence} onChange={resetPage(setMinConfidence)} options={[["", "Any"], ["0.9", "90% or more"], ["0.75", "75% or more"]]} />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <a href={api.exportUrl(run.id, "csv", "valid")} className="font-medium text-accent hover:underline">
            Download CSV
          </a>
          <a href={api.exportUrl(run.id, "json", "valid")} className="text-muted hover:text-ink">
            JSON
          </a>
          <a href={api.exportUrl(run.id, "csv", "all")} className="text-muted hover:text-ink">
            All records
          </a>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error.message}</p>}

      <div className={clsx("overflow-x-auto transition-opacity", isFetching && "opacity-70")}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule-strong text-left text-muted">
              {columns.map((f) => (
                <th key={f.name} className="py-2 pr-4 font-medium whitespace-nowrap">
                  {sentenceCase(f.name)}
                </th>
              ))}
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 text-right font-medium">Confidence</th>
              {urlField && <th className="py-2 font-medium" aria-label="Link" />}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((record) => (
              <tr
                key={record.id}
                onClick={() => setOpenRecord(record.id)}
                onKeyDown={(e) => e.key === "Enter" && setOpenRecord(record.id)}
                tabIndex={0}
                className="cursor-pointer border-b border-rule align-top hover:bg-surface focus:bg-surface"
              >
                {columns.map((f) => (
                  <td
                    key={f.name}
                    className={clsx(
                      "py-2.5 pr-4",
                      f.catalogKey === "title" && "min-w-56 font-medium",
                      f.catalogKey === "match_reason" && "max-w-xs text-muted",
                      f.catalogKey === "location" && "max-w-56",
                      f.catalogKey === "salary" && "whitespace-nowrap",
                    )}
                  >
                    <span className={clsx((f.catalogKey === "match_reason" || f.catalogKey === "location") && "line-clamp-2")}>
                      {cellText(record.data[f.name])}
                    </span>
                  </td>
                ))}
                <td className={clsx("py-2.5 pr-4 whitespace-nowrap", STATUS_STYLE[record.status])} title={record.rejectReasons.join("\n")}>
                  {STATUS_TEXT[record.status]}
                </td>
                <td className="py-2.5 pr-4 text-right">{Math.round(record.confidence * 100)}%</td>
                {urlField && (
                  <td className="py-2.5">
                    <a
                      href={String(record.data[urlField] ?? "")}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-accent hover:underline"
                    >
                      Open
                    </a>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && (
          <div className="space-y-3 py-10 text-center text-sm text-muted">
            {run.status === "running" ? (
              <p>No records yet. They appear here as each source finishes.</p>
            ) : kept === 0 ? (
              <p>This run kept no records. The Quality tab shows why records were set aside, and Activity lists any sources that failed.</p>
            ) : onlyDefaultFilter && run.metrics.incompleteRecords > 0 ? (
              <>
                <p>
                  No record has every required value; {formatNumber(run.metrics.incompleteRecords)} are missing at least one.
                </p>
                <Button onClick={() => setStatus("incomplete")}>Show incomplete records</Button>
              </>
            ) : (
              <>
                <p>No records match these filters.</p>
                <Button onClick={clearFilters}>Clear filters</Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <p>
          {total ? `Showing ${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(total)}` : ""}
          {run.status === "running" && " (still collecting)"}
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="px-2 py-1 hover:text-ink disabled:text-faint">
            Previous
          </button>
          <button type="button" disabled={last >= total} onClick={() => setPage(page + 1)} className="px-2 py-1 hover:text-ink disabled:text-faint">
            Next
          </button>
        </div>
      </div>

      <EvidenceSheet runId={run.id} recordId={openRecord} contract={contract} onClose={() => setOpenRecord(null)} />
    </div>
  );
}
