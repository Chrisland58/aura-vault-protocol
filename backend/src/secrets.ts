import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

type SecretMap = Record<string, string>;

const cache = new Map<string, { expiresAt: number; value: SecretMap }>();

const ttlMs = Number(process.env.SECRETS_CACHE_TTL_MS ?? 5 * 60 * 1000);
const provider = process.env.SECRETS_PROVIDER ?? "env";
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

let client: SecretsManagerClient | null = null;

function auditSecretAccess(secretId: string, result: "hit" | "miss" | "error"): void {
  console.info(JSON.stringify({
    event: "secret_access",
    provider,
    secretId,
    result,
    timestamp: new Date().toISOString(),
  }));
}

function getClient(): SecretsManagerClient {
  client ??= new SecretsManagerClient({ region });
  return client;
}

function parseSecretPayload(payload: string | undefined): SecretMap {
  if (!payload) return {};
  const parsed = JSON.parse(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Secret payload must be a JSON object");
  }
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function getAwsSecret(secretId: string): Promise<SecretMap> {
  const cached = cache.get(secretId);
  if (cached && cached.expiresAt > Date.now()) {
    auditSecretAccess(secretId, "hit");
    return cached.value;
  }

  try {
    const response = await getClient().send(new GetSecretValueCommand({ SecretId: secretId }));
    const value = parseSecretPayload(response.SecretString);
    cache.set(secretId, { expiresAt: Date.now() + ttlMs, value });
    auditSecretAccess(secretId, "miss");
    return value;
  } catch (error) {
    auditSecretAccess(secretId, "error");
    throw error;
  }
}

async function getConfiguredSecretMap(): Promise<SecretMap> {
  const secretId = process.env.APP_SECRETS_ID;
  if (provider === "aws") {
    if (!secretId) throw new Error("APP_SECRETS_ID is required when SECRETS_PROVIDER=aws");
    return getAwsSecret(secretId);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Production must use a managed secrets provider");
  }

  return process.env as SecretMap;
}

export async function getSecret(name: string): Promise<string | undefined> {
  const secrets = await getConfiguredSecretMap();
  return secrets[name];
}
