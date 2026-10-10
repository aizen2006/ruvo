import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../libs/errors";

/** A page served from this machine: http://localhost:<port> or http://127.0.0.1:<port>. */
export const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** The names this machine answers to. */
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

/** Methods that change data. */
const CHANGES = ["POST", "PUT", "PATCH", "DELETE"];

/** Allowed origins, as cors() takes them: a pattern or a list. */
type Origins = RegExp | string[];

/** True for a request without an Origin (curl, scripts) or from one of `origins`. */
function fromOrigins(req: Request, origins: Origins) {
  const origin = req.get("origin");
  return !origin || (Array.isArray(origins) ? origins.includes(origin) : origins.test(origin));
}

/**
 * Answers only requests addressed to this machine by name. A website that points its own name at
 * 127.0.0.1 (DNS rebinding) is the API's own origin to the browser, so CORS wouldn't stop it reading answers.
 */
export function localHostOnly(req: Request, _res: Response, next: NextFunction) {
  if (!LOCAL_HOSTNAMES.includes(req.hostname)) throw new HttpError(403, "RUVO's API answers only requests to localhost on this computer.");
  next();
}

/**
 * CORS only stops other websites reading the API's answers; they can still send it a simple POST.
 * So requests that change data must come from one of `origins` (the dashboard) or without an Origin.
 */
export const changesOnlyFrom = (origins: Origins) => (req: Request, _res: Response, next: NextFunction) => {
  if (CHANGES.includes(req.method) && !fromOrigins(req, origins)) throw new HttpError(403, "Only the RUVO dashboard can do this.");
  next();
};

/**
 * Routes that change this machine (settings, the ChatGPT sign-in) answer only requests without an
 * Origin or from a page on this machine, reads included.
 */
export function localOriginOnly(req: Request, _res: Response, next: NextFunction) {
  if (!fromOrigins(req, LOOPBACK)) throw new HttpError(403, "Only the dashboard on this computer (http://localhost) can do this.");
  next();
}
