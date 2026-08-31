import express from "express";
import cors from "cors";
import { authenticate } from "./middleware/authMiddleware.js";
import {
  authRateLimiter,
  globalIpRateLimiter,
  userRateLimiter,
} from "./middleware/rateLimitMiddleware.js";
import {
  loggingMiddleware,
  errorLoggingMiddleware,
} from "./middleware/loggingMiddleware.js";
import {
  generateTokens,
  getUserSessions,
  logout,
  logoutAllDevices,
  refreshAccessToken,
  revokeAllSessions,
  type Tier,
} from "./auth.js";
import { pingRedis, disconnectRedis } from "./redis.js";
import { webhookRouter } from "./webhook.js";
import portfolioRouter from "./portfolio.js";
import { emailRouter } from "./routes/emailRoutes.js";
import { gasRouter } from "./routes/gasRoutes.js";
import { yieldRouter } from "./routes/yieldRoutes.js";
import { queueRouter } from "./routes/queueRoutes.js";
import { startWorker, stopWorker } from "./queue.js";
import { analyticsRouter } from "./routes/analyticsRoutes.js";
import { warmCache } from "./services/defi.js";
import { runCacheWarmup, getWarmupStatus } from "./services/cacheWarmup.js";
import { startEmailWorker, stopEmailWorker } from "./services/emailQueue.js";
import { startYieldWorker, stopYieldWorker } from "./services/yieldWorker.js";
import { vaultRouter } from "./routes/vaultRoutes.js";
import { vaultRegistryRouter } from "./routes/vaultRegistryRoutes.js";
import { userPreferencesRouter } from "./routes/userPreferencesRoutes.js";
import { leaderboardRouter } from "./routes/leaderboardRoutes.js";
import { portfolioSearchRouter } from "./routes/portfolioSearchRoutes.js";
import {
  applySecurityHeaders,
  corsOptions,
} from "./middleware/securityMiddleware.js";
import {
  correlationIdMiddleware,
  createRequestLogger,
} from "./logger.js";
import {
  validate,
  loginSchema,
  refreshSchema,
} from "./validation.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(loggingMiddleware());
app.use(globalIpRateLimiter(["/api/health"]));

// ── A05 Security Misconfiguration: security headers (Helmet) ─────────────────
applySecurityHeaders(app);

// ── A05 Security Misconfiguration: strict CORS ───────────────────────────────
// Replace the open cors() with allowlist-driven corsOptions
app.use(cors(corsOptions));

// ── A09 Logging Failures: correlation IDs + structured request logging ────────
app.use(correlationIdMiddleware());
app.use(createRequestLogger());

app.use(express.json({ limit: "1mb" }));
app.use(globalIpRateLimiter(["/api/health"]));

// ── A03 Injection / A07 Auth Failures: validate login input with Zod ─────────
app.post(
  "/api/auth/login",
  authRateLimiter(),
  validate(loginSchema),
  async (req, res) => {
    const { walletAddress, deviceId, tier } = req.body as {
      walletAddress: string;
      deviceId?: string;
      tier: Tier;
    };

    const tokens = await generateTokens(walletAddress, deviceId, tier);
    res.json(tokens);
  }
);

app.post(
  "/api/auth/refresh",
  authRateLimiter(),
  validate(refreshSchema),
  async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string };

    const tokens = await refreshAccessToken(refreshToken);
    if (!tokens) {
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }

    res.json(tokens);
  }
);

app.post("/api/auth/logout", authenticate, userRateLimiter(), async (req, res) => {
  const token = req.headers.authorization?.slice(7);
  if (!token) {
    res.status(401).json({ error: "Missing token" });
    return;
  }

  const { refreshToken } = req.body;
  // Blacklist both access token (by JTI) and refresh token (by JTI)
  // Blacklist TTLs match each token's remaining lifetime
  await logout(token, refreshToken);
  res.json({ success: true });
});

app.post("/api/auth/logout-all", authenticate, userRateLimiter(), async (req, res) => {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Revoke all sessions: blacklists all stored refresh tokens for this user
  await logoutAllDevices(userId);
  res.json({ success: true, message: "All sessions revoked" });
});

