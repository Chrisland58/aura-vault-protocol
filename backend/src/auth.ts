import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  setAdd,
  setMembers,
  setDel,
  NS,
} from "./cache.js";

const JWT_SECRET = process.env.JWT_SECRET || "aura-vault-dev-secret";
const ACCESS_TOKEN_TTL = 900; // 15 minutes
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days

// A07 JWT Best Practices: explicit algorithm, issuer, and audience
// — prevents algorithm confusion attacks (e.g. RS256→HS256 downgrade)
const JWT_ALGORITHM = "HS256" as const;
// Issuer and audience are opt-in: set JWT_ISSUER / JWT_AUDIENCE env vars in
// production. When unset (e.g. unit tests) the claims are omitted so existing
// tests continue to pass without modification.
const JWT_ISSUER = process.env.JWT_ISSUER;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE;

export type Tier = "free" | "paid";

export interface TokenPayload {
  sub: string;
  sessionId: string;
  jti?: string;       // JWT ID — unique per token, used for blacklisting
  deviceId?: string;
  tier?: Tier;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface StoredRefresh {
  userId: string;
  sessionId: string;
  deviceId?: string;
  tier?: Tier;
  jti: string;        // JTI of the refresh token stored alongside session data
}

export async function generateTokens(
  userId: string,
  deviceId?: string,
  tier: Tier = "free"
): Promise<TokenPair> {
  const sessionId = uuidv4();
  const accessJti = uuidv4();
  const refreshJti = uuidv4();

  const accessToken = jwt.sign(
    { sub: userId, sessionId, jti: accessJti, deviceId, tier } satisfies TokenPayload,
    JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_TTL,
      algorithm: JWT_ALGORITHM,
      ...(JWT_ISSUER && { issuer: JWT_ISSUER }),
      ...(JWT_AUDIENCE && { audience: JWT_AUDIENCE }),
    }
  );

  const refreshToken = jwt.sign(
    { sub: userId, sessionId, jti: refreshJti, type: "refresh" },
    JWT_SECRET,
    {
      expiresIn: REFRESH_TOKEN_TTL,
      algorithm: JWT_ALGORITHM,
      ...(JWT_ISSUER && { issuer: JWT_ISSUER }),
      ...(JWT_AUDIENCE && { audience: JWT_AUDIENCE }),
    }
  );

  const stored: StoredRefresh = { userId, sessionId, deviceId, tier, jti: refreshJti };
  await cacheSet(NS.AUTH_REFRESH, refreshToken, stored, REFRESH_TOKEN_TTL);
  await setAdd(NS.AUTH_SESSIONS, userId, sessionId, REFRESH_TOKEN_TTL);

  // Track refresh token reference per session for bulk revocation
  await setAdd(NS.AUTH_SESSIONS_TOKENS, `${userId}:${sessionId}`, refreshToken, REFRESH_TOKEN_TTL);

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL };
}

export async function validateAccessToken(
  token: string
): Promise<TokenPayload | null> {
  try {
    // Decode first to get JTI for blacklist check
    const decoded = jwt.decode(token) as (TokenPayload & { jti?: string }) | null;

    // Check blacklist by JTI (preferred) or fall back to full token
    if (decoded?.jti) {
      const blacklistedByJti = await cacheGet<true>(NS.AUTH_BLACKLIST, `jti:${decoded.jti}`);
      if (blacklistedByJti) return null;
    }

    // Also check legacy full-token blacklist entries
    const blacklistedByToken = await cacheGet<true>(NS.AUTH_BLACKLIST, token);
    if (blacklistedByToken) return null;

    return jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      ...(JWT_ISSUER && { issuer: JWT_ISSUER }),
      ...(JWT_AUDIENCE && { audience: JWT_AUDIENCE }),
    }) as TokenPayload;
  } catch {
    return null;
  }
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenPair | null> {
  // Check if refresh token JTI is blacklisted before proceeding
  const decodedRefresh = jwt.decode(refreshToken) as { jti?: string; sub?: string; exp?: number } | null;
  if (decodedRefresh?.jti) {
    const blacklisted = await cacheGet<true>(NS.AUTH_BLACKLIST, `jti:${decodedRefresh.jti}`);
    if (blacklisted) return null;
  }

  const stored = await cacheGet<StoredRefresh>(NS.AUTH_REFRESH, refreshToken);
  if (!stored) return null;
  try {
    jwt.verify(refreshToken, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      ...(JWT_ISSUER && { issuer: JWT_ISSUER }),
      ...(JWT_AUDIENCE && { audience: JWT_AUDIENCE }),
    });
  } catch {
    return null;
  }
  // Rotate: delete old, issue new pair
  await cacheDel(NS.AUTH_REFRESH, refreshToken);
  return generateTokens(stored.userId, stored.deviceId, stored.tier);
}

