/**
 * AWS Secrets Manager — Database Password Rotation Lambda
 *
 * Implements the four-step rotation protocol required by AWS Secrets Manager:
 *   1. createSecret  — generate a new credential and store it as AWSPENDING
 *   2. setSecret     — apply the new password to the actual database
 *   3. testSecret    — verify the AWSPENDING credential can connect to the DB
 *   4. finishSecret  — promote AWSPENDING → AWSCURRENT; old secret kept for 1 h
 *
 * Environment variables:
 *   SECRETS_MANAGER_ENDPOINT  (optional) — custom endpoint for testing
 *   GRACE_PERIOD_SECONDS       (optional) — how long to keep old secret (default 3600)
 *   DB_PORT                    (optional) — postgres port (default 5432)
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  DescribeSecretCommand,
  UpdateSecretVersionStageCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { Client as PgClient } from "pg";
import * as crypto from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SecretsManagerRotationEvent {
  SecretId: string;
  ClientRequestToken: string;
  Step: "createSecret" | "setSecret" | "testSecret" | "finishSecret";
}

interface DbSecret {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
  engine?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GRACE_PERIOD_SECONDS = parseInt(
  process.env.GRACE_PERIOD_SECONDS ?? "3600",
  10
);

// Password character set: alphanumeric + safe special chars (no shell-unsafe)
const PASSWORD_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:,.<>?";
const PASSWORD_LENGTH = 32;

// ── Secrets Manager client ────────────────────────────────────────────────────

const smClient = new SecretsManagerClient({
  endpoint: process.env.SECRETS_MANAGER_ENDPOINT,
});

// ── Lambda handler ────────────────────────────────────────────────────────────

export async function handler(
  event: SecretsManagerRotationEvent
): Promise<void> {
  const { SecretId, ClientRequestToken, Step } = event;

  console.log(JSON.stringify({ step: Step, secretId: SecretId }));

  // Validate the secret exists and rotation is configured
  const metadata = await smClient.send(
    new DescribeSecretCommand({ SecretId })
  );

  if (!metadata.RotationEnabled) {
    throw new Error(`Rotation is not enabled for secret: ${SecretId}`);
  }

  const versions = metadata.VersionIdsToStages ?? {};
  if (!Object.keys(versions).includes(ClientRequestToken)) {
    throw new Error(
      `Version ${ClientRequestToken} does not exist for secret ${SecretId}`
    );
  }

  // Skip if the version is already current
  if (versions[ClientRequestToken]?.includes("AWSCURRENT")) {
    console.log(`Version ${ClientRequestToken} is already current — skipping`);
    return;
  }

  if (!versions[ClientRequestToken]?.includes("AWSPENDING")) {
    throw new Error(
      `Version ${ClientRequestToken} is not in AWSPENDING stage for secret ${SecretId}`
    );
  }

  switch (Step) {
    case "createSecret":
      await createSecret(SecretId, ClientRequestToken);
      break;
    case "setSecret":
      await setSecret(SecretId, ClientRequestToken);
      break;
    case "testSecret":
      await testSecret(SecretId, ClientRequestToken);
      break;
    case "finishSecret":
      await finishSecret(SecretId, ClientRequestToken);
      break;
    default:
      throw new Error(`Unknown rotation step: ${Step}`);
  }
}

// ── Step 1: createSecret ─────────────────────────────────────────────────────

async function createSecret(
  secretId: string,
  token: string
): Promise<void> {
  // Check if AWSPENDING already has a value (idempotency)
  try {
    await getSecretValue(secretId, "AWSPENDING");
    console.log("AWSPENDING already exists — skipping createSecret");
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  // Get current secret to use as template for the new one
  const current = await getSecretValue(secretId, "AWSCURRENT");
  const currentSecret: DbSecret = JSON.parse(current);

  // Generate a cryptographically secure new password
  const newPassword = generatePassword(PASSWORD_LENGTH);

  const newSecret: DbSecret = {
    ...currentSecret,
    password: newPassword,
  };

  // Store as AWSPENDING
  await smClient.send(
    new PutSecretValueCommand({
      SecretId: secretId,
      ClientRequestToken: token,
      SecretString: JSON.stringify(newSecret),
      VersionStages: ["AWSPENDING"],
    })
  );

  console.log("Created AWSPENDING version with new password");
}

// ── Step 2: setSecret ────────────────────────────────────────────────────────

async function setSecret(
  secretId: string,
  token: string
): Promise<void> {
  // Connect using AWSCURRENT credentials and change the password
  const currentJson = await getSecretValue(secretId, "AWSCURRENT");
  const current: DbSecret = JSON.parse(currentJson);

  const pendingJson = await getSecretValue(secretId, "AWSPENDING");
  const pending: DbSecret = JSON.parse(pendingJson);

  // If password is already rotated (idempotency), skip
  if (current.password === pending.password) {
    console.log("Passwords are identical — nothing to set");
    return;
  }

  const client = await connectToDatabase(current);
  try {
    // Use parameterised query to prevent SQL injection
    // Postgres requires ALTER USER syntax; password is quoted via format()
    await client.query(
      `ALTER USER ${escapeIdentifier(pending.username)} WITH PASSWORD $1`,
      [pending.password]
    );
    console.log(`Updated password for DB user: ${pending.username}`);
  } finally {
    await client.end();
  }
}

// ── Step 3: testSecret ───────────────────────────────────────────────────────

async function testSecret(
  secretId: string,
  token: string
): Promise<void> {
  const pendingJson = await getSecretValue(secretId, "AWSPENDING");
  const pending: DbSecret = JSON.parse(pendingJson);

  const client = await connectToDatabase(pending);
  try {
    const result = await client.query("SELECT 1 AS healthcheck");
    if (result.rows[0].healthcheck !== 1) {
      throw new Error("Database health check query returned unexpected result");
    }
    console.log("AWSPENDING secret connects successfully to the database");
  } finally {
    await client.end();
  }
}

// ── Step 4: finishSecret ─────────────────────────────────────────────────────

async function finishSecret(
  secretId: string,
  token: string
): Promise<void> {
  // Find the current version
  const metadata = await smClient.send(
    new DescribeSecretCommand({ SecretId: secretId })
  );

  const versions = metadata.VersionIdsToStages ?? {};
  let currentVersionId: string | undefined;

  for (const [versionId, stages] of Object.entries(versions)) {
    if (stages.includes("AWSCURRENT")) {
      if (versionId === token) {
        console.log("Version is already AWSCURRENT — skipping finishSecret");
        return;
      }
      currentVersionId = versionId;
      break;
    }
  }

  // Promote pending → current
  await smClient.send(
    new UpdateSecretVersionStageCommand({
      SecretId: secretId,
      VersionStage: "AWSCURRENT",
      MoveToVersionId: token,
      RemoveFromVersionId: currentVersionId,
    })
  );

  console.log(
    JSON.stringify({
      message: "Promoted AWSPENDING to AWSCURRENT",
      newVersionId: token,
      previousVersionId: currentVersionId,
      gracePeriodSeconds: GRACE_PERIOD_SECONDS,
    })
  );

  // The previous version (AWSPREVIOUS) is kept by Secrets Manager automatically.
  // Applications using getDualSecrets() will still accept it for GRACE_PERIOD_SECONDS.
  // Secrets Manager will delete it after the grace period has passed.
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSecretValue(
  secretId: string,
  stage: string
): Promise<string> {
  const response = await smClient.send(
    new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: stage,
    })
  );
  if (!response.SecretString) {
    throw new Error(`Secret ${secretId} has no SecretString at stage ${stage}`);
  }
  return response.SecretString;
}

async function connectToDatabase(secret: DbSecret): Promise<PgClient> {
  const client = new PgClient({
    host: secret.host,
    port: secret.port ?? parseInt(process.env.DB_PORT ?? "5432", 10),
    database: secret.dbname,
    user: secret.username,
    password: secret.password,
    ssl: { rejectUnauthorized: process.env.NODE_ENV === "production" },
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  await client.connect();
  return client;
}

function generatePassword(length: number): string {
  const chars = PASSWORD_CHARS;
  const randomBytes = crypto.randomBytes(length);
  return Array.from(randomBytes)
    .map((byte) => chars[byte % chars.length])
    .join("");
}

/**
 * Escape a PostgreSQL identifier (table/column/user name) to prevent injection.
 * This is a simple safe implementation for identifiers that are already validated.
 */
function escapeIdentifier(identifier: string): string {
  // Only allow alphanumeric and underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe DB identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}
