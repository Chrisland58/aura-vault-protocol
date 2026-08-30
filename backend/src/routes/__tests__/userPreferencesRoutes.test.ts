/**
 * Tests for User Preferences API — Issue #318
 *
 * GET  /api/users/preferences  → return preferences (defaults on first GET)
 * PATCH /api/users/preferences → merge-update preferences
 *
 * Uses vitest + supertest.  The DB service and auth middleware are mocked so
 * tests run fast without a real database or JWT infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../index.js";

// ─── Mock auth middleware ─────────────────────────────────────────────────────
// Bypass JWT verification; inject a deterministic subject.

const MOCK_WALLET = "GABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZA567BCD";

vi.mock("../../middleware/authMiddleware.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { sub: MOCK_WALLET };
    next();
  },
}));

vi.mock("../../middleware/rateLimitMiddleware.js", () => ({
  userRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  authRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  globalIpRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

// ─── Mock the preferences service ────────────────────────────────────────────

const DEFAULT_PREFS = {
  address: MOCK_WALLET,
  currency: "USD",
  language: "en",
  emailNotifications: true,
  harvestAlerts: true,
};

const mockGetUserPreferences = vi.fn(async (_address: string) => ({ ...DEFAULT_PREFS }));
const mockUpdateUserPreferences = vi.fn(
  async (_address: string, updates: Record<string, unknown>) => ({
    ...DEFAULT_PREFS,
    ...updates,
  })
);

vi.mock("../../services/userPreferencesService.js", () => ({
  getUserPreferences: mockGetUserPreferences,
  updateUserPreferences: mockUpdateUserPreferences,
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/users/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserPreferences.mockResolvedValue({ ...DEFAULT_PREFS });
  });

  it("returns 200 with default preferences", async () => {
    const res = await request(app)
      .get("/api/users/preferences")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      address: MOCK_WALLET,
      currency: "USD",
      language: "en",
      emailNotifications: true,
      harvestAlerts: true,
    });
  });

  it("calls getUserPreferences with the authenticated wallet address", async () => {
    await request(app)
      .get("/api/users/preferences")
      .set("Authorization", "Bearer test-token");

    expect(mockGetUserPreferences).toHaveBeenCalledOnce();
    expect(mockGetUserPreferences).toHaveBeenCalledWith(MOCK_WALLET);
  });

  it("returns all required schema fields", async () => {
    const res = await request(app)
      .get("/api/users/preferences")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("address");
    expect(res.body).toHaveProperty("currency");
    expect(res.body).toHaveProperty("language");
    expect(res.body).toHaveProperty("emailNotifications");
    expect(res.body).toHaveProperty("harvestAlerts");
  });

  it("returns 500 when the service throws", async () => {
    mockGetUserPreferences.mockRejectedValueOnce(new Error("DB down"));

    const res = await request(app)
      .get("/api/users/preferences")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PATCH /api/users/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserPreferences.mockResolvedValue({ ...DEFAULT_PREFS });
    mockUpdateUserPreferences.mockImplementation(
      async (_address: string, updates: Record<string, unknown>) => ({
        ...DEFAULT_PREFS,
        ...updates,
      })
    );
  });

  it("returns 200 with updated preferences when patching currency", async () => {
    mockUpdateUserPreferences.mockResolvedValueOnce({
      ...DEFAULT_PREFS,
      currency: "EUR",
    });

    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ currency: "EUR" });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("EUR");
  });

  it("returns 200 when patching language", async () => {
    mockUpdateUserPreferences.mockResolvedValueOnce({
      ...DEFAULT_PREFS,
      language: "fr",
    });

    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ language: "fr" });

    expect(res.status).toBe(200);
    expect(res.body.language).toBe("fr");
  });

  it("returns 200 when patching emailNotifications to false", async () => {
    mockUpdateUserPreferences.mockResolvedValueOnce({
      ...DEFAULT_PREFS,
      emailNotifications: false,
    });

    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ emailNotifications: false });

    expect(res.status).toBe(200);
    expect(res.body.emailNotifications).toBe(false);
  });

  it("returns 200 when patching harvestAlerts to false", async () => {
    mockUpdateUserPreferences.mockResolvedValueOnce({
      ...DEFAULT_PREFS,
      harvestAlerts: false,
    });

    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ harvestAlerts: false });

    expect(res.status).toBe(200);
    expect(res.body.harvestAlerts).toBe(false);
  });

  it("returns 200 when patching multiple fields at once", async () => {
    mockUpdateUserPreferences.mockResolvedValueOnce({
      ...DEFAULT_PREFS,
      currency: "GBP",
      language: "de",
      harvestAlerts: false,
    });

    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ currency: "GBP", language: "de", harvestAlerts: false });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("GBP");
    expect(res.body.language).toBe("de");
    expect(res.body.harvestAlerts).toBe(false);
  });

  it("returns 200 with an empty patch body (no-op)", async () => {
    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(res.status).toBe(200);
  });

  it("returns 400 for unknown fields (strict schema)", async () => {
    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ unknown_field: "value" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when currency is too short", async () => {
    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ currency: "X" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when currency is too long", async () => {
    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ currency: "TOOLONGCURRENCYCODE" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when emailNotifications is not boolean", async () => {
    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ emailNotifications: "yes" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("calls updateUserPreferences with the authenticated wallet address", async () => {
    await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ currency: "JPY" });

    expect(mockUpdateUserPreferences).toHaveBeenCalledOnce();
    expect(mockUpdateUserPreferences).toHaveBeenCalledWith(
      MOCK_WALLET,
      expect.objectContaining({ currency: "JPY" })
    );
  });

  it("returns 500 when the service throws", async () => {
    mockUpdateUserPreferences.mockRejectedValueOnce(new Error("DB write failed"));

    const res = await request(app)
      .patch("/api/users/preferences")
      .set("Authorization", "Bearer test-token")
      .send({ currency: "EUR" });

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});
