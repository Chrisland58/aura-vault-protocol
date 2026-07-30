"use client";

import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import PerformanceCharts from "@/components/PerformanceCharts";

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
  return (
    <div className="space-y-8">
      <DashboardGrid />
      <PerformanceCharts />
    </div>
  );
}
