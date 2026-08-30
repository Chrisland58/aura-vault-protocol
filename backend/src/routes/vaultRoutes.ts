/**
 * Vault REST Endpoints — Issue #302
 *
 * Implements deposit, withdraw, and harvest transaction endpoints that accept
 * user-signed Stellar XDR transactions and submit them to the Stellar Horizon
 * network.
 *
 * POST /api/v1/vault/deposit   — { signedXdr, address }
 * POST /api/v1/vault/withdraw  — { signedXdr, shares, address }
 * POST /api/v1/vault/harvest   — { signedXdr, yieldAmount }
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import { userRateLimiter } from '../middleware/rateLimitMiddleware.js';

export const vaultRouter = Router();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HORIZON_URL =
  process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a string looks like a base64-encoded Stellar XDR envelope.
 * Stellar XDR transactions are base64 strings; we do a lightweight structural
 * check here — deeper validation happens at Horizon submission time.
 */
function isValidXdr(xdr: unknown): xdr is string {
  if (typeof xdr !== 'string' || xdr.trim().length === 0) return false;
  // Base64 regex (standard + URL-safe, with optional padding)
  const b64 = /^[A-Za-z0-9+/\-_]+=*$/;
  // XDR envelopes are at minimum a few hundred chars; reject tiny strings
  return xdr.length >= 20 && b64.test(xdr.trim());
}

/**
 * Validate a Stellar public key (G-address, 56 chars, base32).
 */
function isValidStellarAddress(addr: unknown): addr is string {
  if (typeof addr !== 'string') return false;
  return /^G[A-Z2-7]{55}$/.test(addr.trim());
}

/**
 * Submit a signed XDR to Horizon and return the parsed response.
 * Throws a typed error with Horizon's result codes if the tx failed.
 */
