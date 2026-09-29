import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../libs/errors";
import { logger } from "../libs/logger";

/** Catch-all for unmatched routes; must be mounted after every router. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, `Route ${req.method} ${req.originalUrl} not found`));
}

/** Converts thrown errors into JSON responses. Only unexpected (5xx) errors are logged with stacks. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const { status, body } = toResponse(err);

  if (status >= 500) {
    logger.error("Unhandled request error", {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      method: req.method,
      path: req.originalUrl,
    });
  }

  res.status(status).json(body);
}

function toResponse(err: unknown): { status: number; body: { error: string; details?: unknown } } {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message, details: err.details } };
  }
  // Zod errors are matched structurally so this middleware doesn't depend on a zod version.
  if (isZodError(err)) {
    return { status: 400, body: { error: "Invalid request", details: err.issues } };
  }
  // express.json() rejects malformed bodies with a SyntaxError carrying status 400.
  if (err instanceof SyntaxError && (err as { status?: number }).status === 400) {
    return { status: 400, body: { error: "Malformed JSON body" } };
  }
  // Other body-parser failures (413 too large, 415 bad charset...) carry their own client status.
  if (isClientHttpError(err)) {
    return { status: err.status, body: { error: err.expose ? err.message : "Invalid request" } };
  }
  return { status: 500, body: { error: "Internal server error" } };
}

function isClientHttpError(err: unknown): err is Error & { status: number; expose?: boolean } {
  const status = (err as { status?: unknown } | null)?.status;
  return err instanceof Error && typeof status === "number" && status >= 400 && status < 500;
}

function isZodError(err: unknown): err is { issues: unknown[] } {
  return err instanceof Error && err.name === "ZodError" && Array.isArray((err as { issues?: unknown }).issues);
}
