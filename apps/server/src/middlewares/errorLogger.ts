import type { Request, Response, NextFunction } from "express";
import { logger } from "../libs/logger";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error("Unhandled request error", {
    message: err.message,
    stack: err.stack,
    method: req.method,
    path: req.originalUrl,
  });

  res.status(500).json({
    error: "Internal server error",
  });
}