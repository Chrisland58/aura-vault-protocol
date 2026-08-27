import { TermTooltip } from "./Tooltip";

/**
 * VaultStats — shows live Share Price, APY, and TVL with tooltip glossary icons.
 * Values are mocked here; replace with real contract/backend data.
 */
export function VaultStats() {
  // TODO: wire to real vault data (backend API or Soroban read calls)
  const stats = [
    { term: "Share Price" as const, value: "1.0842", unit: "USDC" },
    { term: "APY" as const, value: "8.4", unit: "%" },
    { term: "TVL" as const, value: "124,500", unit: "USDC" },
  ];

  return (
    <div className="vault-stats" role="region" aria-label="Vault statistics">
      {stats.map(({ term, value, unit }) => (
        <div key={term} className="vault-stats__item">
          <dt className="vault-stats__label">
            <TermTooltip term={term} />
          </dt>
          <dd className="vault-stats__value">
            {value}
            <span className="vault-stats__unit">{unit}</span>
          </dd>
        </div>
      ))}
    </div>
  );
}
