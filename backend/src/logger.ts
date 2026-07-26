/**
 * Structured logger with correlation ID support.
 *
 * - JSON format in production
 * - Human-readable format in development
 * - Every request gets a unique correlationId (X-Correlation-ID header)
 * - correlationIdMiddleware() must be applied before request logger
 */

import { createLogger, format, transports, type Logger } from "winston";
import { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";

// ── Winston Logger ────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== "production";

export const logger: Logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: isDev
    ? format.combine(
        format.colorize(),
        format.timestamp({ format: "HH:mm:ss" }),
        format.printf(({ timestamp, level, message, correlationId, ...meta }) => {
          const cid = correlationId ? ` [${correlationId}]` : "";
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `${timestamp}${cid} ${level}: ${message}${extra}`;
        })
      )
    : format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
      ),
  transports: [new transports.Console()],
});

// ── Correlation ID Middleware ─────────────────────────────────────────────────

declare global {
  // Extend Express Request to carry correlationId
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Assigns a correlation ID to every request.
 * Reads X-Correlation-ID from the incoming headers (useful for request chains)
 * and echoes it back in the response; generates a new UUID if absent.
 */
export function correlationIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const existing = req.headers["x-correlation-id"];
    const correlationId =
      typeof existing === "string" && existing.length > 0
        ? existing
        : randomUUID();

    req.correlationId = correlationId;
    res.setHeader("X-Correlation-ID", correlationId);
    next();
  };
}

// ── Request Logger Middleware ─────────────────────────────────────────────────

/**
 * Logs each request/response pair with method, path, status, duration, and
 * the correlation ID.  Does not log the /api/health endpoint to reduce noise.
 */
export function createRequestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === "/api/health") {
      next();
      return;
    }

    const start = Date.now();
    const correlationId = req.correlationId;

    res.on("finish", () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

      logger.log(level, "HTTP request", {
        correlationId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
    });

    next();
  };
}
