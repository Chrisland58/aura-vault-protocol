"use client";

import { DashboardGrid } from "@/components/dashboard/DashboardGrid";

/**
 * /dashboard — main vault overview page.
 *
 * The legacy VaultOverviewDashboard has been replaced by DashboardGrid which
 * uses the new card-based layout:
 *
 *   ┌───────────────────────────────────────────┐
 *   │  HeroCard (TVL + Share Price)  [col-span-2]│
 *   ├─────────────────────┬─────────────────────┤
 *   │  7-Day APY          │  Depositor Count    │
 *   ├─────────────────────┴─────────────────────┤
 *   │  Last Harvest       │  (empty)            │
 *   ├─────────────────────┴─────────────────────┤
 *   │  User Position (only when connected) [×2] │
 *   └───────────────────────────────────────────┘
 *
 * Mobile collapses all cards to a single column.
 */
export default function DashboardPage() {
  return <DashboardGrid />;
}
