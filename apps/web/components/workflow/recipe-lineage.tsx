"use client";

import { isTerminal, type Recipe, type RunDetail } from "@repo/contracts";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { formatNumber, timeAgo } from "@/lib/format";
import { useRecipes, useRunAction, useSimulateDrift } from "@/lib/queries";
import { Button } from "../ui/button";

const ORIGIN_LABEL: Record<Recipe["origin"], string> = {
  llm_discovery: "Discovered by AI",
  local_repair: "Repaired locally, no AI",
  llm_repair: "Rediscovered by AI",
  simulated_drift: "Simulated drift",
};

/**
 * How RUVO reads each web page source: the recorded recipe and every version before it,
 * with buttons to break the newest version on purpose and watch the next run repair it.
 */
export function RecipeLineage({ run, hosts }: { run: RunDetail; hosts: string[] }) {
  const { data: recipes } = useRecipes(run.status);
  const relevant = (recipes ?? []).filter((r) => hosts.includes(r.host));
  if (relevant.length === 0) return null;

  const patterns = [...new Set(relevant.map((r) => r.urlPattern))];
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-body font-semibold">Page recipes</h2>
        <p className="text-small text-graphite">
          A recipe is the set of selectors RUVO recorded for reading a page. Runs replay it without AI; when a site changes, RUVO repairs it
          and keeps the old version here.
        </p>
      </header>
      {patterns.map((pattern) => (
        <PatternLineage key={pattern} run={run} versions={relevant.filter((r) => r.urlPattern === pattern)} />
      ))}
    </section>
  );
}

function PatternLineage({ run, versions }: { run: RunDetail; versions: Recipe[] }) {
  const router = useRouter();
  const drift = useSimulateDrift();
  const rerun = useRunAction(run.id, () => api.rerun(run.id));
  const active = versions.find((v) => v.status === "active");
  const canAct = isTerminal(run.status) && Boolean(run.workflowId);

  return (
    <div className="space-y-3">
      <p className="font-mono text-micro text-graphite">{versions[0]!.urlPattern}</p>
      <ol className="border-l border-hairline-strong">
        {versions.map((v) => (
          <li key={v.id} className="relative py-1.5 pl-4 text-small">
            <span
              aria-hidden
              className={clsx("absolute top-3 -left-[4.5px] size-2 rounded-full", v.status === "active" ? "bg-ink" : "bg-hairline-strong")}
            />
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className={clsx("font-medium", v.status !== "active" && "text-graphite")}>Version {v.version}</span>
              <span className={v.origin === "simulated_drift" ? "text-pattern" : "text-ink"}>{ORIGIN_LABEL[v.origin]}</span>
              {v.status === "active" && <span className="text-ink">in use</span>}
              <span className="text-graphite">
                {formatNumber(v.stats.uses)} {v.stats.uses === 1 ? "use" : "uses"}
                {v.stats.failures > 0 && `, ${formatNumber(v.stats.failures)} failed`}
                {v.stats.lastFill !== null && `, ${Math.round(v.stats.lastFill * 100)}% of fields filled last time`}
              </span>
              <span className="text-pencil">{timeAgo(v.createdAt)}</span>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-micro text-graphite hover:text-ink">Selectors</summary>
              <pre className="mt-1 overflow-x-auto font-mono text-micro leading-relaxed text-graphite">
                {[`item  ${v.def.itemSelector}`, ...v.def.fields.map((f) => `${f.name.padEnd(5)} ${f.selector || ":scope"} @${f.attr}`)].join("\n")}
              </pre>
            </details>
          </li>
        ))}
      </ol>

      {active && canAct && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="quiet" disabled={drift.isPending} onClick={() => drift.mutate({ recipeId: active.id, mode: "minor" })}>
            Simulate a small site change
          </Button>
          <Button variant="quiet" disabled={drift.isPending} onClick={() => drift.mutate({ recipeId: active.id, mode: "major" })}>
            Simulate a redesign
          </Button>
          {drift.isSuccess && (
            <>
              <p className="text-small text-pattern">Version {drift.data.version} now has stale selectors. Run again to watch RUVO repair it.</p>
              <Button
                variant="primary"
                disabled={rerun.isPending}
                onClick={() => rerun.mutate(undefined, { onSuccess: ({ runId }) => router.push(`/runs/${runId}`) })}
              >
                Run again
              </Button>
            </>
          )}
          {(drift.error ?? rerun.error) && <p className="w-full text-small text-brick">{(drift.error ?? rerun.error)!.message}</p>}
        </div>
      )}
    </div>
  );
}
