import express from "express";
import cors from "cors";
import helmet from "helmet";
import { chatgptRouter } from "./api/chatgpt.routes";
import { datasetsRouter } from "./api/datasets.routes";
import { optionsRouter } from "./api/options.routes";
import { recipesRouter } from "./api/recipes.routes";
import { runsRouter } from "./api/runs.routes";
import { settingsRouter } from "./api/settings.routes";
import { sql } from "./db/client";
import { careersSite } from "./fixtures/careersSite";
import { localOriginOnly } from "./middlewares/localOrigin";
import { requestLogger } from "./middlewares/requestLogger";
import { errorHandler, notFoundHandler } from "./middlewares/errorLogger";

/** Builds the Express app without listening, so tests can mount it directly. */
export function createApp() {
  const app = express();

  // maxAge caches preflights so the dashboard's polling doesn't send one per request.
  app.use(cors({ maxAge: 600 }));
  // The dashboard runs on a different origin, so API responses must be readable cross-origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  // Healthy only while the database answers, so an orchestrator notices an API that lost it.
  app.get("/health", async (_req, res) => {
    await sql`select 1`;
    res.status(200).json({ status: "ok" });
  });
  app.use("/api/options", optionsRouter);
  app.use("/api/runs", runsRouter);
  app.use("/api/datasets", datasetsRouter);
  app.use("/api/recipes", recipesRouter);
  // Fictional demo site for self-repair demos; not served in production.
  if (process.env.NODE_ENV !== "production") app.use("/fixtures", careersSite);
  // Signing in with ChatGPT starts programs on this machine and saving settings rewrites its .env:
  // not served in production either, and only to pages on this machine.
  if (process.env.NODE_ENV !== "production") {
    app.use("/api/chatgpt", localOriginOnly, chatgptRouter);
    app.use("/api/settings", localOriginOnly, settingsRouter);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
