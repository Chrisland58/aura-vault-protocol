/**
 * Idempotency Middleware Tests
 *
 * Acceptance Criteria:
 *  AC-1: Same key + same body  → cached response replayed (no duplicate processing)
 *  AC-2: Same key + diff body  → 422 Unprocessable Entity
 *  AC-3: Key expires after 24h → request treated as brand-new
 *  AC-4: Concurrent requests with same key → only one processed; second gets 409
 *  AC-5: No key                → each request processed independently
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import express, { Request, Response, Application } from "express";
import request from "supertest";
import crypto from "crypto";

// ─── Types for our fake Redis ─────────────────────────────────────────────────

interface FakeRedis {
  store: Map<string, { value: string; expiresAt: number | null }>;
  get: Mock;
  set: Mock;
  del: Mock;
  _now: () => number;
  _advance: (seconds: number) => void;
}

// ─── Fake Redis factory ───────────────────────────────────────────────────────
// We build a fresh fake for every test so state never leaks between tests.
function makeFakeRedis(): FakeRedis {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  let clock = Date.now();

  const fake: FakeRedis = {
    store,
    _now: () => clock,
    _advance: (seconds: number) => {
      clock += seconds * 1000;
    },

    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && clock > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),

    // Signature: set(key, value, "EX", ttl) or set(key, value, "EX", ttl, "NX")
    set: vi.fn(async (...args: unknown[]) => {
      const [key, value, , ttlArg, nxFlag] = args as [
        string,
        string,
        string,
        number,
        string?,
      ];
      const ttl = Number(ttlArg);
      const expiresAt = Number.isFinite(ttl) ? clock + ttl * 1000 : null;

      if (nxFlag === "NX") {
        const existing = store.get(key as string);
        const alive =
          existing &&
          (existing.expiresAt === null || clock <= existing.expiresAt);
        if (alive) return null; // NX: key already exists
        store.set(key as string, { value: value as string, expiresAt });
        return "OK";
      }

      store.set(key as string, { value: value as string, expiresAt });
      return "OK";
    }),

    del: vi.fn(async (key: string) => {
      const deleted = store.delete(key);
      return deleted ? 1 : 0;
    }),
  };

  return fake;
}

// ─── App factory ─────────────────────────────────────────────────────────────
// Builds a minimal Express app with the idempotency middleware and a single
// POST /test route that echoes the body back. We also inject a fake Redis so
// tests never touch a real Redis instance.
async function makeApp(
  fakeRedis: FakeRedis,
  routeHandler?: (req: Request, res: Response) => void,
  ttlSeconds?: number
): Promise<Application> {
  // Inject the fake Redis before the middleware module is imported
  vi.doMock("../../redis.js", () => ({
    getRedis: vi.fn(() => fakeRedis),
    pingRedis: vi.fn().mockResolvedValue(true),
    disconnectRedis: vi.fn().mockResolvedValue(undefined),
  }));

  // Dynamic import so the mock is picked up
  const { idempotencyMiddleware } = await import(
    "../idempotencyMiddleware.js"
  );

  const app = express();
  app.use(express.json());
  app.use(idempotencyMiddleware({ ttlSeconds }));

  const handler =
    routeHandler ??
    ((req: Request, res: Response) => {
      res.status(200).json({ echo: req.body, processedAt: Date.now() });
    });

  app.post("/test", handler);

  return app;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function responseKeyFor(idempotencyKey: string): string {
  return `idempotency:response:${sha256(idempotencyKey)}`;
}

function lockKeyFor(idempotencyKey: string): string {
  return `idempotency:lock:${sha256(idempotencyKey)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: Same key + same body → same response, no duplicate processing
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-1: Same key + same body → cached response replayed", () => {
  let fakeRedis: FakeRedis;
  let app: Application;

  beforeEach(async () => {
    vi.resetModules();
    fakeRedis = makeFakeRedis();
    app = await makeApp(fakeRedis);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns the same response body on the second call", async () => {
    const key = "key-ac1-same-body";
    const body = { amount: 100, to: "GWALLET1" };

    const first = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);

    expect(first.status).toBe(200);
    expect(first.body.echo).toEqual(body);

    // Allow the fire-and-forget Redis write to settle
    await new Promise((r) => setTimeout(r, 10));

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("sets X-Idempotency-Replayed: true on the replay response", async () => {
    const key = "key-ac1-replayed-header";
    const body = { amount: 50 };

    await request(app).post("/test").set("Idempotency-Key", key).send(body);
    await new Promise((r) => setTimeout(r, 10));

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);

    expect(second.headers["x-idempotency-replayed"]).toBe("true");
  });

  it("does not invoke the route handler a second time", async () => {
    const key = "key-ac1-no-double-process";
    const body = { transfer: 999 };
    let callCount = 0;

    const countingHandler = (req: Request, res: Response) => {
      callCount++;
      res.status(200).json({ count: callCount, echo: req.body });
    };

    vi.resetModules();
    const redis2 = makeFakeRedis();
    const app2 = await makeApp(redis2, countingHandler);

    await request(app2)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);
    await new Promise((r) => setTimeout(r, 10));

    await request(app2)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);

    // Route handler must only have been invoked once
    expect(callCount).toBe(1);
  });

  it("replays the original HTTP status code", async () => {
    const key = "key-ac1-status-replay";
    const body = { x: 1 };

    const createdHandler = (_req: Request, res: Response) => {
      res.status(201).json({ created: true });
    };

    vi.resetModules();
    const redis3 = makeFakeRedis();
    const app3 = await makeApp(redis3, createdHandler);

    const first = await request(app3)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);
    expect(first.status).toBe(201);

    await new Promise((r) => setTimeout(r, 10));

    const second = await request(app3)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);
    expect(second.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: Same key + different body → 422 Unprocessable Entity
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-2: Same key + different body → 422", () => {
  let fakeRedis: FakeRedis;
  let app: Application;

  beforeEach(async () => {
    vi.resetModules();
    fakeRedis = makeFakeRedis();
    app = await makeApp(fakeRedis);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns 422 when the body changes for the same key", async () => {
    const key = "key-ac2-mismatch";

    await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send({ amount: 100 });
    await new Promise((r) => setTimeout(r, 10));

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send({ amount: 200 }); // different body

    expect(second.status).toBe(422);
    expect(second.body.error).toMatch(/different request body/i);
  });

  it("returns 422 when extra fields are added to the body", async () => {
    const key = "key-ac2-extra-fields";

    await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send({ amount: 100 });
    await new Promise((r) => setTimeout(r, 10));

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send({ amount: 100, extra: "field" }); // structurally different

    expect(second.status).toBe(422);
  });

  it("does not set X-Idempotency-Replayed on a 422 response", async () => {
    const key = "key-ac2-no-replay-header";

    await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send({ val: 1 });
    await new Promise((r) => setTimeout(r, 10));

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send({ val: 2 });

    expect(second.status).toBe(422);
    expect(second.headers["x-idempotency-replayed"]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: Key expires after TTL → request treated as new
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-3: Key expires after TTL → treated as new request", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("processes the request again after the TTL window elapses", async () => {
    vi.resetModules();
    const fakeRedis = makeFakeRedis();
    // Use a short 1-second TTL for this test
    const app = await makeApp(fakeRedis, undefined, 1);

    const key = "key-ac3-expiry";
    const body = { amount: 42 };

    const first = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);
    expect(first.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));

    // Advance fake clock by 2 seconds so the TTL is exceeded
    fakeRedis._advance(2);

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);

    expect(second.status).toBe(200);
    // Second request was handled fresh — no replay header
    expect(second.headers["x-idempotency-replayed"]).toBeUndefined();
  });

  it("stores a new response after the old one expired", async () => {
    vi.resetModules();
    const fakeRedis = makeFakeRedis();
    const app = await makeApp(fakeRedis, undefined, 1);

    const key = "key-ac3-new-store";
    const body = { x: 7 };
    const rKey = responseKeyFor(key);

    await request(app).post("/test").set("Idempotency-Key", key).send(body);
    await new Promise((r) => setTimeout(r, 10));
    expect(fakeRedis.store.has(rKey)).toBe(true);

    // Expire the stored entry
    fakeRedis._advance(2);

    // Issue a new request — should store a fresh entry
    await request(app).post("/test").set("Idempotency-Key", key).send(body);
    await new Promise((r) => setTimeout(r, 10));

    // The entry was refreshed (re-created)
    expect(fakeRedis.store.has(rKey)).toBe(true);
    const stored = fakeRedis.store.get(rKey)!;
    // expiresAt should be in the future relative to current fake clock
    expect(stored.expiresAt).toBeGreaterThan(fakeRedis._now());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: Concurrent requests with same key → only one processed
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-4: Concurrent requests → only one processed, second gets 409", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns 409 for the second concurrent request", async () => {
    vi.resetModules();

    // Build a fake Redis where the lock is ALREADY set (simulates an in-flight request)
    const fakeRedis = makeFakeRedis();
    const app = await makeApp(fakeRedis);

    const key = "key-ac4-concurrent";
    const lockKey = lockKeyFor(key);

    // Pre-set the lock to simulate another request holding it
    fakeRedis.store.set(lockKey, {
      value: "1",
      expiresAt: fakeRedis._now() + 30_000,
    });

    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send({ amount: 5 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in progress/i);
  });

  it("allows a second request once the first completes and stores its response", async () => {
    vi.resetModules();
    const fakeRedis = makeFakeRedis();
    const app = await makeApp(fakeRedis);

    const key = "key-ac4-sequential";
    const body = { x: 10 };
    const rKey = responseKeyFor(key);

    // First request — completes and stores result
    const first = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);
    expect(first.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));

    // Lock should have been released, response should be stored
    expect(fakeRedis.store.has(lockKeyFor(key))).toBe(false);
    expect(fakeRedis.store.has(rKey)).toBe(true);

    // Second sequential request — should replay, not 409
    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);
    expect(second.status).toBe(200);
    expect(second.headers["x-idempotency-replayed"]).toBe("true");
  });

  it("simulates true concurrency: two parallel requests, one succeeds and one is rejected", async () => {
    vi.resetModules();

    // Strategy: pre-seed the lock key in the store before making requests.
    // This deterministically models the state where request-1 has acquired the
    // lock but not yet finished, and request-2 arrives while the lock is held.
    const fakeRedis = makeFakeRedis();
    const app = await makeApp(fakeRedis);

    const key = "key-ac4-parallel";
    const body = { transfer: 100 };
    const lKey = lockKeyFor(key);

    // Manually seed the lock as if a first request already acquired it
    fakeRedis.store.set(lKey, {
      value: "1",
      expiresAt: fakeRedis._now() + 30_000,
    });

    // Now issue a request — it should see the lock held and return 409
    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in progress/i);

    // Now simulate the first request finishing: remove the lock and store its result
    fakeRedis.store.delete(lKey);
    const rKey = responseKeyFor(key);
    fakeRedis.store.set(rKey, {
      value: JSON.stringify({
        status: 200,
        headers: {},
        body: { echo: body, processedAt: 1 },
        bodyHash: require('crypto').createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      }),
      expiresAt: fakeRedis._now() + 86_400_000,
    });

    // Third request with same key+body → replays the stored response
    const replay = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);
    expect(replay.status).toBe(200);
    expect(replay.headers["x-idempotency-replayed"]).toBe("true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: No key → each request processed independently
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-5: No idempotency key → every request processed independently", () => {
  let fakeRedis: FakeRedis;
  let app: Application;

  beforeEach(async () => {
    vi.resetModules();
    fakeRedis = makeFakeRedis();
    app = await makeApp(fakeRedis);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("processes each request without caching when no key is present", async () => {
    let callCount = 0;
    const countingHandler = (_req: Request, res: Response) => {
      callCount++;
      res.status(200).json({ callCount });
    };

    vi.resetModules();
    const redis2 = makeFakeRedis();
    const app2 = await makeApp(redis2, countingHandler);

    const r1 = await request(app2).post("/test").send({ x: 1 });
    const r2 = await request(app2).post("/test").send({ x: 1 });
    const r3 = await request(app2).post("/test").send({ x: 1 });

    expect(r1.body.callCount).toBe(1);
    expect(r2.body.callCount).toBe(2);
    expect(r3.body.callCount).toBe(3);
  });

  it("does not write to Redis when no key is present", async () => {
    await request(app).post("/test").send({ amount: 10 });
    await request(app).post("/test").send({ amount: 20 });

    // Neither a response record nor a lock should have been set
    expect(fakeRedis.set).not.toHaveBeenCalled();
    expect(fakeRedis.get).not.toHaveBeenCalled();
  });

  it("does not set X-Idempotency-Replayed when no key is supplied", async () => {
    const res = await request(app).post("/test").send({ a: 1 });
    expect(res.headers["x-idempotency-replayed"]).toBeUndefined();
  });

  it("ignores an empty-string Idempotency-Key header", async () => {
    let callCount = 0;
    const countingHandler = (_req: Request, res: Response) => {
      callCount++;
      res.status(200).json({ callCount });
    };

    vi.resetModules();
    const redis3 = makeFakeRedis();
    const app3 = await makeApp(redis3, countingHandler);

    await request(app3).post("/test").set("Idempotency-Key", "   ").send({ a: 1 });
    await request(app3).post("/test").set("Idempotency-Key", "   ").send({ a: 1 });

    // Whitespace-only key treated as absent — both requests must have been processed
    expect(callCount).toBe(2);
    expect(redis3.set).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("does not cache 5xx responses, allowing the client to retry", async () => {
    vi.resetModules();
    const fakeRedis = makeFakeRedis();
    const errorHandler = (_req: Request, res: Response) => {
      res.status(500).json({ error: "internal server error" });
    };
    const app = await makeApp(fakeRedis, errorHandler);

    const key = "key-edge-5xx";
    const body = { x: 1 };
    const rKey = responseKeyFor(key);

    const first = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);
    expect(first.status).toBe(500);

    await new Promise((r) => setTimeout(r, 10));

    // No response should be cached
    expect(fakeRedis.store.has(rKey)).toBe(false);

    // Second request should hit the route handler again (no replay)
    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", key)
      .send(body);
    expect(second.status).toBe(500);
    expect(second.headers["x-idempotency-replayed"]).toBeUndefined();
  });

  it("stores the response after a successful 201 Created", async () => {
    vi.resetModules();
    const fakeRedis = makeFakeRedis();
    const createdHandler = (_req: Request, res: Response) => {
      res.status(201).json({ id: "new-resource-123" });
    };
    const app = await makeApp(fakeRedis, createdHandler);

    const key = "key-edge-201";
    const body = { name: "vault" };
    const rKey = responseKeyFor(key);

    await request(app).post("/test").set("Idempotency-Key", key).send(body);
    await new Promise((r) => setTimeout(r, 10));

    expect(fakeRedis.store.has(rKey)).toBe(true);
    const stored = JSON.parse(fakeRedis.store.get(rKey)!.value);
    expect(stored.status).toBe(201);
    expect(stored.body).toEqual({ id: "new-resource-123" });
  });

  it("fails open (processes normally) when Redis is unavailable", async () => {
    vi.resetModules();

    // Redis that always throws
    const brokenRedis = {
      get: vi.fn().mockRejectedValue(new Error("connection refused")),
      set: vi.fn().mockRejectedValue(new Error("connection refused")),
      del: vi.fn().mockRejectedValue(new Error("connection refused")),
    };

    vi.doMock("../../redis.js", () => ({
      getRedis: vi.fn(() => brokenRedis),
      pingRedis: vi.fn().mockResolvedValue(false),
      disconnectRedis: vi.fn().mockResolvedValue(undefined),
    }));

    const { idempotencyMiddleware } = await import(
      "../idempotencyMiddleware.js"
    );
    const app = express();
    app.use(express.json());
    app.use(idempotencyMiddleware());
    app.post("/test", (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    });

    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-edge-fail-open")
      .send({ a: 1 });

    // Middleware must fail open — request still succeeds
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("different keys with the same body are treated independently", async () => {
    vi.resetModules();
    const fakeRedis = makeFakeRedis();
    let callCount = 0;
    const countingHandler = (_req: Request, res: Response) => {
      callCount++;
      res.status(200).json({ callCount });
    };
    const app = await makeApp(fakeRedis, countingHandler);

    const body = { amount: 50 };

    await request(app).post("/test").set("Idempotency-Key", "key-A").send(body);
    await new Promise((r) => setTimeout(r, 10));
    await request(app).post("/test").set("Idempotency-Key", "key-B").send(body);
    await new Promise((r) => setTimeout(r, 10));

    // Two distinct keys → route handler invoked twice
    expect(callCount).toBe(2);
  });
});
