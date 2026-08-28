# Cache Layer Tests — Testcontainers Integration Note

## Current approach

`cache.test.ts` uses a **mocked Redis client** (vitest `vi.mock('ioredis')`) so the
tests run in any environment without an external Redis server. All cache
behaviours (hit, miss, TTL, invalidation, unavailability fallback) are covered
via mock implementations.

## Real Redis with Testcontainers

For integration tests against a real Redis instance, use
[`@testcontainers/redis`](https://node.testcontainers.org/modules/redis/).

### Install

```bash
npm install --save-dev @testcontainers/redis testcontainers
```

### Example integration test (cache.integration.test.ts)

```ts
import { RedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import { cacheGet, cacheSet, cacheDel } from "./cache.js";

let container: Awaited<ReturnType<typeof new RedisContainer().start>>;
let client: Redis;

beforeAll(async () => {
  container = await new RedisContainer().start();
  // Override the singleton so cache.ts uses our container
  client = new Redis(container.getConnectionUrl());
  // Inject client into the module (requires exporting setRedisClient or
  // restructuring redis.ts to accept a client override in tests)
}, 30_000);

afterAll(async () => {
  await client.quit();
  await container.stop();
});

it("cache miss → fetches from source and stores in cache", async () => {
  const result = await cacheGet("api", "test-key");
  expect(result).toBeNull(); // miss

  await cacheSet("api", "test-key", { value: 42 }, 60);

  const hit = await cacheGet("api", "test-key");
  expect(hit).toEqual({ value: 42 }); // hit
});

it("harvest event invalidates vault stats cache", async () => {
  await cacheSet("yield:stats", "vault:main", { apy: 0.08 }, 60);
  await cacheDel("yield:stats", "vault:main"); // harvest invalidation
  const result = await cacheGet("yield:stats", "vault:main");
  expect(result).toBeNull();
});
```

### When to run

The integration test suite is intended to run:

- In CI on PRs that touch `backend/src/cache.ts` or `backend/src/redis.ts`
- Before production releases

The mock-based tests in `cache.test.ts` run on every CI build (fast, no infra
required).

## Why mocks for the main test file

- **Speed**: mocked tests complete in milliseconds vs. ~5 s for container startup
- **Portability**: run anywhere without Docker
- **Isolation**: each test controls exact Redis responses, including error paths
  that are difficult to trigger against a real server
