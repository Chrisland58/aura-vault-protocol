/**
 * User Preferences Routes — Issue #318
 *
 * GET  /api/users/preferences   → return current prefs (defaults on first call)
 * PATCH /api/users/preferences  → merge-update preferences
 *
 * Both routes require a valid Bearer token (authenticate middleware).
 * The authenticated wallet address is taken from req.user.sub — the JWT subject.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../validation.js";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../services/userPreferencesService.js";

// ── Validation schema ─────────────────────────────────────────────────────────

/**
 * All fields are optional so callers may send only the fields they want to change.
 */
const patchPreferencesSchema = z
  .object({
    currency: z
      .string()
      .min(2, "currency must be at least 2 characters")
      .max(10, "currency must be at most 10 characters")
      .optional(),
    language: z
      .string()
      .min(2, "language must be at least 2 characters")
      .max(10, "language must be at most 10 characters")
      .optional(),
    emailNotifications: z.boolean().optional(),
    harvestAlerts: z.boolean().optional(),
  })
  .strict();

// ── Router ────────────────────────────────────────────────────────────────────

export const userPreferencesRouter = Router();

/**
 * GET /api/users/preferences
 *
 * Returns the current preferences for the authenticated wallet.
 * If no record exists, defaults are created and returned.
 *
 * Response 200:
 *   { address, currency, language, emailNotifications, harvestAlerts }
 */
userPreferencesRouter.get(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    const walletAddress: string = (req as any).user?.sub;

    if (!walletAddress) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const prefs = await getUserPreferences(walletAddress);
      res.json(prefs);
    } catch (err) {
      console.error("[userPreferences] GET error:", err);
      res.status(500).json({ error: "Failed to retrieve preferences" });
    }
  }
);

/**
 * PATCH /api/users/preferences
 *
 * Merge-updates the preferences for the authenticated wallet.
 * Unspecified fields retain their current value.
 *
 * Request body (all optional):
 *   { currency?, language?, emailNotifications?, harvestAlerts? }
 *
 * Response 200:
 *   { address, currency, language, emailNotifications, harvestAlerts }
 */
userPreferencesRouter.patch(
  "/",
  validate(patchPreferencesSchema),
  async (req: Request, res: Response): Promise<void> => {
    const walletAddress: string = (req as any).user?.sub;

    if (!walletAddress) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const prefs = await updateUserPreferences(walletAddress, req.body);
      res.json(prefs);
    } catch (err) {
      console.error("[userPreferences] PATCH error:", err);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  }
);
