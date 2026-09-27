import winston from "winston";

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const isProduction = process.env.NODE_ENV === "production";

/** Human-readable single-line format for local development: `12:00:01 info message {meta}`. */
const devFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const time = String(timestamp).slice(11, 19);
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${time} ${level} ${stack ?? message}${extra}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp(),
    errors({ stack: true }),
    isProduction ? json() : combine(colorize(), devFormat),
  ),
  // Bun sets NODE_ENV=test under `bun test`; keep test output clean.
  silent: process.env.NODE_ENV === "test",
  transports: [new winston.transports.Console()],
});

export type Logger = winston.Logger;