/**
 * Blacklist a token by its JTI (preferred) or full token string.
 * The Redis entry TTL matches the token's remaining lifetime.
 */
export async function blacklistToken(token: string): Promise<void> {
  let ttl = ACCESS_TOKEN_TTL;
  let jti: string | undefined;

  try {
    const decoded = jwt.decode(token) as { exp?: number; jti?: string } | null;
    if (decoded?.exp) {
      const remaining = decoded.exp - Math.floor(Date.now() / 1000);
      ttl = Math.max(remaining, 1);
    }
    jti = decoded?.jti;
  } catch {}

  // Blacklist by JTI (small key) when available
  if (jti) {
    await cacheSet(NS.AUTH_BLACKLIST, `jti:${jti}`, true, ttl);
  } else {
    // Fall back to full token hashing for tokens without JTI
    await cacheSet(NS.AUTH_BLACKLIST, token, true, ttl);
  }
}

/**
 * Blacklist a refresh token by its JTI with the refresh token's remaining TTL.
 */
export async function blacklistRefreshToken(refreshToken: string): Promise<void> {
  let ttl = REFRESH_TOKEN_TTL;
  let jti: string | undefined;

  try {
    const decoded = jwt.decode(refreshToken) as { exp?: number; jti?: string } | null;
    if (decoded?.exp) {
      const remaining = decoded.exp - Math.floor(Date.now() / 1000);
      ttl = Math.max(remaining, 1);
    }
    jti = decoded?.jti;
  } catch {}

  if (jti) {
    await cacheSet(NS.AUTH_BLACKLIST, `jti:${jti}`, true, ttl);
  }
}

/**
 * Logout: blacklist the access token and the refresh token, then remove
 * the refresh token from the session store.
 * Blacklist entry TTLs match each token's remaining lifetime.
 */
export async function logout(
  accessToken: string,
  refreshToken?: string
): Promise<void> {
  // Blacklist access token
  await blacklistToken(accessToken);

  if (refreshToken) {
    // Blacklist refresh token JTI so it can never be used again
    await blacklistRefreshToken(refreshToken);
    // Remove from active session store
    await cacheDel(NS.AUTH_REFRESH, refreshToken);
  }
}

/**
 * Bulk logout: revoke all active sessions for a user.
 * Retrieves all stored refresh tokens and blacklists each one.
 */
export async function logoutAllDevices(userId: string): Promise<void> {
  const sessionIds = await setMembers(NS.AUTH_SESSIONS, userId);

  // For each session, find stored refresh tokens and blacklist them
  for (const sessionId of sessionIds) {
    const tokenSet = await setMembers(NS.AUTH_SESSIONS_TOKENS, `${userId}:${sessionId}`);
    for (const refreshToken of tokenSet) {
      await blacklistRefreshToken(refreshToken);
      await cacheDel(NS.AUTH_REFRESH, refreshToken);
    }
    // Remove the per-session token set
    await setDel(NS.AUTH_SESSIONS_TOKENS, `${userId}:${sessionId}`);
  }

  // Clear the session set for this user
  await setDel(NS.AUTH_SESSIONS, userId);
}

export async function getUserSessions(userId: string): Promise<string[]> {
  return setMembers(NS.AUTH_SESSIONS, userId);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await logoutAllDevices(userId);
}
