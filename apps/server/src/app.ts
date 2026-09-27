import express from "express";
import cors from "cors";
import helmet from "helmet";
import { datasetsRouter } from "./api/datasets.routes";
import { runsRouter } from "./api/runs.routes";
import { careersSite } from "./fixtures/careersSite";
import { requestLogger } from "./middlewares/requestLogger";
import { errorHandler, notFoundHandler } from "./middlewares/errorLogger";

/** Builds the Express app without listening, so tests can mount it directly. */
export function createApp() {
  const app = express();

  app.use(cors());
  // The dashboard runs on a different origin, so API responses must be readable cross-origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  app.use("/api/runs", runsRouter);
  app.use("/api/datasets", datasetsRouter);
  // Fictional demo site for self-repair demos; not served in production.
  if (process.env.NODE_ENV !== "production") app.use("/fixtures", careersSite);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
