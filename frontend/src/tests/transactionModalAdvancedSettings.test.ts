import { describe, it, expect } from "vitest";
import {
  createDefaultAdvancedSettingsState,
  readAdvancedSettingsState,
  writeAdvancedSettingsState,
} from "../lib/transactionAdvancedSettings";

function createMemoryStorage() {
  const store = new Map<string, string>();

  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  } as Storage;
}

describe("transaction advanced settings helpers", () => {
  it("starts collapsed with default values", () => {
    const state = createDefaultAdvancedSettingsState();

    expect(state.isOpen).toBe(false);
    expect(state.slippageTolerance).toBe(0.5);
    expect(state.gasPriority).toBe("medium");
  });

  it("reads and writes settings from session storage", () => {
    const storage = createMemoryStorage();
    const state = {
      isOpen: true,
      slippageTolerance: 1.5,
      gasPriority: "high" as const,
    };

    writeAdvancedSettingsState(state, storage);

    expect(readAdvancedSettingsState(storage)).toEqual(state);
  });

  it("falls back to defaults when stored values are invalid", () => {
    const storage = createMemoryStorage();
    storage.setItem("aura-vault-advanced-settings", '{"isOpen":"yes"}');

    expect(readAdvancedSettingsState(storage)).toEqual(
      createDefaultAdvancedSettingsState()
    );
  });
});
