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
  refreshAccessToken,
  revokeAllSessions,
  type Tier,
} from "./auth.js";
import { pingRedis, disconnectRedis } from "./redis.js";
import { webhookRouter } from "./webhook.js";
import { emailRouter } from "./routes/emailRoutes.js";
import { startWorker, stopWorker } from "./queue.js";
import { warmCache } from "./services/defi.js";
import { startEmailWorker, stopEmailWorker } from "./services/emailQueue.js";
import { startYieldWorker, stopYieldWorker } from "./services/yieldWorker.js";
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
import { v1Router } from "./routes/v1Router.js";
import { userPreferencesRouter } from "./routes/userPreferencesRoutes.js";
import { docsRouter } from "./routes/docsRoutes.js";
import { deprecationHeader, CURRENT_API_VERSION } from "./middleware/versionMiddleware.js";

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
  await logout(token, refreshToken);
  res.json({ success: true });
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

// ── API versioning ────────────────────────────────────────────────────────
// All v1 routes — versioned, response wrapped with { version: 'v1', data }
app.use("/api/v1", v1Router);

// /api/latest — always points to the current version (v1)
app.use("/api/latest", v1Router);

// Legacy unversioned preferences path — adds deprecation headers per RFC 8594
// Clients should migrate to /api/v1/users/preferences
app.use(
  "/api/users/preferences",
  deprecationHeader("2027-01-01"),
  authenticate,
  userPreferencesRouter
);

// API documentation endpoint
app.use("/api/docs", docsRouter);

app.get("/api/health", async (_req, res) => {
  const redisHealthy = await pingRedis();
  res.json({
    status: redisHealthy ? "ok" : "degraded",
    redis: redisHealthy,
    timestamp: new Date().toISOString(),
  });
});

const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const server = app.listen(PORT, () => {
  startWorker();
  startEmailWorker();
  startYieldWorker();
  void warmCache();
  console.log(`Aura Vault backend running on port ${PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] received ${signal}`);
  stopWorker();
  stopEmailWorker();
  stopYieldWorker();
  server.close(async () => {
    await disconnectRedis().catch((err) => {
      console.error("[shutdown] redis disconnect failed:", err);
    });
    process.exit(0);
  });
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

export default app;
