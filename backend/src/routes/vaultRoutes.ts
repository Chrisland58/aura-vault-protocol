import { Router, Request, Response } from "express";

export const vaultRouter = Router();

/**
 * GET /api/vault/total_assets
 * Temporary dashboard endpoint.
 * Replace the synthetic value with a Soroban RPC read when the
 * live vault contract integration is available.
 */
vaultRouter.get(
  "/total_assets",
  (_req: Request, res: Response): void => {
    res.json({
      total: "1050",
      userBalance: "1050",
      userShares: "1000",
      pricePerShare: "1.0500",
    });
  }
);

/**
 * GET /api/vault/apy
 * Temporary dashboard APY endpoint.
 */
vaultRouter.get(
  "/apy",
  (_req: Request, res: Response): void => {
    res.json({
      apy: "8.5",
    });
  }
);

/**
 * GET /api/vault/balance_of
 * Temporary dashboard balance endpoint.
 */
vaultRouter.get(
  "/balance_of",
  (req: Request, res: Response): void => {
    const address = String(req.query.address ?? "");

    res.json({
      address,
      balance: "1050",
    });
  }
);