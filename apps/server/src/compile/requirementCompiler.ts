import { DatasetContract } from "@repo/contracts";
import { z } from "zod";
import { DOMAINS } from "../domains";
import type { LlmClient } from "../llm/client";
import { normalizeContract } from "./normalize";
import { COMPILE_SYSTEM_PROMPT } from "./prompt";

export interface CompiledRequirement {
  contract: DatasetContract;
  model: string;
  warnings: string[];
}

/** The contract as the model writes it: the domain is one of the packs'. */
const CompiledContract = DatasetContract.extend({ domain: z.enum(DOMAINS) });

/** Prompt → Dataset Contract: one planner-model call followed by deterministic normalization. */
export async function compileRequirement(llm: LlmClient, prompt: string, signal?: AbortSignal): Promise<CompiledRequirement> {
  const { data, model } = await llm.parse({
    stage: "compile",
    role: "planner",
    schema: CompiledContract,
    name: "dataset_contract",
    system: COMPILE_SYSTEM_PROMPT,
    user: prompt,
    signal,
  });
  const { contract, warnings } = normalizeContract(data, prompt);
  return { contract, model, warnings };
}
