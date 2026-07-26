/**
 * GDPR Right-to-Erasure Service  (Issue #532)
 *
 * Handles deletion of off-chain user data:
 *   - email address
 *   - notification preferences and subscriptions
 *   - portfolio history cache
 *
 * On-chain data (tx hashes, vault positions) is intentionally retained —
 * blockchain records cannot be erased and are not personal data under GDPR.
 *
 * Every request is persisted to `gdpr_erasure_requests` as a compliance
 * audit trail, and a confirmation email is sent on completion.
 */

import { getRedis } from "../redis.js";
import { NS } from "../cache.js";
import { enqueueEmail } from "./emailQueue.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ErasureRequest {
  id: number;
  walletAddress: string;
  requestedAt: Date;
  deadlineAt: Date;
  status: "pending" | "processing" | "completed" | "failed";
  completedAt: Date | null;
  deletedFields: string[];
  confirmationEmailSent: boolean;
  notes: string | null;
}

export interface ErasureResult {
  requestId: number;
  walletAddress: string;
  deletedFields: string[];
  retainedFields: string[];
  completedAt: Date;
}

/** Fields that CAN be erased (off-chain only). */
const ERASABLE_FIELDS = [
  "email",
  "notification_subscriptions",
  "portfolio_cache",
  "preferences",
] as const;

/** On-chain / compliance data that is always retained. */
const RETAINED_FIELDS = [
  "wallet_address",
  "transaction_hashes",
  "vault_positions",
  "yield_calculations",
  "audit_logs",
];

// ─── Redis helpers ─────────────────────────────────────────────────────────────

function portfolioCacheKey(address: string): string {
  return `${NS.API}:portfolio:${address.toLowerCase()}`;
}

function notificationSubKey(address: string): string {
  return `notifications:subs:${address.toLowerCase()}`;
}

function userPrefsKey(address: string): string {
  return `user:prefs:${address.toLowerCase()}`;
}

