/**
 * Tests for GDPR right-to-erasure endpoint  (Issue #532)
 *
 * Uses vitest + supertest.  Redis and auth are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../index.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock authentication middleware — injects user sub from header
vi.mock("../../middleware/authMiddleware.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    const sub = req.headers["x-test-wallet"] as string | undefined;
    req.user = { sub: sub ?? "GTEST123" };
    next();
  },
}));

// Mock rate-limiter to be a no-op
vi.mock("../../middleware/rateLimitMiddleware.js", () => ({
  userRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  authRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  globalIpRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock Redis-backed GDPR service
vi.mock("../../services/gdprService.js", () => {
  const store = new Map<number, any>();
  let seq = 0;

  return {
    createErasureRequest: vi.fn(async (walletAddress: string) => {
      const id = ++seq;
      store.set(id, {
        id,
        walletAddress,
        requestedAt: new Date(),
        deadlineAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: "pending",
        completedAt: null,
        deletedFields: [],
        confirmationEmailSent: false,
        notes: null,
      });
      return { requestId: id, alreadyPending: false };
    }),

    executeErasure: vi.fn(async (requestId: number, userEmail?: string) => {
      const rec = store.get(requestId);
      const completedAt = new Date();
      if (rec) {
        rec.status = "completed";
        rec.completedAt = completedAt;
        rec.deletedFields = ["email", "notification_subscriptions", "portfolio_cache", "preferences"];
        rec.confirmationEmailSent = !!userEmail;
      }
      return {
        requestId,
        walletAddress: rec?.walletAddress ?? "GTEST",
        deletedFields: ["email", "notification_subscriptions", "portfolio_cache", "preferences"],
        retainedFields: ["wallet_address", "transaction_hashes", "vault_positions"],
        completedAt,
      };
    }),

    getErasureRequest: vi.fn(async (requestId: number) => {
      return store.get(requestId) ?? null;
    }),

    RETAINED_FIELDS: ["wallet_address", "transaction_hashes", "vault_positions"],
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

const WALLET = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KUYGLNZSX";

describe("DELETE /api/users/:address  (GDPR erasure)", () => {
  it("returns 200 and deletedFields on success", async () => {
    const res = await request(app)
      .delete(`/api/users/${WALLET}`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET)
      .send({ email: "user@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeTypeOf("number");
    expect(Array.isArray(res.body.deletedFields)).toBe(true);
    expect(res.body.deletedFields).toContain("email");
    expect(res.body.deletedFields).toContain("portfolio_cache");
  });

  it("retains on-chain fields", async () => {
    const res = await request(app)
      .delete(`/api/users/${WALLET}`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET)
      .send({});

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.retainedFields)).toBe(true);
    expect(res.body.retainedFields).toContain("transaction_hashes");
    expect(res.body.retainedFields).toContain("vault_positions");
    expect(res.body.retainedFields).toContain("wallet_address");
  });

  it("returns 403 when address does not match authenticated user", async () => {
    const OTHER = "GOTHER000";
    const res = await request(app)
      .delete(`/api/users/${OTHER}`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET) // authenticated as WALLET, not OTHER
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/own data/i);
  });

  it("returns completedAt timestamp", async () => {
    const res = await request(app)
      .delete(`/api/users/${WALLET}`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.completedAt).toBeTypeOf("string");
    expect(() => new Date(res.body.completedAt)).not.toThrow();
  });

  it("sets confirmationEmailSent true when email provided", async () => {
    const res = await request(app)
      .delete(`/api/users/${WALLET}`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET)
      .send({ email: "user@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.confirmationEmailSent).toBe(true);
  });

  it("includes regulatoryNote in response", async () => {
    const res = await request(app)
      .delete(`/api/users/${WALLET}`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.regulatoryNote).toBeTypeOf("string");
  });
});

describe("GET /api/users/:address/erasure/:requestId  (status poll)", () => {
  it("returns 404 for unknown requestId", async () => {
    const res = await request(app)
      .get(`/api/users/${WALLET}/erasure/9999`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET);

    expect(res.status).toBe(404);
  });

  it("returns 400 for non-numeric requestId", async () => {
    const res = await request(app)
      .get(`/api/users/${WALLET}/erasure/abc`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET);

    expect(res.status).toBe(400);
  });

  it("returns status after creation", async () => {
    // First create a request
    const del = await request(app)
      .delete(`/api/users/${WALLET}`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET)
      .send({});

    const { requestId } = del.body;

    const res = await request(app)
      .get(`/api/users/${WALLET}/erasure/${requestId}`)
      .set("Authorization", "Bearer test")
      .set("x-test-wallet", WALLET);

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(requestId);
    expect(res.body.status).toBeTypeOf("string");
    expect(Array.isArray(res.body.retainedFields)).toBe(true);
  });
});
