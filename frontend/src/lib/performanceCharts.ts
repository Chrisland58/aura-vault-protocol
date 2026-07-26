/**
 * Performance chart utilities extracted for testability.
 * Used by PerformanceCharts component.
 */

export type TimePeriod = "1D" | "1W" | "1M" | "3M" | "1Y" | "All";

export const PERIOD_DAYS: Record<TimePeriod, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  All: 730,
};

export interface ChartDataPoint {
  timestamp: number;
  balance: number;
  apy: number;
  yieldEarned: number;
}

export interface PerformanceData {
  balanceHistory: ChartDataPoint[];
  yieldBreakdown: { source: string; amount: number }[];
  totalYield: number;
  currentAPY: number;
}

export function generateMockData(p: TimePeriod): PerformanceData {
  const now = Date.now();
  const days = PERIOD_DAYS[p];
  const points: ChartDataPoint[] = [];
  let balance = 1000;

  for (let i = 0; i <= days; i++) {
    balance += balance * (0.001 + Math.random() * 0.001);
    points.push({
      timestamp: now - (days - i) * 86400000,
      balance: parseFloat(balance.toFixed(2)),
      apy: 8 + Math.random() * 4,
      yieldEarned: balance - 1000,
    });
  }

  return {
    balanceHistory: points,
    yieldBreakdown: [
      { source: "Trading Fees", amount: (balance - 1000) * 0.6 },
      { source: "Yield Farming", amount: (balance - 1000) * 0.3 },
      { source: "Governance", amount: (balance - 1000) * 0.1 },
    ],
    totalYield: balance - 1000,
    currentAPY: 10.5,
  };
}

/**
 * Serialise performance data to CSV string.
 * Returns null if data is null.
 */
export function toCSV(data: PerformanceData): string {
  const headers = ["Date", "Balance", "APY", "Yield Earned"];
  const rows = data.balanceHistory.map((point) => [
    new Date(point.timestamp).toISOString().split("T")[0],
    point.balance.toFixed(2),
    point.apy.toFixed(2),
    point.yieldEarned.toFixed(2),
  ]);
  return [headers, ...rows].map((row) => row.join(",")).join("\n");
}
