"use client";

import type { DatasetContract, RunDetail } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { runKeys, useRunAction } from "@/lib/queries";
import { Button } from "../ui/button";
import { AnnotatedRequest } from "./annotated-request";
import { CriteriaList } from "./criteria-list";

/**
 * The Dataset Contract: what RUVO understood from the request. While the run awaits
 * approval the user can change which fields are required and how strict each criterion is.
 */
export function ContractView({ run }: { run: RunDetail }) {
  const saved = run.contract;
  const [draft, setDraft] = useState<DatasetContract | null>(saved);
  const client = useQueryClient();
  const editable = run.status === "awaiting_approval";

  // Take new server versions unless the user has unsaved edits.
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const save = useRunAction(run.id, () => api.editContract(run.id, draft!));

  if (!saved || !draft) {
    return <p className="py-6 text-muted">RUVO is reading the request. The contract appears here in a few seconds.</p>;
  }

  const update = (next: Partial<DatasetContract>) => setDraft({ ...draft, ...next });
  const edits = editable
    ? {
        onToggleStrength: (id: string) =>
          update({
            criteria: draft.criteria.map((c) => (c.id === id ? { ...c, strength: c.strength === "hard" ? "soft" : "hard" } : c)),
          }),
        onRemove: (id: string) => update({ criteria: draft.criteria.filter((c) => c.id !== id) }),
      }
    : undefined;

  return (
    <div className="space-y-10 py-6">
      <AnnotatedRequest prompt={run.prompt} assumptions={draft.assumptions} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Columns</h2>
          <p className="text-sm text-muted">Up to {draft.maxRecords} records</p>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule-strong text-left text-muted">
              <th className="py-2 pr-4 font-medium">Column</th>
              <th className="py-2 pr-4 font-medium">Meaning</th>
              <th className="py-2 text-right font-medium">Required</th>
            </tr>
          </thead>
          <tbody>
            {draft.fields.map((f) => (
              <tr key={f.name} className="border-b border-rule">
                <td className="py-2 pr-4 font-mono text-[13px]">{f.name}</td>
                <td className="py-2 pr-4 text-muted">{f.description}</td>
                <td className="py-2 text-right">
                  <input
                    type="checkbox"
                    aria-label={`${f.name} is required`}
                    checked={f.required}
                    disabled={!editable}
                    onChange={() => update({ fields: draft.fields.map((x) => (x.name === f.name ? { ...x, required: !x.required } : x)) })}
                    className="size-4 accent-(--color-accent)"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">How records are judged</h2>
        <CriteriaList criteria={draft.criteria} edits={edits} />
      </section>

      {draft.unsupported.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Not something RUVO can collect</h2>
          <ul className="list-disc pl-5 text-sm text-muted">
            {draft.unsupported.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      {editable && (
        <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t border-rule bg-paper/95 px-6 py-3 backdrop-blur">
          <Button
            variant="primary"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(undefined, { onSuccess: () => client.invalidateQueries({ queryKey: runKeys.workflow(run.id) }) })
            }
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
          {dirty && (
            <Button variant="quiet" onClick={() => setDraft(saved)}>
              Discard changes
            </Button>
          )}
          <p className="text-sm text-muted">
            {save.isSuccess && !dirty
              ? `Saved. The workflow was recompiled as version ${save.data.version}.`
              : dirty
                ? "Saving recompiles the workflow; nothing is collected until you start."
                : "Adjust the contract, or start collecting when it looks right."}
          </p>
          {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
        </div>
      )}
    </div>
  );
}
