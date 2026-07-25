/**
 * AWS Secrets Manager — JWT Secret Rotation Lambda
 *
 * Rotates the JWT signing secret every 7 days.
 * Implements the four-step rotation protocol:
 *   1. createSecret  — generate a new 64-byte hex secret as AWSPENDING
 *   2. setSecret     — store the pending secret (no external service to update)
 *   3. testSecret    — validate the pending secret format and length
 *   4. finishSecret  — promote AWSPENDING → AWSCURRENT; AWSPREVIOUS kept for grace period
 *
 * Grace period: during rotation, applications using getDualSecrets() will accept
 * tokens signed with BOTH the current and previous secret for GRACE_PERIOD_SECONDS
 * (default 3600), ensuring zero-downtime rotation.
 *
 * Environment variables:
 *   SECRETS_MANAGER_ENDPOINT  (optional) — custom endpoint for testing
 *   GRACE_PERIOD_SECONDS       (optional) — grace period in seconds (default 3600)
 *   JWT_SECRET_BYTES           (optional) — secret entropy in bytes (default 64)
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  DescribeSecretCommand,
  UpdateSecretVersionStageCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import * as crypto from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SecretsManagerRotationEvent {
  SecretId: string;
  ClientRequestToken: string;
  Step: "createSecret" | "setSecret" | "testSecret" | "finishSecret";
}

interface JwtSecretPayload {
  /** Hex-encoded signing secret */
  secret: string;
  /** ISO timestamp of when this secret was created */
  createdAt: string;
  /** Rotation generation counter */
  generation: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GRACE_PERIOD_SECONDS = parseInt(
  process.env.GRACE_PERIOD_SECONDS ?? "3600",
  10
);
const JWT_SECRET_BYTES = parseInt(process.env.JWT_SECRET_BYTES ?? "64", 10);
const MIN_SECRET_BYTES = 32; // minimum acceptable entropy

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

  // Validate the secret and rotation state
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

  if (versions[ClientRequestToken]?.includes("AWSCURRENT")) {
    console.log(`Version ${ClientRequestToken} is already current — skipping`);
    return;
  }

  if (!versions[ClientRequestToken]?.includes("AWSPENDING")) {
    throw new Error(
      `Version ${ClientRequestToken} is not in AWSPENDING stage`
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
  // Idempotency: skip if AWSPENDING already exists
  try {
    await getSecretValue(secretId, "AWSPENDING");
    console.log("AWSPENDING already exists — skipping createSecret");
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  // Get current generation to increment
  let currentGeneration = 0;
  try {
    const currentJson = await getSecretValue(secretId, "AWSCURRENT");
    const current: JwtSecretPayload = JSON.parse(currentJson);
    currentGeneration = current.generation ?? 0;
  } catch {
    // First rotation — no current secret yet
  }

  // Generate cryptographically secure new secret
  const newSecretHex = crypto.randomBytes(JWT_SECRET_BYTES).toString("hex");

  const payload: JwtSecretPayload = {
    secret: newSecretHex,
    createdAt: new Date().toISOString(),
    generation: currentGeneration + 1,
  };

  await smClient.send(
    new PutSecretValueCommand({
      SecretId: secretId,
      ClientRequestToken: token,
      SecretString: JSON.stringify(payload),
      VersionStages: ["AWSPENDING"],
    })
  );

  console.log(
    JSON.stringify({
      message: "Created AWSPENDING JWT secret",
      generation: payload.generation,
      secretLengthBytes: JWT_SECRET_BYTES,
    })
  );
}

// ── Step 2: setSecret ────────────────────────────────────────────────────────

async function setSecret(
  secretId: string,
  _token: string
): Promise<void> {
  // JWT secret is self-contained — no external service update needed.
  // The application picks it up via the SecretsPoller.
  // Just verify AWSPENDING exists and log.
  const pendingJson = await getSecretValue(secretId, "AWSPENDING");
  const pending: JwtSecretPayload = JSON.parse(pendingJson);

  console.log(
    JSON.stringify({
      message: "setSecret: AWSPENDING verified (no external service to update for JWT)",
      generation: pending.generation,
      gracePeriodSeconds: GRACE_PERIOD_SECONDS,
    })
  );
}

// ── Step 3: testSecret ───────────────────────────────────────────────────────

async function testSecret(
  secretId: string,
  _token: string
): Promise<void> {
  const pendingJson = await getSecretValue(secretId, "AWSPENDING");
  let pending: JwtSecretPayload;

  try {
    pending = JSON.parse(pendingJson);
  } catch {
    throw new Error("AWSPENDING secret is not valid JSON");
  }

  // Validate required fields
  if (!pending.secret) {
    throw new Error("AWSPENDING secret is missing 'secret' field");
  }

  // Validate hex encoding
  if (!/^[0-9a-f]+$/i.test(pending.secret)) {
    throw new Error("AWSPENDING 'secret' field is not valid hex");
  }

  // Validate minimum entropy (byte length of hex string / 2)
  const secretBytes = pending.secret.length / 2;
  if (secretBytes < MIN_SECRET_BYTES) {
    throw new Error(
      `AWSPENDING secret has insufficient entropy: ${secretBytes} bytes < ${MIN_SECRET_BYTES} required`
    );
  }

  if (typeof pending.generation !== "number" || pending.generation < 1) {
    throw new Error("AWSPENDING secret has invalid 'generation' field");
  }

  console.log(
    JSON.stringify({
      message: "AWSPENDING JWT secret is valid",
      entropyBytes: secretBytes,
      generation: pending.generation,
    })
  );
}

// ── Step 4: finishSecret ─────────────────────────────────────────────────────

async function finishSecret(
  secretId: string,
  token: string
): Promise<void> {
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
      message: "JWT secret rotation complete",
      newVersionId: token,
      previousVersionId: currentVersionId,
      gracePeriodSeconds: GRACE_PERIOD_SECONDS,
      note: "Applications should accept tokens from both AWSCURRENT and AWSPREVIOUS during grace period",
    })
  );
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
