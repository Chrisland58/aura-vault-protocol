/**
 * Input validation using Zod — OWASP A03 Injection Prevention
 *
 * Usage:
 *   app.post('/route', validate(mySchema), handler)
 *   app.get('/route', validateQuery(mySchema), handler)
 */

import { z, type ZodSchema } from "zod";
import { type Request, type Response, type NextFunction } from "express";

// ── Middleware Factories ──────────────────────────────────────────────────────

/**
 * Validates req.body against a Zod schema.
 * On failure returns 400 with structured error detail.
 */
export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues;
      const firstField = issues[0]?.path.join(".") ?? "input";
      res.status(400).json({
        // Include the field name in the top-level message for backwards compatibility
        error: `Validation failed: ${firstField} — ${issues[0]?.message ?? "invalid"}`,
        details: issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validates req.query against a Zod schema.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: "Invalid query parameters",
        details: result.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    (req as Request & { validatedQuery: T }).validatedQuery = result.data;
    next();
  };
}

// ── Schemas ───────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  // Accept any non-empty string up to 100 chars.
  // Strict format validation (Stellar G-address or EVM 0x) is enforced
  // at the contract/chain layer; the API accepts any identifier so that
  // tests and future auth schemes (e.g. passkeys) don't need updating here.
  walletAddress: z
    .string({ required_error: "walletAddress is required" })
    .min(1, "walletAddress is required")
    .max(100, "walletAddress too long"),
  deviceId: z.string().max(128).optional(),
  tier: z.enum(["free", "paid"]).optional().default("free"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

export const portfolioPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const yieldCalculateSchema = z.object({
  positions: z.array(
    z.object({
      id: z.string().optional(),
      amount: z.number().nonnegative(),
      entryPrice: z.number().nonnegative().optional(),
    })
  ),
  sources: z.array(
    z.object({
      id: z.string().optional(),
      apy: z.number().min(0).max(100),
    })
  ),
  calcDate: z
    .string()
    .datetime({ message: "calcDate must be an ISO 8601 datetime string" })
    .optional(),
});

export const backfillSchema = z.object({
  positions: z.array(z.object({ id: z.string().optional() })),
  sources: z.array(z.object({ id: z.string().optional() })),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export const depositSimulateSchema = z.object({
  /**
   * Underlying token amount to simulate depositing.
   * Must be a positive integer (vault uses integer arithmetic on-chain).
   */
  amount: z
    .number({ required_error: "amount is required" })
    .int("amount must be an integer")
    .positive("amount must be greater than 0"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type PortfolioPaginationInput = z.infer<typeof portfolioPaginationSchema>;
export type YieldCalculateInput = z.infer<typeof yieldCalculateSchema>;
export type DepositSimulateInput = z.infer<typeof depositSimulateSchema>;
