import type { Stage } from "@repo/contracts";
import { compileRequirement } from "../compile/requirementCompiler";
import { env } from "../config/env";
import { getRequestPrompt, setRunStage } from "../db/repos/runs";
import { attachWorkflow, saveContract, saveWorkflow } from "../db/repos/workflows";
import { autoDetectCompanies } from "../plan/atsDetect";
import { discoverSources } from "../plan/discovery";
import type { LlmClient } from "../llm/client";
import { planForContract } from "../plan/planner";
import { listRegistry } from "../plan/registry";
import { budgetsFromEnv } from "./budget";
import { createEventBus, nextEventSeq, type EmitInput } from "./eventBus";
import { llm } from "./services";
import type { RunPreparer } from "./worker";

/**
 * Preparation phase of a run: prompt → Dataset Contract → candidate sources → WorkflowIR.
 * Ends in review (awaiting_approval) unless the run was created with autoStart.
 */
export const createPreparer = ({ llm }: { llm: LlmClient }): RunPreparer => async (run, signal) => {
  const bus = createEventBus(run.id, { startSeq: await nextEventSeq(run.id) });
  const stage = async (s: Stage, event: Omit<EmitInput, "stage">) => {
    await setRunStage(run.id, s);
    bus.emit({ ...event, stage: s });
  };

  try {
    await stage("understanding", { type: "compile.started", message: "Understanding the request" });
    const compiled = await compileRequirement(llm, await getRequestPrompt(run.requestId), signal);
    const contract = compiled.contract;
    const contractRow = await saveContract({ requestId: run.requestId, contract, editedBy: "llm", model: compiled.model });
    bus.emit({
      stage: "understanding",
      type: "compile.completed",
      message: `Dataset contract: ${contract.fields.length} fields, ${contract.criteria.length} criteria, ${contract.assumptions.length} assumptions`,
      data: { warnings: compiled.warnings },
    });

    await stage("planning", { type: "discovery.started", message: "Finding sources" });
    let discovery = discoverSources(contract, await listRegistry());

    // Companies the user named that the registry doesn't know: look for their public boards.
    if (discovery.unmatchedCompanies.length) {
      const { found, missing } = await autoDetectCompanies(discovery.unmatchedCompanies, { userAgent: env.USER_AGENT });
      for (const { name, hit } of found) {
        bus.emit({ stage: "planning", type: "discovery.detected", message: `Found a ${hit.ats} job board for ${name} (${hit.jobCount} postings)` });
      }
      if (missing.length) {
        bus.emit({ stage: "planning", type: "discovery.not_found", level: "warn", message: `No public job board found for ${missing.join(", ")}` });
      }
      if (found.length) discovery = discoverSources(contract, await listRegistry());
    }

    bus.emit({
      stage: "planning",
      type: "discovery.completed",
      level: discovery.candidates.length ? "info" : "warn",
      message: discovery.candidates.length
        ? `${discovery.candidates.length} candidate sources`
        : "No supported sources match this request",
      data: { candidates: discovery.candidates.map((c) => c.ref), unmatchedCompanies: discovery.unmatchedCompanies },
    });

    const { ir, draft } = await planForContract(llm, contract, discovery.candidates, budgetsFromEnv(env, contract.maxRecords), signal);
    const workflow = await saveWorkflow({ contractId: contractRow.id, ir, planDraft: draft });
    await attachWorkflow(run.id, workflow.id);
    bus.emit({
      stage: "planning",
      type: "plan.completed",
      message: `Workflow planned (${ir.provenance.plannedBy}): ${ir.sources.length} sources`,
      data: { plannedBy: ir.provenance.plannedBy, warnings: ir.provenance.warnings },
    });

    return run.autoStart ? "queued_run" : "awaiting_approval";
  } finally {
    await bus.close();
  }
};

export const prepareRun = createPreparer({ llm });
