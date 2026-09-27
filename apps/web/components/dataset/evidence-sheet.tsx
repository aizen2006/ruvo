"use client";

import type { DatasetContract, Evidence, RecordDTO } from "@repo/contracts";
import clsx from "clsx";
import { Dialog } from "radix-ui";
import { useEvidence } from "@/lib/queries";
import { MethodBadge } from "../method-badge";
import { STATUS_TEXT } from "./status";

const signalMark = (passed: boolean | null) => (passed === true ? "✓" : passed === false ? "✗" : "?");

function FieldEvidence({ item }: { item: Evidence }) {
  const value = item.value === null || item.value === "" ? "—" : String(item.value);
  return (
    <li className="space-y-2 border-b border-rule py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[13px] text-muted">{item.field}</p>
        <span className="flex items-center gap-2">
          <MethodBadge method={item.method} />
          <span className="text-xs text-muted">{Math.round(item.confidence * 100)}%</span>
        </span>
      </div>
      <p className="text-base break-words">{value}</p>
      {item.snippet && item.snippet !== value && (
        <blockquote className="border-l-2 border-rule-strong pl-3 text-sm text-muted">{item.snippet}</blockquote>
      )}
      {!item.verified && (
        <p className="text-sm text-danger">The quoted text was not found on the source page, so this value is not trusted.</p>
      )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-mono">{item.locator.value}</span>
        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          Open source
        </a>
        <span>Captured {new Date(item.capturedAt).toLocaleString()}</span>
      </p>
    </li>
  );
}

/** Side panel showing where every value of one record came from. */
export function EvidenceSheet({
  runId,
  recordId,
  contract,
  onClose,
}: {
  runId: string;
  recordId: string | null;
  contract: DatasetContract;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useEvidence(runId, recordId);
  const record: RecordDTO | undefined = data?.record;
  const order = new Map(contract.fields.map((f, i) => [f.name, i]));
  const evidence = [...(data?.evidence ?? [])].sort((a, b) => (order.get(a.field) ?? 99) - (order.get(b.field) ?? 99));
  const title = record ? String(record.data[contract.fields.find((f) => f.catalogKey === "title")?.name ?? "title"] ?? "Record") : "Record";
  const company = record ? record.data[contract.fields.find((f) => f.catalogKey === "company")?.name ?? "company"] : null;

  return (
    <Dialog.Root open={recordId !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/20" />
        <Dialog.Content className="fixed inset-y-0 right-0 flex w-full max-w-xl flex-col bg-surface shadow-xl outline-none data-[state=open]:animate-[slide-in_180ms_ease-out]">
          <div className="flex items-start justify-between gap-4 border-b border-rule px-6 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                {company ? `${String(company)}. ` : ""}Where each value came from.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded px-2 py-1 text-sm text-muted hover:bg-accent-wash hover:text-ink">Close</Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-8">
            {isLoading && <p className="py-6 text-sm text-muted">Loading evidence…</p>}
            {error && <p className="py-6 text-sm text-danger">{error.message}</p>}
            {record && (
              <>
                <section className="space-y-3 border-b border-rule py-4 text-sm">
                  <p>
                    <span className="font-medium">{STATUS_TEXT[record.status]}</span>. Confidence{" "}
                    <span className="font-medium">{Math.round(record.confidence * 100)}%</span>, match score{" "}
                    <span className="font-medium">{Math.round(record.matchScore * 100)}%</span>.
                  </p>
                  {record.signals.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {record.signals.map((s) => (
                        <li
                          key={s.criterionId}
                          className={clsx(
                            "rounded border px-2 py-0.5 text-xs",
                            s.passed === true && "border-accent/30 bg-accent-wash text-accent",
                            s.passed === false && "border-danger/30 bg-danger-wash text-danger",
                            s.passed === null && "border-rule text-muted",
                          )}
                          title={s.passed === null ? "Not decided yet" : s.strength === "hard" ? "Required" : "Preference"}
                        >
                          {signalMark(s.passed)} {s.label}
                        </li>
                      ))}
                    </ul>
                  )}
                  {record.rejectReasons.length > 0 && (
                    <ul className="list-disc pl-5 text-danger">
                      {record.rejectReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {record.seenOn.length > 1 && <p className="text-muted">Also listed on: {record.seenOn.join(", ")}</p>}
                </section>
                <ul>
                  {evidence.map((item) => (
                    <FieldEvidence key={item.field} item={item} />
                  ))}
                </ul>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
