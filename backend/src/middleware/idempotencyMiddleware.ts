/**
 * Idempotency Key Middleware
 *
 * Enforces idempotency for mutating HTTP requests (POST/PUT/PATCH) using a
 * client-supplied `Idempotency-Key` header.
 *
 * Behaviour:
 *  - No key present       → request passes through normally (each call is independent)
 *  - First request        → processed normally; response stored in Redis for 24 hours
 *  - Replay (same body)   → cached response replayed verbatim with `X-Idempotency-Replayed: true`
 *  - Body mismatch        → 422 Unprocessable Entity (key reused with different payload)
 *  - Concurrent requests  → second request is locked out with 409 Conflict while first is in-flight
 *
 * Storage layout in Redis:
 *   idempotency:lock:<sha256(key)>        — NX lock (expires in 30 s)
 *   idempotency:response:<sha256(key)>    — JSON-serialised cached response (expires in 24 h)
 *
 * The body hash (SHA-256 of the raw JSON body) is stored alongside the cached
 * response and compared on every replay attempt.
 */

import crypto from "crypto";
import { Request, Response, NextFunction, RequestHandler } from "express";
import { getRedis } from "../redis.js";

/** TTL for stored responses — 24 hours in seconds */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** TTL for the in-flight lock — long enough for any realistic request */
const LOCK_TTL_SECONDS = 30;

const REDIS_PREFIX_RESPONSE = "idempotency:response:";
const REDIS_PREFIX_LOCK = "idempotency:lock:";

export interface StoredResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  bodyHash: string;
}

/** SHA-256 hex digest of the canonicalised request body. */
function hashBody(body: unknown): string {
  const canonical = JSON.stringify(body ?? null);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** SHA-256 hex digest of the idempotency key itself (safe Redis key segment). */
function hashKey(idempotencyKey: string): string {
  return crypto.createHash("sha256").update(idempotencyKey).digest("hex");
}

/**
 * Returns an Express middleware that enforces idempotency.
 *
 * @param options.ttlSeconds - Override the default 24-hour TTL (useful in tests)
 */
export function idempotencyMiddleware(options?: {
  ttlSeconds?: number;
}): RequestHandler {
  const ttl = options?.ttlSeconds ?? IDEMPOTENCY_TTL_SECONDS;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idempotencyKey = req.headers["idempotency-key"];

    // No key — pass through; every request is treated independently
    if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      next();
      return;
    }

    const keyHash = hashKey(idempotencyKey.trim());
    const responseKey = `${REDIS_PREFIX_RESPONSE}${keyHash}`;
    const lockKey = `${REDIS_PREFIX_LOCK}${keyHash}`;
    const redis = getRedis();

    try {
      // ── 1. Check for an existing stored response ─────────────────────────
      const stored = await redis.get(responseKey);
      if (stored !== null) {
        const parsed: StoredResponse = JSON.parse(stored);
        const incomingHash = hashBody(req.body);

        if (incomingHash !== parsed.bodyHash) {
          // Same key, different body — reject
          res.status(422).json({
            error: "Idempotency key already used with a different request body",
          });
          return;
        }

        // Same key, same body — replay cached response
        for (const [headerName, headerValue] of Object.entries(parsed.headers)) {
          res.set(headerName, headerValue);
        }
        res.set("X-Idempotency-Replayed", "true");
        res.status(parsed.status).json(parsed.body);
        return;
      }

      // ── 2. Acquire in-flight lock (NX = set only if not exists) ──────────
      const acquired = await redis.set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX");
      if (acquired === null) {
        // Another request with the same key is currently being processed
        res.status(409).json({
          error: "A request with this idempotency key is already in progress",
        });
        return;
      }

      // ── 3. Intercept the outgoing response so we can cache it ─────────────
      const originalJson = res.json.bind(res);

      res.json = function (body: unknown): Response {
        // Only cache successful / client-error responses (not 5xx server errors)
        if (res.statusCode < 500) {
          const capturedHeaders: Record<string, string> = {};
          const contentType = res.getHeader("content-type");
          if (contentType) {
            capturedHeaders["content-type"] = String(contentType);
          }

          const payload: StoredResponse = {
            status: res.statusCode,
            headers: capturedHeaders,
            body,
            bodyHash: hashBody(req.body),
          };

          // Fire-and-forget: store response in Redis then release the lock.
          // We intentionally don't await here because res.json() must return
          // synchronously; errors are logged but never bubble to the client.
          Promise.all([
            redis.set(responseKey, JSON.stringify(payload), "EX", ttl),
            redis.del(lockKey),
          ]).catch((err: Error) => {
            console.error("[Idempotency] Redis write failed:", err.message);
          });
        } else {
          // On 5xx, release the lock so the caller can retry
          redis.del(lockKey).catch((err: Error) => {
            console.error("[Idempotency] Redis lock release failed:", err.message);
          });
        }

        return originalJson(body);
      };

      next();
    } catch (err) {
      // Fail open on Redis errors — availability > strict idempotency enforcement
      console.error("[Idempotency] Redis error:", (err as Error).message);
      next();
    }
  };
}
