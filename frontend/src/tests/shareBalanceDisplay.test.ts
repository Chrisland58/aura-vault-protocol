import { describe, expect, it } from "vitest";

function formatShareBalanceText(shares: string | number, price: string | number) {
  const sharesNum = parseFloat(String(shares));
  const priceNum = parseFloat(String(price));
  if (isNaN(sharesNum) || isNaN(priceNum)) return "—";

  const formattedShares = sharesNum.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const equivalentValue = (sharesNum * priceNum).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${formattedShares} aUSDC shares (≈ ${equivalentValue} USDC)`;
}

describe("share balance formatting", () => {
  it("formats shares with the equivalent token value in the canonical copy", () => {
    expect(formatShareBalanceText("123.45", "1.04")).toBe("123.45 aUSDC shares (≈ 128.39 USDC)");
  });

  it("returns a fallback placeholder for invalid input", () => {
    expect(formatShareBalanceText("not-a-number", "1.04")).toBe("—");
  });
});
