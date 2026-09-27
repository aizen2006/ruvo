import type { Request, Response, NextFunction } from "express";
import { logger } from "../libs/logger";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;

    logger.info("HTTP request", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: duration,
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
  });

  next();
}