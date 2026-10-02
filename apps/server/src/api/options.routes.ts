import type { RunOptions } from "@repo/contracts";
import { Router } from "express";
import { env } from "../config/env";
import { modelCatalog } from "../llm/models";
import { modeOptions } from "../runs/modes";

/** What a new run can be: its modes (with budgets) and the models the AI account offers, with prices. */
export const optionsRouter = Router();

optionsRouter.get("/", (_req, res) => {
  const options: RunOptions = { defaultMode: "balanced", account: env.AI_ACCOUNT, modes: modeOptions(env), models: modelCatalog() };
  res.json(options);
});
