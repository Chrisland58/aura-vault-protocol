import express from "express";
import cors from "cors";
import { pingRedis } from "./redis.js";
import {
  generateTokens,
  validateAccessToken,
  refreshAccessToken,
  logout,
  getUserSessions,
  revokeAllSessions,
  type Tier,
} from "./auth.js";
import { webhookRouter } from "./webhook.js";
import portfolioRouter from "./portfolio.js";
import { emailRouter } from "./routes/emailRoutes.js";
import { vaultRouter } from "./routes/vaultRoutes.js";
import { authenticate } from "./middleware/authMiddleware.js";
import {
  globalIpRateLimiter,
  authRateLimiter,
  userRateLimiter,
} from "./middleware/rateLimitMiddleware.js";
import { startWorker } from "./queue.js";
import { warmCache } from "./services/defi.js";
import { startEmailWorker, stopEmailWorker } from "./services/emailQueue.js";

const app = express();
app.use(cors());
app.use(express.json());

// Global IP rate limiter — health check excluded so load-balancer probes are not throttled
app.use(globalIpRateLimiter(["/api/health"]));

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post("/api/auth/login", authRateLimiter(), async (req, res) => {
  const { walletAddress, deviceId, tier } = req.body;
  if (!walletAddress) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  const validTier: Tier = tier === "paid" ? "paid" : "free";
  const tokens = await generateTokens(walletAddress, deviceId, validTier);
  res.json(tokens);
});

app.post("/api/auth/refresh", authRateLimiter(), async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken required" });
    return;
  }
  const tokens = await refreshAccessToken(refreshToken);
  if (!tokens) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }
  res.json(tokens);
});

app.post("/api/auth/logout", authenticate, userRateLimiter(), async (req, res) => {
  const token = req.headers.authorization!.slice(7);
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

// Webhook management (authenticated)
app.use("/api/webhooks", authenticate, webhookRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Portfolio
app.use("/api/v1/user/portfolio", authenticate, portfolioRouter);

// Email
app.use("/api/email", emailRouter);

// ── Vault endpoints (Issue #302) ─────────────────────────────────────────────
app.use("/api/v1/vault", vaultRouter);

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, async () => {
  startWorker();
  console.log(`Aura Vault backend running on port ${PORT}`);
  await warmCache();
  startEmailWorker();
});

// Graceful shutdown
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    stopEmailWorker();
    server.close(() => process.exit(0));
  });
}

export default app;
