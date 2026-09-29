"use client";

import type { DatasetContract, Evidence, RecordDTO } from "@repo/contracts";
import { Check, ExternalLink, Minus, X } from "lucide-react";
import { columnTitle } from "@/components/plan/column-chips";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SOURCE_PHRASE } from "@/lib/plain";
import { useEvidence } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CertaintyMark } from "./certainty-mark";
import { Quote } from "./quote";

const text = (value: unknown) => (value === null || value === undefined || value === "" ? "" : String(value));

function ValueReceipt({ item, contract }: { item: Evidence; contract: DatasetContract }) {
  const field = contract.fields.find((f) => f.name === item.field);
  const value = text(item.value);
  return (
    <li className="space-y-tight border-t border-hairline py-group first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-item">
        <div className="min-w-0">
          <p className="font-mono text-micro text-graphite">{field ? columnTitle(field) : item.field}</p>
          <p className="mt-0.5 font-medium break-words">{value || "—"}</p>
        </div>
        <CertaintyMark confidence={item.verified ? item.confidence : 0} />
      </div>
      {item.snippet && <Quote snippet={item.snippet} value={value} />}
      {!item.verified && <p className="text-small text-brick">The quoted text wasn&apos;t found on the page, so this value isn&apos;t trusted.</p>}
      <p className="flex flex-wrap items-center gap-x-item gap-y-1 font-mono text-micro text-graphite">
        <span>{SOURCE_PHRASE[item.method]}</span>
        {item.method !== "DERIVED" && (
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink underline underline-offset-4 hover:decoration-2">
            Open the page <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        <span>Checked {new Date(item.capturedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
      </p>
    </li>
  );
}

const SIGNAL_ICON = { true: Check, false: X, null: Minus } as const;
const SIGNAL_TONE = { true: "text-stamp", false: "text-brick", null: "text-pencil" } as const;

/** Why this row is in the list: each rule with its outcome, as a checklist. */
function RowVerdict({ record }: { record: RecordDTO }) {
  return (
    <section className="space-y-tight border-b border-hairline pb-group">
      {record.signals.length > 0 && (
        <ul className="grid gap-x-item gap-y-1.5 font-mono text-micro sm:grid-cols-2">
          {record.signals.map((s) => {
            const key = String(s.passed) as keyof typeof SIGNAL_ICON;
            const Icon = SIGNAL_ICON[key];
            return (
              <li key={s.criterionId} className={cn("flex items-start gap-1.5", s.passed === null && "text-graphite")}>
                <Icon className={cn("mt-0.5 size-3 shrink-0", SIGNAL_TONE[key])} strokeWidth={3} aria-hidden />
                {s.label}
                <span className="sr-only">{s.passed === true ? "(yes)" : s.passed === false ? "(no)" : "(unknown)"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {record.rejectReasons.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-small text-brick">
          {record.rejectReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {record.seenOn.length > 1 && <p className="text-small text-graphite">Also listed on {record.seenOn.join(", ")}.</p>}
    </section>
  );
}

/**
 * A row's receipt: every value with how sure RUVO is, the words it was read from (highlighted),
 * and a link to the page. Opens from the table; focus returns there when it closes.
 */
export function ReceiptDrawer({
  runId,
  recordId,
  contract,
  onClose,
  returnFocusTo,
}: {
  runId: string;
  recordId: string | null;
  contract: DatasetContract;
  onClose: () => void;
  /** The row that opened the receipt; it opens without a Radix trigger, so focus is returned by hand. */
  returnFocusTo?: HTMLElement | null;
}) {
  const { data, isLoading, error } = useEvidence(runId, recordId);
  const record = data?.record;
  const order = new Map(contract.fields.map((f, i) => [f.name, i]));
  const evidence = [...(data?.evidence ?? [])].sort((a, b) => (order.get(a.field) ?? 99) - (order.get(b.field) ?? 99));
  const nameOf = (key: string) => contract.fields.find((f) => f.catalogKey === key)?.name;
  const title = record ? text(record.data[nameOf("title") ?? contract.fields[0]?.name ?? ""]) || "Row" : "Row";
  const company = record && nameOf("company") ? text(record.data[nameOf("company")!]) : "";

  return (
    <Sheet open={recordId !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Frosted, since it floats over the table; nearly solid on phones, where it covers the whole screen. */}
      <SheetContent
        className="frost bg-transparent max-sm:bg-sheet/95"
        onCloseAutoFocus={(e) => {
          if (!returnFocusTo) return;
          e.preventDefault();
          returnFocusTo.focus();
        }}
        title={title} description={company ? `${company}. Where each value came from.` : "Where each value came from."}>
        {isLoading && (
          <div className="space-y-item">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {error && <p className="text-small text-brick">{error.message}</p>}
        {record && (
          <>
            <RowVerdict record={record} />
            <ul className="pt-group">
              {evidence.map((item) => (
                <ValueReceipt key={item.field} item={item} contract={contract} />
              ))}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
