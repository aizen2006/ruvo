import { SettingsUpdate } from "@repo/contracts";
import { Router } from "express";
import { readSettings, restartRuvo, saveSettings } from "../config/settings";
import { logger } from "../libs/logger";

/**
 * The dashboard's Settings. Saving rewrites apps/server/.env and restarts RUVO, so app.ts serves
 * these only outside production, and only to pages on this machine.
 */
export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(readSettings());
});

/** Saves the changes, then restarts RUVO; the dashboard waits until `startedAt` changes. */
settingsRouter.put("/", async (req, res) => {
  await saveSettings(SettingsUpdate.parse(req.body));
  // The restart stops this process, so it waits until the answer is out.
  res.on("finish", () => restartRuvo().catch((err: Error) => logger.warn("Could not restart RUVO after saving settings", { error: err.message })));
  res.json({ startedAt: readSettings().startedAt });
});