function userEmailKey(address: string): string {
  return `user:email:${address.toLowerCase()}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Create a new erasure request record.
 * Returns the numeric request ID.
 *
 * In a real deployment this would INSERT into the `gdpr_erasure_requests`
 * Postgres table via pg / Prisma / Drizzle.  Here we store a lightweight
 * record in Redis so the service is self-contained without a DB connection
 * in this standalone module.
 */
export async function createErasureRequest(
  walletAddress: string,
  requestIp?: string
): Promise<{ requestId: number; alreadyPending: boolean }> {
  const redis = getRedis();
  const addrKey = walletAddress.toLowerCase();
  const existingKey = `gdpr:pending:${addrKey}`;

  const existing = await redis.get(existingKey);
  if (existing) {
    return { requestId: Number(existing), alreadyPending: true };
  }

  // Auto-incrementing ID stored in Redis (mirrors DB sequence in production)
  const requestId = await redis.incr("gdpr:id_seq");

  const record = {
    id: requestId,
    walletAddress,
    requestedAt: new Date().toISOString(),
    status: "pending",
    requestIp: requestIp ?? null,
    deletedFields: [],
    confirmationEmailSent: false,
  };

  const requestKey = `gdpr:request:${requestId}`;
  // 90-day retention for compliance
  const ttl = 90 * 24 * 60 * 60;

  await Promise.all([
    redis.set(requestKey, JSON.stringify(record), "EX", ttl),
    redis.set(existingKey, String(requestId), "EX", 32 * 24 * 60 * 60), // 32 days guard
  ]);

  // Audit log entry
  await appendAuditLog(redis, requestId, "request_created", "user", {
    walletAddress,
    requestIp: requestIp ?? null,
  });

  return { requestId, alreadyPending: false };
}

/**
 * Execute the actual data erasure for a given request ID.
 * Safe to call multiple times (idempotent).
 */
export async function executeErasure(
  requestId: number,
  userEmail?: string
): Promise<ErasureResult> {
  const redis = getRedis();
  const requestKey = `gdpr:request:${requestId}`;

  const raw = await redis.get(requestKey);
  if (!raw) {
    throw new Error(`Erasure request ${requestId} not found`);
  }

  const record = JSON.parse(raw) as ErasureRequest & {
    requestedAt: string;
    requestIp?: string;
  };

  if (record.status === "completed") {
    return {
      requestId,
      walletAddress: record.walletAddress,
      deletedFields: record.deletedFields,
      retainedFields: RETAINED_FIELDS,
      completedAt: record.completedAt ? new Date(record.completedAt) : new Date(),
    };
  }

  const address = record.walletAddress.toLowerCase();

  // Mark as processing
  record.status = "processing";
  await redis.set(requestKey, JSON.stringify(record), "KEEPTTL");
  await appendAuditLog(redis, requestId, "erasure_started", "system", {});

  const deletedFields: string[] = [];

  // 1. Erase email (Redis user profile key)
  const emailKey = userEmailKey(address);
  const emailExists = await redis.exists(emailKey);
  if (emailExists) {
    await redis.del(emailKey);
    deletedFields.push("email");
    await appendAuditLog(redis, requestId, "field_erased", "system", { field: "email" });
  }

  // 2. Erase notification subscriptions
  const subKey = notificationSubKey(address);
  const subExists = await redis.exists(subKey);
  if (subExists) {
    await redis.del(subKey);
    deletedFields.push("notification_subscriptions");
    await appendAuditLog(redis, requestId, "field_erased", "system", {
      field: "notification_subscriptions",
    });
  }

  // 3. Erase email unsubscribe record (so email is fully removed from our systems)
  if (userEmail) {
    await redis.del(`${NS.EMAIL_UNSUBSCRIBED}:${userEmail.toLowerCase()}`);
    deletedFields.push("email_unsubscribe_record");
  }

  // 4. Erase portfolio history cache
  const portfolioKey = portfolioCacheKey(address);
  const portfolioExists = await redis.exists(portfolioKey);
  if (portfolioExists) {
    await redis.del(portfolioKey);
    deletedFields.push("portfolio_cache");
    await appendAuditLog(redis, requestId, "field_erased", "system", {
      field: "portfolio_cache",
    });
  }

  // 5. Erase preferences
  const prefsKey = userPrefsKey(address);
  const prefsExists = await redis.exists(prefsKey);
  if (prefsExists) {
    await redis.del(prefsKey);
    deletedFields.push("preferences");
    await appendAuditLog(redis, requestId, "field_erased", "system", { field: "preferences" });
  }

  const completedAt = new Date();

  // Update record to completed
  record.status = "completed";
  record.completedAt = completedAt as unknown as Date;
  record.deletedFields = deletedFields;
  record.confirmationEmailSent = false;
  await redis.set(requestKey, JSON.stringify(record), "KEEPTTL");

  // Remove the "pending" guard key
  await redis.del(`gdpr:pending:${address}`);

  await appendAuditLog(redis, requestId, "erasure_completed", "system", {
    deletedFields,
    retainedFields: RETAINED_FIELDS,
  });

  // Send confirmation email if we have the user's email address
  if (userEmail) {
    try {
      await enqueueEmail({
        to: userEmail,
        template: "gdpr-erasure-confirmation",
        data: {
          walletAddress: record.walletAddress,
          requestId: String(requestId),
          completedAt: completedAt.toISOString(),
          deletedFields,
          retainedFields: RETAINED_FIELDS,
          supportUrl: `${process.env.APP_BASE_URL ?? "https://auravault.io"}/support`,
        },
        subject: "Your data erasure request has been completed — Aura Vault",
        priority: "high",
      });
      record.confirmationEmailSent = true;
      await redis.set(requestKey, JSON.stringify(record), "KEEPTTL");
    } catch (err) {
      console.error("[GdprService] confirmation email failed:", err);
    }
  }

  return {
    requestId,
    walletAddress: record.walletAddress,
    deletedFields,
    retainedFields: RETAINED_FIELDS,
    completedAt,
  };
}

/**
 * Retrieve an erasure request record.
 */
export async function getErasureRequest(requestId: number): Promise<ErasureRequest | null> {
  const raw = await getRedis().get(`gdpr:request:${requestId}`);
  if (!raw) return null;
  return JSON.parse(raw) as ErasureRequest;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

async function appendAuditLog(
  redis: ReturnType<typeof getRedis>,
  requestId: number,
  action: string,
  actor: string,
  detail: Record<string, unknown>
): Promise<void> {
  const logKey = `gdpr:audit:${requestId}`;
  const entry = JSON.stringify({ action, actor, detail, ts: new Date().toISOString() });
  await redis.rpush(logKey, entry);
  await redis.expire(logKey, 365 * 24 * 60 * 60); // 1-year retention
}

export { ERASABLE_FIELDS, RETAINED_FIELDS };
