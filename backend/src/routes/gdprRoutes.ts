/**
 * GDPR Erasure Routes  (Issue #532)
 *
 * DELETE /api/users/:address  — request deletion of all off-chain user data
 * GET    /api/users/:address/erasure/:requestId  — poll request status
 */

import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authMiddleware.js";
import { userRateLimiter } from "../middleware/rateLimitMiddleware.js";
import {
  createErasureRequest,
  executeErasure,
  getErasureRequest,
  RETAINED_FIELDS,
} from "../services/gdprService.js";

export const gdprRouter = Router();

// ─── DELETE /api/users/:address ───────────────────────────────────────────────

/**
 * Initiate a GDPR right-to-erasure request.
 *
 * Authenticated users can only delete their own data (sub must match address).
 * The caller may optionally provide their email address in the request body so
 * a confirmation email can be sent on completion.
 *
 * On-chain data (tx hashes, vault positions) is always retained.
 * The request is logged to the compliance audit trail.
 * Deletion is completed within 30 days per GDPR Art. 12 §3.
 */
gdprRouter.delete(
  "/:address",
  authenticate,
  userRateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params as { address: string };
    const authenticatedUser = (req as any).user;

    // Wallet address in the token must match the requested address
    if (
      authenticatedUser?.sub?.toLowerCase() !== address.toLowerCase()
    ) {
      res.status(403).json({
        error: "You can only delete your own data.",
      });
      return;
    }

    // Optional: caller can provide email for confirmation notification
    const { email: userEmail } = req.body as { email?: string };

    const requestIp =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.socket?.remoteAddress;

    try {
      const { requestId, alreadyPending } = await createErasureRequest(address, requestIp);

      if (alreadyPending) {
        res.status(409).json({
          error: "An erasure request is already pending for this address.",
          requestId,
        });
        return;
      }

      // Execute immediately (synchronous path).
      // In production with large datasets, push to a background queue instead.
      const result = await executeErasure(requestId, userEmail);

      res.status(200).json({
        success: true,
        requestId: result.requestId,
        walletAddress: result.walletAddress,
        deletedFields: result.deletedFields,
        retainedFields: result.retainedFields,
        completedAt: result.completedAt.toISOString(),
        message:
          "Off-chain data erased. On-chain transaction records are retained " +
          "per blockchain immutability requirements.",
        confirmationEmailSent: !!userEmail,
        // GDPR compliance note
        regulatoryNote:
          "Erasure completed within regulatory window. " +
          "Retained fields are on-chain records outside GDPR scope.",
      });
    } catch (err) {
      console.error("[GDPR] DELETE /api/users/:address error:", err);
      res.status(500).json({ error: "Erasure request failed. Please try again." });
    }
  }
);

// ─── GET /api/users/:address/erasure/:requestId ────────────────────────────────

/**
 * Poll the status of an erasure request.
 */
gdprRouter.get(
  "/:address/erasure/:requestId",
  authenticate,
  userRateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const { address, requestId } = req.params as {
      address: string;
      requestId: string;
    };
    const authenticatedUser = (req as any).user;

    if (authenticatedUser?.sub?.toLowerCase() !== address.toLowerCase()) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }

    const id = parseInt(requestId, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: "Invalid requestId." });
      return;
    }

    try {
      const record = await getErasureRequest(id);
      if (!record) {
        res.status(404).json({ error: "Erasure request not found." });
        return;
      }

      // Ensure the request belongs to the authenticated user
      if (record.walletAddress?.toLowerCase() !== address.toLowerCase()) {
        res.status(403).json({ error: "Forbidden." });
        return;
      }

      res.json({
        requestId: id,
        walletAddress: record.walletAddress,
        status: record.status,
        requestedAt: record.requestedAt,
        deadlineAt: record.deadlineAt,
        completedAt: record.completedAt ?? null,
        deletedFields: record.deletedFields ?? [],
        retainedFields: RETAINED_FIELDS,
        confirmationEmailSent: record.confirmationEmailSent,
      });
    } catch (err) {
      console.error("[GDPR] GET erasure status error:", err);
      res.status(500).json({ error: "Failed to retrieve erasure status." });
    }
  }
);