async function submitToHorizon(signedXdr: string): Promise<HorizonTxResult> {
  const body = new URLSearchParams({ tx: signedXdr });

  const response = await fetch(`${HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    // Extract Horizon result codes for user-friendly messaging
    const extras = json['extras'] as Record<string, unknown> | undefined;
    const resultCodes = (
      extras?.['result_codes'] as Record<string, unknown> | undefined
    ) ?? {};

    throw new HorizonError(
      response.status,
      (json['title'] as string) ?? 'Transaction failed',
      resultCodes,
    );
  }

  return {
    hash: json['hash'] as string,
    ledger: json['ledger'] as number,
    envelopeXdr: json['envelope_xdr'] as string,
    resultXdr: json['result_xdr'] as string,
    resultMetaXdr: json['result_meta_xdr'] as string,
    createdAt: json['created_at'] as string,
    feeCharged: json['fee_charged'] as string,
  };
}

interface HorizonTxResult {
  hash: string;
  ledger: number;
  envelopeXdr: string;
  resultXdr: string;
  resultMetaXdr: string;
  createdAt: string;
  feeCharged: string;
}

class HorizonError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly resultCodes: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HorizonError';
  }
}

/**
 * Translate Horizon result codes to human-readable messages.
 */
function friendlyResultMessage(
  resultCodes: Record<string, unknown>,
): string {
  const txCode = resultCodes['transaction'] as string | undefined;
  const opCodes = resultCodes['operations'] as string[] | undefined;

  const txMessages: Record<string, string> = {
    tx_failed: 'One or more operations in the transaction failed.',
    tx_bad_auth: 'Insufficient or invalid transaction signatures.',
    tx_bad_seq: 'Transaction sequence number is incorrect. Please refresh and retry.',
    tx_insufficient_fee: 'Transaction fee is too low. Please increase the base fee.',
    tx_no_source_account: 'Source account does not exist on the network.',
    tx_too_early: 'Transaction time bounds have not been reached yet.',
    tx_too_late: 'Transaction time bounds have expired. Please rebuild and resign.',
    tx_missing_operation: 'Transaction contains no operations.',
  };

  const opMessages: Record<string, string> = {
    op_underfunded: 'Insufficient funds to complete this operation.',
    op_low_reserve: 'Insufficient XLM reserve for this account.',
    op_no_account: 'Destination account does not exist.',
    op_line_full: 'Destination account cannot receive more of this asset.',
    op_no_trust: 'Destination account has no trustline for this asset.',
    op_not_authorized: 'Not authorised to perform this operation.',
  };

  const parts: string[] = [];

  if (txCode && txMessages[txCode]) {
    parts.push(txMessages[txCode]);
  }

  if (Array.isArray(opCodes)) {
    opCodes.forEach((code, i) => {
      const msg = opMessages[code];
      if (msg) parts.push(`Operation ${i + 1}: ${msg}`);
    });
  }

  return parts.length > 0
    ? parts.join(' ')
    : 'Transaction failed. Please check the transaction details and retry.';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/vault/deposit
 *
 * Body: { signedXdr: string, address: string }
 *
 * Validates the XDR envelope and Stellar address, then submits the
 * pre-signed deposit transaction to Horizon.
 */
vaultRouter.post(
  '/deposit',
  authenticate,
  userRateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const { signedXdr, address } = req.body as {
      signedXdr?: unknown;
      address?: unknown;
    };

    // — Validation ——————————————————————————————————————————————————————————
    if (!isValidXdr(signedXdr)) {
      res.status(400).json({
        error: 'Invalid or missing signedXdr. Expected a base64-encoded Stellar transaction envelope.',
      });
      return;
    }

    if (!isValidStellarAddress(address)) {
      res.status(400).json({
        error: 'Invalid or missing address. Expected a valid Stellar G-address.',
      });
      return;
    }

    // — Submit ———————————————————————————————————————————————————————————————
    try {
      const result = await submitToHorizon(signedXdr);

      res.status(200).json({
        success: true,
        operation: 'deposit',
        address,
        txHash: result.hash,
        ledger: result.ledger,
        feeCharged: result.feeCharged,
        createdAt: result.createdAt,
        envelopeXdr: result.envelopeXdr,
        resultXdr: result.resultXdr,
      });
    } catch (err) {
      if (err instanceof HorizonError) {
        const message = friendlyResultMessage(err.resultCodes);
        res.status(err.status >= 500 ? 502 : 400).json({
          error: message,
          resultCodes: err.resultCodes,
          operation: 'deposit',
        });
        return;
      }
      console.error('[vault/deposit] Unexpected error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * POST /api/v1/vault/withdraw
 *
 * Body: { signedXdr: string, shares: string, address: string }
 *
 * Validates inputs, then submits the pre-signed withdrawal transaction to
 * Horizon. The `shares` field indicates how many vault shares to redeem and
 * is included in the response for audit purposes.
 */
vaultRouter.post(
  '/withdraw',
  authenticate,
  userRateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const { signedXdr, shares, address } = req.body as {
      signedXdr?: unknown;
      shares?: unknown;
      address?: unknown;
    };

    // — Validation ——————————————————————————————————————————————————————————
    if (!isValidXdr(signedXdr)) {
      res.status(400).json({
        error: 'Invalid or missing signedXdr. Expected a base64-encoded Stellar transaction envelope.',
      });
      return;
    }

    if (shares === undefined || shares === null) {
      res.status(400).json({ error: '"shares" is required.' });
      return;
    }

    const sharesStr = String(shares).trim();
    if (!/^\d+(\.\d+)?$/.test(sharesStr) || Number(sharesStr) <= 0) {
      res.status(400).json({
        error: '"shares" must be a positive numeric value.',
      });
      return;
    }

    if (!isValidStellarAddress(address)) {
      res.status(400).json({
        error: 'Invalid or missing address. Expected a valid Stellar G-address.',
      });
      return;
    }

    // — Submit ———————————————————————————————————————————————————————————————
    try {
      const result = await submitToHorizon(signedXdr);

      res.status(200).json({
        success: true,
        operation: 'withdraw',
        address,
        shares: sharesStr,
        txHash: result.hash,
        ledger: result.ledger,
        feeCharged: result.feeCharged,
        createdAt: result.createdAt,
        envelopeXdr: result.envelopeXdr,
        resultXdr: result.resultXdr,
      });
    } catch (err) {
      if (err instanceof HorizonError) {
        const message = friendlyResultMessage(err.resultCodes);
        res.status(err.status >= 500 ? 502 : 400).json({
          error: message,
          resultCodes: err.resultCodes,
          operation: 'withdraw',
        });
        return;
      }
      console.error('[vault/withdraw] Unexpected error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * POST /api/v1/vault/harvest
 *
 * Body: { signedXdr: string, yieldAmount: string }
 *
 * Validates inputs, then submits the pre-signed harvest transaction to
 * Horizon. Harvest injects yield tokens into the vault without minting new
 * shares, increasing the exchange rate for all existing shareholders.
 */
vaultRouter.post(
  '/harvest',
  authenticate,
  userRateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const { signedXdr, yieldAmount } = req.body as {
      signedXdr?: unknown;
      yieldAmount?: unknown;
    };

    // — Validation ——————————————————————————————————————————————————————————
    if (!isValidXdr(signedXdr)) {
      res.status(400).json({
        error: 'Invalid or missing signedXdr. Expected a base64-encoded Stellar transaction envelope.',
      });
      return;
    }

    if (yieldAmount === undefined || yieldAmount === null) {
      res.status(400).json({ error: '"yieldAmount" is required.' });
      return;
    }

    const yieldStr = String(yieldAmount).trim();
    if (!/^\d+(\.\d+)?$/.test(yieldStr) || Number(yieldStr) <= 0) {
      res.status(400).json({
        error: '"yieldAmount" must be a positive numeric value.',
      });
      return;
    }

    // — Submit ———————————————————————————————————————————————————————————————
    try {
      const result = await submitToHorizon(signedXdr);

      res.status(200).json({
        success: true,
        operation: 'harvest',
        yieldAmount: yieldStr,
        txHash: result.hash,
        ledger: result.ledger,
        feeCharged: result.feeCharged,
        createdAt: result.createdAt,
        envelopeXdr: result.envelopeXdr,
        resultXdr: result.resultXdr,
      });
    } catch (err) {
      if (err instanceof HorizonError) {
        const message = friendlyResultMessage(err.resultCodes);
        res.status(err.status >= 500 ? 502 : 400).json({
          error: message,
          resultCodes: err.resultCodes,
          operation: 'harvest',
        });
        return;
      }
      console.error('[vault/harvest] Unexpected error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
