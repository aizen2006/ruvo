import express from "express";
import cors from "cors";
import helmet from "helmet";
import { chatgptRouter } from "./api/chatgpt.routes";
import { datasetsRouter } from "./api/datasets.routes";
import { optionsRouter } from "./api/options.routes";
import { recipesRouter } from "./api/recipes.routes";
import { runsRouter } from "./api/runs.routes";
import { settingsRouter } from "./api/settings.routes";
import { streamRouter } from "./api/stream.routes";
import { env } from "./config/env";
import { sql } from "./db/client";
import { careersSite } from "./fixtures/careersSite";
import { changesOnlyFrom, localHostOnly, localOriginOnly, LOOPBACK } from "./middlewares/localOrigin";
import { requestLogger } from "./middlewares/requestLogger";
import { errorHandler, notFoundHandler } from "./middlewares/errorLogger";

/** Builds the Express app without listening, so tests can mount it directly. */
export function createApp() {
  const app = express();
  const production = env.NODE_ENV === "production";
  // The dashboard, the only web page that may call the API: CORS_ORIGINS in production, any page on this machine otherwise.
  const dashboard = production ? env.CORS_ORIGINS : LOOPBACK;

  // In production the API sits behind the operator's own host names; elsewhere it serves this machine only.
  if (!production) app.use(localHostOnly);
  // maxAge caches preflights so the dashboard's polling doesn't send one per request.
  app.use(cors({ origin: dashboard, maxAge: 600 }));
  app.use(changesOnlyFrom(dashboard));
  // Other sites can't embed API responses; the dashboard, another port of the same site, still can.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  // Healthy only while the database answers, so an orchestrator notices an API that lost it.
  app.get("/health", async (_req, res) => {
    await sql`select 1`;
    res.status(200).json({ status: "ok" });
  });
  app.use("/api/options", optionsRouter);
  app.use("/api/runs", runsRouter);
  app.use("/api/runs", streamRouter);
  app.use("/api/datasets", datasetsRouter);
  app.use("/api/recipes", recipesRouter);
  // Fictional demo site for self-repair demos; not served in production.
  if (!production) app.use("/fixtures", careersSite);
  // Signing in with ChatGPT starts programs on this machine and saving settings rewrites its .env:
  // not served in production either, and only to pages on this machine.
  if (!production) {
    app.use("/api/chatgpt", localOriginOnly, chatgptRouter);
    app.use("/api/settings", localOriginOnly, settingsRouter);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