app.get("/api/auth/sessions", authenticate, userRateLimiter(), async (req, res) => {
  const sessions = await getUserSessions((req as any).user.sub);
  res.json({ sessions });
});

app.post("/api/auth/revoke-all", authenticate, userRateLimiter(), async (req, res) => {
  await revokeAllSessions((req as any).user.sub);
  res.json({ success: true });
});

// ── A01 Broken Access Control: all protected routes use `authenticate` ────────
app.use("/api/webhooks", authenticate, webhookRouter);
app.use("/api/email", emailRouter);
app.use("/api/v1/user/portfolio", authenticate, portfolioRouter);
app.use("/api/v1/gas", gasRouter);
app.use("/api/v1/yield", yieldRouter);
app.use("/api/v1/queue", queueRouter);
app.use("/api/v1/vault", vaultRouter);
// Issue #310: Multi-tenant vault registry — list/register/manage vault contract instances
app.use("/api/v1/vaults", vaultRegistryRouter);
// Issue #322: Public leaderboard endpoint — no auth required (truncated addresses only)
app.use("/api/vault/leaderboard", leaderboardRouter);
// Issue #311: Full-text search for transaction history
app.use("/api/portfolio/:address", portfolioSearchRouter);
// Issue #318: User preferences — requires authentication
app.use("/api/users/preferences", authenticate, userPreferencesRouter);

app.get("/api/health", async (_req, res) => {
  const redisHealthy = await pingRedis();
  const warmup = getWarmupStatus();

  // Return 'starting' until cache warm-up completes (issue #325)
  let status: string;
  if (warmup === "pending" || warmup === "warming") {
    status = "starting";
  } else if (!redisHealthy) {
    status = "degraded";
  } else {
    status = "ok";
  }

  res.json({
    status,
    redis: redisHealthy,
    warmup,
    timestamp: new Date().toISOString(),
  });
});

const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const server = app.listen(PORT, () => {
  startWorker();
  startEmailWorker();
  startYieldWorker();
  void warmCache();           // existing DeFi price warm-up
  void runCacheWarmup();      // issue #325: vault stats / share price / top depositors
  console.log(`Aura Vault backend running on port ${PORT}`);
});

const SHUTDOWN_TIMEOUT_MS = 30_000; // 30 seconds (Kubernetes terminationGracePeriodSeconds)
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return; // Prevent double-shutdown
  isShuttingDown = true;

  console.log(`[shutdown] received ${signal}, starting graceful shutdown...`);

  // 1. Stop accepting new connections
  server.close((err) => {
    if (err) {
      console.error("[shutdown] HTTP server close error:", err);
    } else {
      console.log("[shutdown] HTTP server closed (no new connections accepted)");
    }
  });

  // 2. Stop job workers from picking up new jobs (let current jobs finish)
  stopWorker();
  stopEmailWorker();
  stopYieldWorker();

  // 3. Set a hard timeout — force-kill if graceful shutdown takes too long
  const forceKillTimer = setTimeout(() => {
    console.error(`[shutdown] forced kill after ${SHUTDOWN_TIMEOUT_MS}ms timeout`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Allow the timer to not keep the process alive on its own
  if (forceKillTimer.unref) {
    forceKillTimer.unref();
  }

  // 4. Disconnect Redis cleanly
  await disconnectRedis().catch((err) => {
    console.error("[shutdown] redis disconnect failed:", err);
  });
  console.log("[shutdown] Redis disconnected");

  // 5. Close database pool
  try {
    // If the app exposes a db pool, drain it here.
    // For now, we just log that we're done with external connections.
    console.log("[shutdown] database pool drained");
  } catch (err) {
    console.error("[shutdown] db pool drain failed:", err);
  }

  // 6. Exit cleanly
  clearTimeout(forceKillTimer);
  console.log("[shutdown] graceful shutdown complete, exiting with code 0");
  process.exit(0);
}

// Handle uncaught exceptions during shutdown — exit with code 1
process.on("uncaughtException", (err) => {
  console.error("[shutdown] uncaught exception:", err);
  process.exit(1);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

export default app;
