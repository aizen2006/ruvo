"use client";

import type { DatasetContract, RunDetail } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { runKeys, useRunAction } from "@/lib/queries";
import { Button } from "../ui/button";
import { AnnotatedRequest } from "./annotated-request";
import { CriteriaList } from "./criteria-list";
import { SourcePages } from "./source-pages";

/**
 * The Dataset Contract: what RUVO understood from the request. While the run awaits
 * approval the user can change which fields are required and how strict each criterion is.
 *
 * Unsaved edits live in the run page (`edited`), so the header's Start button knows about
 * them; with no edits the server's latest version is shown.
 */
export function ContractView({
  run,
  edited,
  onEdit,
}: {
  run: RunDetail;
  edited: DatasetContract | null;
  onEdit: (contract: DatasetContract | null) => void;
}) {
  const saved = run.contract;
  const draft = edited ?? saved;
  const dirty = edited !== null;
  const client = useQueryClient();
  const editable = run.status === "awaiting_approval";

  const save = useRunAction(run.id, () => api.editContract(run.id, draft!));

  if (!saved || !draft) {
    return <p className="py-6 text-graphite">RUVO is reading the request. The contract appears here in a few seconds.</p>;
  }

  const update = (next: Partial<DatasetContract>) => onEdit({ ...draft, ...next });
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
    <div className="space-y-section py-group">
      <AnnotatedRequest prompt={run.prompt} assumptions={draft.assumptions} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-body font-semibold">Columns</h2>
          <p className="text-small text-graphite">Up to {draft.maxRecords} records</p>
        </div>
        <table className="w-full border-collapse text-small">
          <thead>
            <tr className="border-b-2 border-ink text-left font-mono text-micro text-graphite">
              <th className="py-2 pr-4 font-medium">Column</th>
              <th className="py-2 pr-4 font-medium">Meaning</th>
              <th className="py-2 text-right font-medium">Required</th>
            </tr>
          </thead>
          <tbody>
            {draft.fields.map((f) => (
              <tr key={f.name} className="border-b border-hairline">
                <td className="py-2 pr-4 font-mono text-small">{f.name}</td>
                <td className="py-2 pr-4 text-graphite">{f.description}</td>
                <td className="py-2 text-right">
                  <input
                    type="checkbox"
                    aria-label={`${f.name} is required`}
                    checked={f.required}
                    disabled={!editable}
                    onChange={() => update({ fields: draft.fields.map((x) => (x.name === f.name ? { ...x, required: !x.required } : x)) })}
                    className="size-4 accent-(--color-ink)"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <SourcePages
        urls={draft.sourceHints.urls}
        needed={draft.entity !== "job_posting"}
        onChange={editable ? (urls) => update({ sourceHints: { ...draft.sourceHints, urls } }) : undefined}
      />

      <section className="space-y-3">
        <h2 className="text-body font-semibold">How records are judged</h2>
        <CriteriaList criteria={draft.criteria} edits={edits} />
      </section>

      {draft.unsupported.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-semibold">Not something RUVO can collect</h2>
          <ul className="list-disc pl-5 text-small text-graphite">
            {draft.unsupported.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      {editable && (
        <div className="frost sticky bottom-3 flex flex-wrap items-center gap-3 rounded-panel p-tight">
          <Button
            variant="primary"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  // The server's normalized version replaces the draft.
                  onEdit(null);
                  void client.invalidateQueries({ queryKey: runKeys.workflow(run.id) });
                },
              })
            }
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
          {dirty && (
            <Button variant="quiet" onClick={() => onEdit(null)}>
              Discard changes
            </Button>
          )}
          <p className="text-small text-graphite">
            {save.isSuccess && !dirty
              ? `Saved. The workflow was recompiled as version ${save.data.version}.`
              : dirty
                ? "Saving recompiles the workflow; nothing is collected until you start."
                : "Adjust the contract, or start collecting when it looks right."}
          </p>
          {save.error && <p className="text-small text-brick">{save.error.message}</p>}
        </div>
      )}
    </div>
  );
}
