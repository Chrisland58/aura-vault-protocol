/**
 * Tests for loggingMiddleware — Issue #319
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { redactSensitiveFields, writeLog } from "./loggingMiddleware.js";
import type { RequestLogEntry } from "./loggingMiddleware.js";

// ---------------------------------------------------------------------------
// redactSensitiveFields
// ---------------------------------------------------------------------------

describe("redactSensitiveFields", () => {
  it("redacts password field", () => {
    const result = redactSensitiveFields({ password: "secret123", name: "Alice" }) as Record<string, unknown>;
    expect(result.password).toBe("[REDACTED]");
    expect(result.name).toBe("Alice");
  });

  it("redacts token field (case-insensitive key)", () => {
    const result = redactSensitiveFields({ Token: "abc", AccessToken: "xyz" }) as Record<string, unknown>;
    expect(result.Token).toBe("[REDACTED]");
    expect(result.AccessToken).toBe("[REDACTED]");
  });

  it("redacts nested sensitive fields", () => {
    const result = redactSensitiveFields({
      user: { password: "pw", email: "a@b.com" },
    }) as Record<string, unknown>;
    const user = result.user as Record<string, unknown>;
    expect(user.password).toBe("[REDACTED]");
    expect(user.email).toBe("a@b.com");
  });

  it("leaves non-sensitive fields unchanged", () => {
    const input = { amount: 100, walletAddress: "GABC", type: "deposit" };
    const result = redactSensitiveFields(input);
    expect(result).toEqual(input);
  });

  it("handles arrays", () => {
    const result = redactSensitiveFields([
      { password: "pw" },
      { name: "Bob" },
    ]) as Array<Record<string, unknown>>;
    expect(result[0].password).toBe("[REDACTED]");
    expect(result[1].name).toBe("Bob");
  });

  it("returns primitives unchanged", () => {
    expect(redactSensitiveFields("hello")).toBe("hello");
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields(null)).toBe(null);
  });

  it("redacts authorization header value", () => {
    const result = redactSensitiveFields({ authorization: "Bearer token123" }) as Record<string, unknown>;
    expect(result.authorization).toBe("[REDACTED]");
  });

  it("redacts apikey and api_key", () => {
    const result = redactSensitiveFields({ apikey: "key1", api_key: "key2" }) as Record<string, unknown>;
    expect(result.apikey).toBe("[REDACTED]");
    expect(result.api_key).toBe("[REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// writeLog — format validation
// ---------------------------------------------------------------------------

describe("writeLog", () => {
  let writtenLines: string[];

  beforeEach(() => {
    writtenLines = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      writtenLines.push(typeof data === "string" ? data : data.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a single JSON line ending with newline", () => {
    const entry: RequestLogEntry = {
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "info",
      correlationId: "test-id",
      method: "GET",
      path: "/api/health",
      statusCode: 200,
      durationMs: 12,
      requestBodyHash: null,
      responseSize: 42,
    };
    writeLog(entry);
    expect(writtenLines).toHaveLength(1);
    expect(writtenLines[0]).toMatch(/\n$/);
  });

  it("produces valid JSON with required Loki label fields", () => {
    const entry: RequestLogEntry = {
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "error",
      correlationId: "corr-123",
      method: "POST",
      path: "/api/vault/deposit",
      statusCode: 500,
      durationMs: 5,
      requestBodyHash: "abcdef",
      responseSize: 0,
    };
    writeLog(entry);
    const parsed = JSON.parse(writtenLines[0].trim());
    expect(parsed).toMatchObject({
      timestamp: expect.any(String),
      level: "error",
      correlationId: "corr-123",
      method: "POST",
      path: "/api/vault/deposit",
      statusCode: 500,
      durationMs: expect.any(Number),
      requestBodyHash: "abcdef",
      responseSize: 0,
    });
  });

  it("includes errorStack in error entries", () => {
    const entry: RequestLogEntry = {
      timestamp: new Date().toISOString(),
      level: "error",
      correlationId: "err-id",
      method: "GET",
      path: "/api/fail",
      statusCode: 500,
      durationMs: 1,
      requestBodyHash: null,
      responseSize: 0,
      errorMessage: "Something blew up",
      errorStack: "Error: Something blew up\n    at foo (bar.ts:10:5)",
    };
    writeLog(entry);
    const parsed = JSON.parse(writtenLines[0].trim());
    expect(parsed.errorMessage).toBe("Something blew up");
    expect(parsed.errorStack).toContain("bar.ts");
  });
});
