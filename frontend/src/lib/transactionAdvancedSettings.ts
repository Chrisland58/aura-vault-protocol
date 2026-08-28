export interface AdvancedSettingsState {
  isOpen: boolean;
  slippageTolerance: number;
  gasPriority: "low" | "medium" | "high" | "custom";
}

const STORAGE_KEY = "aura-vault-advanced-settings";

export function createDefaultAdvancedSettingsState(): AdvancedSettingsState {
  return {
    isOpen: false,
    slippageTolerance: 0.5,
    gasPriority: "medium",
  };
}

export function readAdvancedSettingsState(storage?: Storage): AdvancedSettingsState {
  const resolvedStorage = storage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
  if (!resolvedStorage) {
    return createDefaultAdvancedSettingsState();
  }

  try {
    const raw = resolvedStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultAdvancedSettingsState();
    }

    const parsed = JSON.parse(raw) as Partial<AdvancedSettingsState>;
    const defaults = createDefaultAdvancedSettingsState();

    return {
      isOpen: parsed.isOpen === true,
      slippageTolerance:
        typeof parsed.slippageTolerance === "number" && parsed.slippageTolerance >= 0.1 && parsed.slippageTolerance <= 5
          ? parsed.slippageTolerance
          : defaults.slippageTolerance,
      gasPriority:
        parsed.gasPriority === "low" || parsed.gasPriority === "medium" || parsed.gasPriority === "high" || parsed.gasPriority === "custom"
          ? parsed.gasPriority
          : defaults.gasPriority,
    };
  } catch {
    return createDefaultAdvancedSettingsState();
  }
}

export function writeAdvancedSettingsState(
  state: AdvancedSettingsState,
  storage?: Storage
): void {
  const resolvedStorage = storage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
  if (!resolvedStorage) {
    return;
  }

  try {
    resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors and keep the UI functional.
  }
}
