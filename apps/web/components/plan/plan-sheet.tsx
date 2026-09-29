"use client";

import type { DatasetContract, RunDetail, SearchLog } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { PageList } from "@/components/page-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { runKeys, useRunAction, useWorkflow } from "@/lib/queries";
import { ColumnChips } from "./column-chips";
import { PlanFacts } from "./plan-facts";
import { RuleChips } from "./rule-chips";
import { SiteList } from "./site-list";

/** One part of the plan, laid out like a spec sheet: the name in a margin column, then what it says. */
function Part({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-item border-t border-hairline px-group py-group first:border-t-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-group">
      <h2 className="flex items-baseline gap-tight font-mono text-small font-medium">
        <span aria-hidden className="size-1.5 shrink-0 -translate-y-0.5 bg-ink" />
        {title}
      </h2>
      <div className="min-w-0 space-y-item">
        {hint && <p className="text-small text-graphite">{hint}</p>}
        {children}
      </div>
    </section>
  );
}

/** The web searches RUVO ran to find sources, with how many results each gave. */
function SearchedFor({ queries }: { queries: SearchLog[] }) {
  return (
    <p className="text-small text-graphite">
      Searched the web for{" "}
      {queries.map((q, i) => (
        <span key={q.query}>
          {i > 0 && ", "}
          <span className="font-mono text-ink">&ldquo;{q.query}&rdquo;</span> ({q.error ? "not searched" : `${q.hits} results`})
        </span>
      ))}
      .
    </p>
  );
}

/**
 * "Check the plan": what RUVO understood, in plain words, before anything is collected.
 * Columns, rules and websites can be changed here. Unsaved changes live in the run page
 * (`edited`), so saving recompiles the plan without another AI call.
 */
