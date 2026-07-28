/**
 * SecretsPoller — Application-side secret polling for AWS Secrets Manager
 *
 * Caches secrets in-memory and refreshes them on a configurable interval
 * (default 4 minutes < the 5-minute requirement).  During rotation, the poller
 * returns both the current and previous secret so JWTs signed by the old key
 * continue to be accepted for the full grace period.
 *
 * Usage (backend/src/auth.ts):
 *
 *   const jwtPoller = new SecretsPoller(process.env.JWT_SECRET_ARN!);
 *   const dbPoller  = new SecretsPoller(process.env.DB_SECRET_ARN!);
 *
 *   // In JWT verification middleware — accept tokens from both current + previous
 *   const [current, previous] = await jwtPoller.getDualSecrets();
 *   const secrets = [current.secret, previous?.secret].filter(Boolean);
 *
 *   // In DB connection factory
 *   const dbSecret = await dbPoller.getSecret<DbSecret>();
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedSecret<T = unknown> {
  value: T;
  fetchedAt: number;
  versionId: string;
}

export interface JwtSecretPayload {
  secret: string;
  createdAt: string;
  generation: number;
}

export interface DbSecretPayload {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

interface SecretPollerOptions {
  /** Refresh interval in milliseconds. Must be < 300_000 (5 min). Default: 240_000 (4 min) */
  refreshIntervalMs?: number;
  /** AWS region override */
  region?: string;
  /** Custom Secrets Manager endpoint (for local/test) */
  endpoint?: string;
}

// ── SecretsPoller ─────────────────────────────────────────────────────────────

export class SecretsPoller<T = unknown> {
  private readonly secretArn: string;
  private readonly refreshIntervalMs: number;
  private readonly client: SecretsManagerClient;

  private cachedCurrent: CachedSecret<T> | null = null;
  private cachedPrevious: CachedSecret<T> | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(secretArn: string, options: SecretPollerOptions = {}) {
    const interval = options.refreshIntervalMs ?? 240_000; // 4 minutes default

    if (interval >= 300_000) {
      throw new Error(
        `refreshIntervalMs must be < 300000 (5 min) to meet the polling SLA. Got: ${interval}`
      );
    }

    this.secretArn = secretArn;
    this.refreshIntervalMs = interval;
    this.client = new SecretsManagerClient({
      region: options.region,
      endpoint: options.endpoint,
    });
  }

  /**
   * Returns the current secret value, refreshing from Secrets Manager if the
   * cached value is stale.  Throws on first fetch failure; returns cached value
   * (with a warning log) on subsequent refresh failures to avoid cascading outages.
   */
  async getSecret(): Promise<T> {
    await this.ensureFresh();
    if (!this.cachedCurrent) {
      throw new Error(`No cached secret available for ${this.secretArn}`);
    }
    return this.cachedCurrent.value;
  }

  /**
   * Returns [current, previous] secrets.
   * During JWT rotation, validate tokens against both to support the grace period.
   * `previous` is null if no previous version exists (e.g. first rotation).
   */
  async getDualSecrets(): Promise<[T, T | null]> {
    await this.ensureFresh();
    if (!this.cachedCurrent) {
      throw new Error(`No cached secret available for ${this.secretArn}`);
    }
    return [this.cachedCurrent.value, this.cachedPrevious?.value ?? null];
  }

  /**
   * Force an immediate refresh regardless of cache age.
   * Useful during application startup or after receiving a rotation notification.
   */
  async forceRefresh(): Promise<void> {
    this.cachedCurrent = null;
    this.cachedPrevious = null;
    await this.fetchSecrets();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private isStale(): boolean {
    if (!this.cachedCurrent) return true;
    return Date.now() - this.cachedCurrent.fetchedAt > this.refreshIntervalMs;
  }

  private async ensureFresh(): Promise<void> {
    if (!this.isStale()) return;

    // Coalesce concurrent refresh calls into a single network request
    if (!this.refreshPromise) {
      this.refreshPromise = this.fetchSecrets().finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
  }

  private async fetchSecrets(): Promise<void> {
    const fetchedAt = Date.now();

    try {
      // Fetch AWSCURRENT
      const currentResponse = await this.client.send(
        new GetSecretValueCommand({
          SecretId: this.secretArn,
          VersionStage: "AWSCURRENT",
        })
      );

      if (!currentResponse.SecretString) {
        throw new Error(`Secret ${this.secretArn} has no SecretString`);
      }

      this.cachedCurrent = {
        value: JSON.parse(currentResponse.SecretString) as T,
        fetchedAt,
        versionId: currentResponse.VersionId ?? "unknown",
      };

      // Fetch AWSPREVIOUS (may not exist — that's OK)
      try {
        const previousResponse = await this.client.send(
          new GetSecretValueCommand({
            SecretId: this.secretArn,
            VersionStage: "AWSPREVIOUS",
          })
        );

        if (previousResponse.SecretString) {
          this.cachedPrevious = {
            value: JSON.parse(previousResponse.SecretString) as T,
            fetchedAt,
            versionId: previousResponse.VersionId ?? "unknown",
          };
        }
      } catch {
        // AWSPREVIOUS may not exist — silently ignore
        this.cachedPrevious = null;
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Secrets refreshed",
          secretArn: this.secretArn,
          currentVersionId: this.cachedCurrent.versionId,
          hasPrevious: !!this.cachedPrevious,
        })
      );
    } catch (err) {
      if (this.cachedCurrent) {
        // Return stale cache on refresh failure to avoid cascading outages
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "Failed to refresh secret — using stale cache",
            secretArn: this.secretArn,
            error: err instanceof Error ? err.message : String(err),
            cacheAgeMs: Date.now() - this.cachedCurrent.fetchedAt,
          })
        );
        return;
      }
      // No cache available — re-throw
      throw err;
    }
  }
}

// ── Singleton factory helpers ─────────────────────────────────────────────────

const pollers = new Map<string, SecretsPoller<unknown>>();

/**
 * Get or create a singleton SecretsPoller for a given ARN.
 * Avoids creating multiple pollers for the same secret across module imports.
 */
export function getPoller<T>(
  secretArn: string,
  options?: SecretPollerOptions
): SecretsPoller<T> {
  if (!pollers.has(secretArn)) {
    pollers.set(secretArn, new SecretsPoller<T>(secretArn, options));
  }
  return pollers.get(secretArn) as SecretsPoller<T>;
}
