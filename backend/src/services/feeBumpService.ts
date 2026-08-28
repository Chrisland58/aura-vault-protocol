/**
 * Stellar Fee Bump Transaction Service — Issue #323
 *
 * Sponsors gas fees for users by wrapping their signed inner transactions
 * in a fee-bump envelope with the protocol fee account as the source.
 *
 * Rules:
 *   - Fee bump source is the protocol fee account (FEE_ACCOUNT_SECRET env var)
 *   - Maximum fee is configurable per transaction type
 *   - Sponsorship is limited to the first 3 transactions per new address
 *   - Sponsored fee counts are tracked in Redis
 *   - Sponsored transaction counts are reported (admin dashboard data)
 */

import { getRedis } from "../redis.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxType = "deposit" | "withdrawal" | "claim" | "other";

export interface FeeBumpConfig {
  /** Maximum fee in stroops (1 XLM = 10_000_000 stroops) the protocol will pay */
  maxFeeStroops: number;
  /** Transaction types eligible for fee sponsorship */
  eligibleTypes: Set<TxType>;
  /** Maximum number of sponsored transactions per new address */
  maxSponsoredPerAddress: number;
}

export interface FeeBumpRequest {
  /** The user-signed inner transaction XDR */
  innerXdr: string;
  /** Wallet address of the user (inner transaction source) */
  userAddress: string;
  /** Transaction type for fee-cap lookup */
  txType: TxType;
}

export interface FeeBumpResult {
  /** XDR of the fee-bump envelope, ready for submission to Horizon */
  feeBumpXdr: string;
  /** Protocol fee account used as fee-bump source */
  feeSource: string;
  /** Actual fee set on the bump envelope (in stroops) */
  feeStroops: number;
  /** How many sponsored transactions this address has now used */
  sponsoredCount: number;
}

export interface FeeSponsorshipStats {
  address: string;
  sponsoredCount: number;
  remainingSponsored: number;
  eligible: boolean;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_FEE_CONFIG: FeeBumpConfig = {
  maxFeeStroops: 100_000,          // 0.01 XLM per transaction
  eligibleTypes: new Set(["deposit", "withdrawal", "claim", "other"]),
  maxSponsoredPerAddress: 3,
};

/** Per-type fee overrides (in stroops) — override in production via config */
export const FEE_CAP_BY_TYPE: Record<TxType, number> = {
  deposit: 100_000,
  withdrawal: 100_000,
  claim: 50_000,
  other: 50_000,
};

// ---------------------------------------------------------------------------
// Redis tracking
// ---------------------------------------------------------------------------

const SPONSORSHIP_NS = "feebump:count:";
const SPONSORSHIP_TTL_SECONDS = 365 * 24 * 3600; // 1 year

async function getSponsoredCount(address: string): Promise<number> {
  try {
    const raw = await getRedis().get(SPONSORSHIP_NS + address);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

async function incrementSponsoredCount(address: string): Promise<number> {
  try {
    const redis = getRedis();
    const key = SPONSORSHIP_NS + address;
    const newCount = await redis.incr(key);
    // Set TTL only on first increment (key just created)
    if (newCount === 1) {
      await redis.expire(key, SPONSORSHIP_TTL_SECONDS);
    }
    return newCount;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Fee bump XDR construction
// ---------------------------------------------------------------------------

/**
 * Build a fee-bump envelope XDR.
 *
 * In a real integration this function would use the `@stellar/stellar-sdk`
 * TransactionBuilder.buildFeeBumpTransaction() API.  We provide a typed
 * placeholder here so the service can be wired up without a live Stellar SDK
 * dependency in the backend package — callers inject the builder via the
 * `buildEnvelope` parameter.
 */
export type FeeBumpBuilder = (params: {
  feeSource: string;
  innerXdr: string;
  maxFeeStroops: number;
}) => Promise<string>; // returns the fee-bump XDR

/**
 * Default builder — swaps in a real SDK call in production.
 * Throws if called without a real builder to prevent silent no-ops.
 */
export const defaultFeeBumpBuilder: FeeBumpBuilder = async () => {
  throw new Error(
    "No FeeBumpBuilder provided. " +
    "Inject a real builder using @stellar/stellar-sdk TransactionBuilder.buildFeeBumpTransaction()"
  );
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether an address is eligible for fee sponsorship and how many
 * sponsored transactions it has already used.
 */
export async function getSponsorshipStats(
  address: string,
  config: FeeBumpConfig = DEFAULT_FEE_CONFIG
): Promise<FeeSponsorshipStats> {
  const count = await getSponsoredCount(address);
  return {
    address,
    sponsoredCount: count,
    remainingSponsored: Math.max(0, config.maxSponsoredPerAddress - count),
    eligible: count < config.maxSponsoredPerAddress,
  };
}

/**
 * Wrap a user-signed inner transaction in a fee-bump envelope.
 *
 * Throws if:
 *   - The address has exceeded the sponsorship limit
 *   - The transaction type is not eligible
 *   - The fee account secret is not configured
 *
 * @param request      Fee bump parameters
 * @param buildEnvelope Injectable builder (defaults to throwing placeholder)
 * @param config        Fee policy configuration
 */
export async function createFeeBump(
  request: FeeBumpRequest,
  buildEnvelope: FeeBumpBuilder = defaultFeeBumpBuilder,
  config: FeeBumpConfig = DEFAULT_FEE_CONFIG
): Promise<FeeBumpResult> {
  const { innerXdr, userAddress, txType } = request;

  // Validate eligibility
  if (!config.eligibleTypes.has(txType)) {
    throw new Error(`Transaction type '${txType}' is not eligible for fee sponsorship`);
  }

  const stats = await getSponsorshipStats(userAddress, config);
  if (!stats.eligible) {
    throw new Error(
      `Address ${userAddress} has exceeded the fee sponsorship limit ` +
      `(${config.maxSponsoredPerAddress} transactions)`
    );
  }

  // Resolve fee source
  const feeSource = process.env.FEE_ACCOUNT_PUBLIC_KEY;
  if (!feeSource) {
    throw new Error("FEE_ACCOUNT_PUBLIC_KEY environment variable is not set");
  }

  // Determine the fee cap for this tx type
  const feeStroops = Math.min(
    FEE_CAP_BY_TYPE[txType] ?? config.maxFeeStroops,
    config.maxFeeStroops
  );

  // Build the fee-bump envelope
  const feeBumpXdr = await buildEnvelope({ feeSource, innerXdr, maxFeeStroops: feeStroops });

  // Increment the sponsorship counter *after* successful envelope construction
  const sponsoredCount = await incrementSponsoredCount(userAddress);

  return {
    feeBumpXdr,
    feeSource,
    feeStroops,
    sponsoredCount,
  };
}

// ---------------------------------------------------------------------------
// Admin reporting helpers
// ---------------------------------------------------------------------------

/**
 * Return total sponsored transaction count across a list of addresses.
 * Used by the admin dashboard to report fee sponsorship spend.
 */
export async function getAdminSponsorshipReport(
  addresses: string[]
): Promise<{ totalSponsored: number; byAddress: Record<string, number> }> {
  const counts = await Promise.all(
    addresses.map(async (addr) => [addr, await getSponsoredCount(addr)] as [string, number])
  );
  const byAddress = Object.fromEntries(counts);
  const totalSponsored = Object.values(byAddress).reduce((a, b) => a + b, 0);
  return { totalSponsored, byAddress };
}