export function PlanSheet({ run, edited, onEdit }: { run: RunDetail; edited: DatasetContract | null; onEdit: (c: DatasetContract | null) => void }) {
  const client = useQueryClient();
  const workflow = useWorkflow(run.id, run.status);
  const draft = edited ?? run.contract;
  const dirty = edited !== null;

  const save = useRunAction(run.id, () => api.editContract(run.id, draft!));
  const start = useRunAction(run.id, () => api.startRun(run.id));
  // Removes a searched source from the saved plan; unsaved edits stay as they are.
  const removeSource = useRunAction(run.id, (ref: string) => api.editContract(run.id, run.contract!, [ref]));
  // Lists that filter on sensitive attributes start only once the purpose is confirmed.
  const [purposeConfirmed, setPurposeConfirmed] = useState(false);

  if (!draft) return null;
  const update = (next: Partial<DatasetContract>) => onEdit({ ...draft, ...next });
  const ir = workflow.data?.ir;
  const noSources = ir !== undefined && ir.sources.length === 0;
  const found = new Set(ir?.search?.sources.map((s) => s.ref));
  // Plans saved before sensitive flags existed have no list.
  const sensitiveAttributes = draft.sensitive ?? [];
  const sensitive = sensitiveAttributes.length > 0;

  return (
    <div className="space-y-group">
      <div className="overflow-hidden rounded-panel border border-hairline bg-sheet">
        <Part title="The columns" hint="Solid columns must be filled in for a row to count; dashed ones are nice to have. Press one to switch it.">
          <ColumnChips
            fields={draft.fields}
            onToggle={(name) => update({ fields: draft.fields.map((f) => (f.name === name ? { ...f, required: !f.required } : f)) })}
          />
        </Part>

        {draft.criteria.length > 0 && (
          <Part title="The rules" hint="Press a rule to change or remove it.">
            <RuleChips
              criteria={draft.criteria}
              edits={{
                onToggle: (id) =>
                  update({ criteria: draft.criteria.map((c) => (c.id === id ? { ...c, strength: c.strength === "hard" ? "soft" : "hard" } : c)) }),
                onRemove: (id) => update({ criteria: draft.criteria.filter((c) => c.id !== id) }),
              }}
            />
          </Part>
        )}

        {draft.assumptions.length > 0 && (
          <Part title="How RUVO read your words">
            <dl className="space-y-item text-small">
              {draft.assumptions.map((a) => (
                <div key={a.phrase} className="space-y-1">
                  <dt className="font-mono font-medium">&ldquo;{a.phrase}&rdquo;</dt>
                  <dd className="text-graphite">{a.interpretation}</dd>
                </div>
              ))}
            </dl>
          </Part>
        )}

        <Part
          title="Where it will look"
          hint={
            draft.entity === "job_posting"
              ? "Job boards RUVO knows for this request, plus any website you add."
              : "RUVO searches the web for pages that list these records, and reads any website you add. It learns each page once, so later runs are cheaper."
          }
        >
          {workflow.isPending ? (
            <Skeleton className="h-8 w-2/3" />
          ) : ir && ir.sources.length > 0 ? (
            <SiteList
              sources={ir.sources}
              found={found}
              onRemove={(ref) =>
                removeSource.mutate(ref, {
                  onSuccess: () => {
                    void client.invalidateQueries({ queryKey: runKeys.workflow(run.id) });
                    toast("Source removed");
                  },
                })
              }
            />
          ) : workflow.error ? (
            // Without the plan there is nothing to start, so say why and offer another try.
            <p className="text-small text-brick">
              Couldn&apos;t load the plan: {workflow.error.message}{" "}
              <Button variant="quiet" size="sm" disabled={workflow.isFetching} onClick={() => void workflow.refetch()}>
                Retry
              </Button>
            </p>
          ) : null}
          {ir?.search && ir.search.queries.length > 0 && <SearchedFor queries={ir.search.queries} />}
          {noSources && (
            <p className="rounded-control bg-amber-wash px-3 py-2 text-small text-amber">
              {ir.search ? "The web search found no page RUVO may read." : "Nothing to read yet."} Add a website that lists these, then save your
              changes.
            </p>
          )}
          <PageList urls={draft.sourceHints.urls} onChange={(urls) => update({ sourceHints: { ...draft.sourceHints, urls } })} />
        </Part>

        {draft.unsupported.length > 0 && (
          <Part title="What RUVO can't collect">
            <ul className="list-[square] space-y-1 pl-5 text-small text-graphite">
              {draft.unsupported.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </Part>
        )}

        {sensitive && (
          <Part
            title="Sensitive details"
            hint={`This list filters on ${sensitiveAttributes.join(", ")}. RUVO counts that only when people say it about themselves in public, never guessing from a name, photo or looks. Rows without their own words are marked Check this.`}
          >
            <label className="flex items-start gap-tight text-small">
              <input
                type="checkbox"
                checked={purposeConfirmed}
                onChange={(e) => setPurposeConfirmed(e.target.checked)}
                className="mt-0.5 size-4 accent-(--color-ink)"
              />
              I&apos;ll use this list only for outreach these people would reasonably expect.
            </label>
          </Part>
        )}

        {ir && (
          <Part title="Cost and time">
            <PlanFacts run={run} ir={ir} />
          </Part>
        )}
      </div>

      {/* The actions float over the plan as it scrolls. */}
      <div className="frost sticky bottom-3 flex flex-col gap-tight rounded-panel p-tight sm:flex-row sm:items-center">
        {dirty ? (
          <>
            <Button
              variant="primary"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(undefined, {
                  onSuccess: () => {
                    // The server's cleaned-up version replaces the draft.
                    onEdit(null);
                    void client.invalidateQueries({ queryKey: runKeys.workflow(run.id) });
                    toast("Plan updated");
                  },
                })
              }
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="quiet" onClick={() => onEdit(null)}>
              Discard
            </Button>
            <p className="px-tight font-mono text-micro text-graphite sm:ml-auto">Save before starting. Nothing is collected yet.</p>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              size="lg"
              disabled={start.isPending || noSources || !ir || (sensitive && !purposeConfirmed)}
              onClick={() => start.mutate(undefined, { onSuccess: () => toast("Collecting started") })}
            >
              {start.isPending ? "Starting…" : "Start collecting"}
            </Button>
            <Button variant="quiet" asChild>
              <Link href="/">Change my request</Link>
            </Button>
          </>
        )}
        {(save.error ?? start.error ?? removeSource.error) && (
          <p className="px-tight text-small text-brick sm:ml-auto">{(save.error ?? start.error ?? removeSource.error)!.message}</p>
        )}
      </div>
    </div>
  );
}
