"use client";

import type { RunDetail, RunEvent, SourceBranch, Step } from "@repo/contracts";
import clsx from "clsx";
import Link from "next/link";
import { useWorkflow } from "@/lib/queries";
import { formatNumber, timeAgo } from "@/lib/format";
import { RecipeLineage } from "./recipe-lineage";

const STEP_LABEL: Record<Step["kind"], string> = {
  collect: "Fetch",
  prefilter: "Keyword filter",
  triage: "Triage",
  extract_text: "Read text",
  enrich: "Enrich",
  match: "Score",
  validate: "Validate",
  store: "Save",
};

const PLANNED_BY = {
  llm: "the planner model",
  template: "the default template",
  memory: "a reused past workflow",
  repair: "self-repair",
  user_edit: "your contract edit",
} as const;

type StepResult = { count: number; ms: number };

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

/** Step outcomes and source failures, read from the run's events. */
function outcomesFrom(events: RunEvent[]) {
  const steps = new Map<string, StepResult>();
  const failures = new Map<string, string>();
  for (const e of events) {
    const data = e.data as { stepId?: string; count?: number; ms?: number } | null;
    if (e.type === "step.completed" && data?.stepId) steps.set(data.stepId, { count: data.count ?? 0, ms: data.ms ?? 0 });
    if (e.type === "source.failed" && e.sourceId) failures.set(e.sourceId, e.message);
  }
  return { steps, failures };
}

function StepChain({ branch, steps }: { branch: SourceBranch; steps: Map<string, StepResult> }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      {branch.steps.map((step, i) => {
        const result = steps.get(step.id);
        return (
          <li key={step.id} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-faint" aria-hidden>→</span>}
            <span className={result ? "text-ink" : "text-muted"}>{STEP_LABEL[step.kind]}</span>
            {result && step.kind !== "store" && <span className="font-medium text-accent">{formatNumber(result.count)}</span>}
            {result && result.ms >= 100 && <span className="text-xs text-faint">{seconds(result.ms)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The executable plan behind a run: why each source was chosen and what each step produced. */
export function WorkflowView({ run, events }: { run: RunDetail; events: RunEvent[] }) {
  const { data: workflow, isLoading, error } = useWorkflow(run.id, run.status);

  if (!run.workflowId || isLoading) {
    return <p className="py-6 text-muted">The workflow appears here once RUVO has planned the run.</p>;
  }
  if (error || !workflow) return <p className="py-6 text-danger">{error?.message ?? "Workflow unavailable"}</p>;

  const { ir, planDraft } = workflow;
  const { steps, failures } = outcomesFrom(events);
  const collectOf = (branch: SourceBranch) => branch.steps.find((s): s is Extract<Step, { kind: "collect" }> => s.kind === "collect");
  const pageHosts = ir.sources.flatMap((b) => {
    const step = collectOf(b);
    const url = step?.adapter === "html_list" ? (step.params as { url?: string }).url : undefined;
    return url ? [new URL(url).host] : [];
  });

  return (
    <div className="space-y-10 py-6">
      <section className="max-w-3xl space-y-3">
        <p className="text-sm text-muted">
          Planned by {PLANNED_BY[ir.provenance.plannedBy]}
          {ir.provenance.model ? ` (${ir.provenance.model})` : ""}. Version {workflow.version} of this workflow.
        </p>
        {ir.provenance.plannedBy === "memory" && ir.provenance.reusedFrom && (
          <p className="inline-flex flex-wrap items-baseline gap-x-2 rounded-(--radius-control) bg-accent-wash px-3 py-1.5 text-sm">
            <span className="font-medium text-accent">Reused workflow</span>
            <span>
              This request matches{" "}
              <Link href={`/runs/${ir.provenance.reusedFrom}`} className="underline underline-offset-2">
                an earlier run
              </Link>
              {ir.provenance.reuseScore !== undefined && ` (${Math.round(ir.provenance.reuseScore * 100)}% similar)`}, so its plan was
              reused without calling the planner.
            </span>
          </p>
        )}
        {planDraft?.rationale && <p className="font-serif text-lg leading-relaxed">{planDraft.rationale}</p>}
        {ir.provenance.repairs && ir.provenance.repairs.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">What self-repair changed</p>
            <ul className="space-y-1 border-l-2 border-accent pl-3 text-sm">
              {ir.provenance.repairs.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        {ir.provenance.warnings.length > 0 && (
          <ul className="space-y-1 border-l-2 border-pattern pl-3 text-sm text-pattern">
            {ir.provenance.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Sources</h2>
          <p className="text-sm text-muted">
            Limits: {formatNumber(ir.budgets.maxPages)} pages, {formatNumber(ir.budgets.maxBrowserPages)} browser pages,{" "}
            {formatNumber(ir.budgets.maxLlmCalls)} LLM calls, {Math.round(ir.budgets.maxDurationMs / 60_000)} minutes
          </p>
        </div>
        {ir.sources.length === 0 ? (
          <p className="text-sm text-muted">No supported sources match this request.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule-strong text-left text-muted">
                <th className="py-2 pr-4 font-medium">Source</th>
                <th className="py-2 pr-4 font-medium">Steps</th>
                <th className="py-2 text-right font-medium">Keeps up to</th>
              </tr>
            </thead>
            <tbody>
              {ir.sources.map((branch) => {
                const failure = failures.get(branch.id);
                return (
                  <tr key={branch.id} className="border-b border-rule align-top">
                    <td className="max-w-sm py-3 pr-4">
                      <p className={clsx("font-medium", failure && "text-danger")}>{branch.label}</p>
                      <p className="text-muted">{branch.reason}</p>
                      {failure && <p className="mt-1 text-danger">{failure}</p>}
                    </td>
                    <td className="py-3 pr-4">
                      <StepChain branch={branch} steps={steps} />
                    </td>
                    <td className="py-3 text-right">{collectOf(branch)?.maxItems ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <RecipeLineage run={run} hosts={pageHosts} />

      {workflow.versions.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Versions</h2>
          <ol className="text-sm">
            {workflow.versions.map((v) => (
              <li key={v.id} className={clsx("py-1", v.id === workflow.workflowId ? "font-medium" : "text-muted")}>
                Version {v.version}, planned by {PLANNED_BY[v.plannedBy]}, {timeAgo(v.createdAt)}
                {v.id === workflow.workflowId && " (in use)"}
              </li>
            ))}
          </ol>
        </section>
      )}

      <details className="group">
        <summary className="cursor-pointer text-sm text-muted hover:text-ink">Show the workflow as JSON</summary>
        <pre className="mt-3 max-h-[32rem] overflow-auto rounded-(--radius-control) border border-rule bg-surface p-4 font-mono text-xs leading-relaxed">
          {JSON.stringify(ir, null, 2)}
        </pre>
      </details>
    </div>
  );
}
