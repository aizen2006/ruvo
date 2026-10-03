import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../libs/errors";

/** A page served from this machine: http://localhost:<port> or http://127.0.0.1:<port>. */
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * The API answers any CORS origin, so any website open in the browser could call it. Routes that change
 * this machine (settings, the ChatGPT sign-in) accept only requests without an Origin (curl, scripts)
 * or from a page on this machine.
 */
export function localOriginOnly(req: Request, _res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (origin && !LOOPBACK.test(origin)) throw new HttpError(403, "Only the dashboard on this computer (http://localhost) can do this.");
  next();
}
