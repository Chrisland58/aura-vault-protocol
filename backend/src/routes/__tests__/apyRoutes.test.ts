/**
 * Tests for APY history endpoint  (Issue #529)
 *
 * Uses vitest + supertest.  The APY service is mocked so tests are fast
 * and do not require Redis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../index.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../middleware/authMiddleware.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middleware/rateLimitMiddleware.js", () => ({
  userRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  authRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  globalIpRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const MOCK_VAULT_ID = "00000000-0000-0000-0000-000000000001";

const makeDataPoints = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.now() - i * 3600_000).toISOString(),
    apy7d: 0.085 + i * 0.0001,
    apy30d: 0.082 + i * 0.0001,
  }));

vi.mock("../../services/apyHistoryService.js", () => ({
  getApyHistory: vi.fn(async (vaultId: string, period: string) => ({
    vaultId,
    period,
    resolution: period === "7d" ? "hourly" : "daily",
    dataPoints: period === "7d" ? makeDataPoints(168) : makeDataPoints(30),
  })),
  isValidPeriod: (p: unknown) =>
    typeof p === "string" && ["7d", "30d", "90d", "1y"].includes(p),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/vault/apy/history", () => {
  it("returns 200 with dataPoints array for default period", async () => {
    const res = await request(app)
      .get("/api/vault/apy/history")
      .set("Authorization", "Bearer test");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.dataPoints)).toBe(true);
    expect(res.body.dataPoints.length).toBeGreaterThan(0);
  });

  it("dataPoints contain timestamp, apy7d, apy30d", async () => {
    const res = await request(app)
      .get("/api/vault/apy/history?period=30d")
      .set("Authorization", "Bearer test");

    expect(res.status).toBe(200);
    const dp = res.body.dataPoints[0];
    expect(dp).toHaveProperty("timestamp");
    expect(dp).toHaveProperty("apy7d");
    expect(dp).toHaveProperty("apy30d");
    expect(typeof dp.apy7d).toBe("number");
    expect(typeof dp.apy30d).toBe("number");
  });

  it("7d period returns hourly resolution", async () => {
    const res = await request(app)
      .get("/api/vault/apy/history?period=7d")
      .set("Authorization", "Bearer test");

    expect(res.status).toBe(200);
    expect(res.body.resolution).toBe("hourly");
    expect(res.body.dataPoints).toHaveLength(168); // 7 * 24
  });

  it("30d period returns daily resolution", async () => {
    const res = await request(app)
      .get("/api/vault/apy/history?period=30d")
      .set("Authorization", "Bearer test");

    expect(res.status).toBe(200);
    expect(res.body.resolution).toBe("daily");
    expect(res.body.dataPoints).toHaveLength(30);
  });

  it("returns 400 for invalid period", async () => {
    const res = await request(app)
      .get("/api/vault/apy/history?period=5d")
      .set("Authorization", "Bearer test");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/7d.*30d.*90d.*1y/i);
  });

  it("all valid periods are accepted: 7d, 30d, 90d, 1y", async () => {
    for (const period of ["7d", "30d", "90d", "1y"]) {
      const res = await request(app)
        .get(`/api/vault/apy/history?period=${period}`)
        .set("Authorization", "Bearer test");
      expect(res.status).toBe(200);
    }
  });

  it("response includes vaultId and period", async () => {
    const res = await request(app)
      .get(`/api/vault/apy/history?period=7d&vaultId=${MOCK_VAULT_ID}`)
      .set("Authorization", "Bearer test");

    expect(res.status).toBe(200);
    expect(res.body.vaultId).toBe(MOCK_VAULT_ID);
    expect(res.body.period).toBe("7d");
  });

  it("sets Cache-Control header", async () => {
    const res = await request(app)
      .get("/api/vault/apy/history?period=30d")
      .set("Authorization", "Bearer test");

    expect(res.headers["cache-control"]).toMatch(/max-age=300/);
  });

  it("returns empty dataPoints array (not error) for empty data", async () => {
    const { getApyHistory } = await import("../../services/apyHistoryService.js");
    (getApyHistory as any).mockResolvedValueOnce({
      vaultId: MOCK_VAULT_ID,
      period: "1y",
      resolution: "daily",
      dataPoints: [],
    });

    const res = await request(app)
      .get("/api/vault/apy/history?period=1y")
      .set("Authorization", "Bearer test");

    expect(res.status).toBe(200);
    expect(res.body.dataPoints).toEqual([]);
  });
});
