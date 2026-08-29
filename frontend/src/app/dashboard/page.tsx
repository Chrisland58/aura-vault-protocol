"use client";

import { SortableDashboardGrid } from "@/components/dashboard/SortableDashboardGrid";
import PerformanceCharts from "@/components/PerformanceCharts";

/**
 * /dashboard — main vault overview page.
 *
 * Issue #498: uses SortableDashboardGrid which supports:
 *  - Drag-and-drop widget reordering (@dnd-kit/sortable)
 *  - Keyboard reordering (arrow keys on grip handle)
 *  - Widget visibility controlled from /settings
 *  - Layout persisted to localStorage
 *  - Smooth 60fps drag animation via CSS transform + DragOverlay
 */
export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <SortableDashboardGrid />
      <PerformanceCharts />
    </div>
  );
}
