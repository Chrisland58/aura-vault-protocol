/**
 * API Gateway Logging Middleware — Issue #319
 *
 * Logs every request/response with structured fields:
 *   timestamp, correlationId, method, path, statusCode, durationMs,
 *   requestBodyHash, responseSize
 *
 * Security:
 *   - Request body is only logged at DEBUG level (disabled in production by default)
 *   - Sensitive fields (passwords, tokens, secrets, authorization values) are
 *     never written to logs
 *   - Error stack traces appear in logs but NOT in response bodies
 *
 * Log format uses JSON so Loki's label extraction pipeline can parse
 * `level`, `correlationId`, `method`, `path`, and `statusCode` as labels.
 */

import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RequestLogEntry {
  timestamp: string;
  level: LogLevel;
  correlationId: string;
  method: string;
  path: string;
  query?: Record<string, unknown>;
  statusCode: number;
  durationMs: number;
  requestBodyHash: string | null;
  responseSize: number;
  userAgent?: string;
  ip?: string;
  userId?: string;
  errorMessage?: string;
  errorStack?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const LOG_DEBUG_BODY = process.env.LOG_DEBUG_BODY === "true"; // off by default in prod

/**
 * Fields whose values must never be written to logs.
 * Matching is case-insensitive on the key name.
 */
const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "mnemonic",
  "seed",
  "seedphrase",
  "seed_phrase",
  "cvv",
  "ssn",
  "creditcard",
  "credit_card",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively redact sensitive fields from an object.
 * Returns a new object; does not mutate the original.
 */
export function redactSensitiveFields(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveFields);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * SHA-256 hex hash of the raw request body string.
 * Returns null if the body is empty or not a plain object.
 */
function hashBody(body: unknown): string | null {
  if (!body || (typeof body === "object" && Object.keys(body as object).length === 0)) {
    return null;
  }
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}

/** Write a structured log entry to stdout as a single JSON line (Loki-friendly). */
export function writeLog(entry: RequestLogEntry): void {
  process.stdout.write(JSON.stringify(entry) + "\n");
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
      startTimeMs?: number;
    }
  }
}

/**
 * loggingMiddleware — mount once, early in the stack, before auth/rate-limit.
 *
 * Example:
 *   app.use(loggingMiddleware());
 */
export function loggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Attach correlation ID — prefer a forwarded one from a trusted gateway
    const correlationId =
      (req.headers["x-correlation-id"] as string | undefined) ??
      (req.headers["x-request-id"] as string | undefined) ??
      uuidv4();

    req.correlationId = correlationId;
    req.startTimeMs = Date.now();

    // Echo the ID back so clients can correlate on their end
    res.setHeader("X-Correlation-Id", correlationId);

    // Optionally log the incoming request body at DEBUG level
    if (!IS_PRODUCTION || LOG_DEBUG_BODY) {
      const redacted = redactSensitiveFields(req.body);
      process.stdout.write(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "debug",
          correlationId,
          event: "request_body",
          method: req.method,
          path: req.path,
          body: redacted,
        }) + "\n"
      );
    }

    // Intercept res.end to capture response size and status
    const originalEnd = res.end.bind(res);
    let responseSize = 0;

    // @ts-expect-error — overriding overloaded method
    res.end = function (chunk?: unknown, ...rest: unknown[]) {
      if (chunk) {
        responseSize =
          typeof chunk === "string"
            ? Buffer.byteLength(chunk, "utf8")
            : Buffer.isBuffer(chunk)
              ? chunk.length
              : 0;
      }

      const durationMs = Date.now() - (req.startTimeMs ?? Date.now());
      const statusCode = res.statusCode;
      const level: LogLevel =
        statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

      const entry: RequestLogEntry = {
        timestamp: new Date().toISOString(),
        level,
        correlationId,
        method: req.method,
        path: req.path,
        query:
          Object.keys(req.query).length > 0
            ? (req.query as Record<string, unknown>)
            : undefined,
        statusCode,
        durationMs,
        requestBodyHash: hashBody(req.body),
        responseSize,
        userAgent: req.headers["user-agent"],
        ip: clientIp(req),
        userId: (req as unknown as { user?: { sub?: string } }).user?.sub,
      };

      // For error responses, capture error detail in the log (never in the body)
      if (statusCode >= 400) {
        const err = (req as unknown as { _loggingError?: Error })._loggingError;
        if (err) {
          entry.errorMessage = err.message;
          entry.errorStack = err.stack;
        }
      }

      writeLog(entry);
      // @ts-expect-error — forwarding rest args
      return originalEnd(chunk, ...rest);
    };

    next();
  };
}

/**
 * errorLoggingMiddleware — mount after route handlers, before the generic
 * error handler.  Attaches the error to the request so loggingMiddleware can
 * include the stack trace in the structured log.
 */
export function errorLoggingMiddleware() {
  return (err: Error, req: Request, _res: Response, next: NextFunction): void => {
    (req as unknown as { _loggingError?: Error })._loggingError = err;
    next(err);
  };
}
