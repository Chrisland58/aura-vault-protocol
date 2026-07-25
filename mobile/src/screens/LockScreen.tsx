/**
 * LockScreen  (Issue #528)
 *
 * Displayed when the app returns from background and re-authentication
 * is required (5-minute timeout).
 *
 * Flow:
 *  1. Try biometrics automatically on mount (if enrolled)
 *  2. If biometrics fail/cancel → show PIN input
 *  3. PIN verified → call onUnlocked()
 *  4. Too many PIN failures → locked state with support link
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import {
  authenticate,
  authenticateWithBiometrics,
  authenticateWithPin,
  isBiometricEnrolled,
  isBiometricAvailable,
} from "../services/biometricAuth.js";

interface Props {
  onUnlocked: () => void;
}

type LockState = "trying_biometric" | "pin_input" | "locked_out" | "unlocked";

export function LockScreen({ onUnlocked }: Props) {
  const [lockState, setLockState] = useState<LockState>("trying_biometric");
  const [pin, setPin] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("biometrics");

  // ─── Auto-attempt biometrics on mount ─────────────────────────────────────

  const tryBiometrics = useCallback(async () => {
    const enrolled = await isBiometricEnrolled();
    const available = await isBiometricAvailable();

    setBiometricLabel(
      Platform.OS === "ios" ? "Face ID" : "fingerprint"
    );

    if (!enrolled || !available) {
      setLockState("pin_input");
      return;
    }

    setLockState("trying_biometric");
    const result = await authenticateWithBiometrics();
    if (result.success) {
      setLockState("unlocked");
      onUnlocked();
    } else {
      // Biometrics failed → fall back to PIN
      setLockState("pin_input");
      if (result.error && result.error !== "Authentication cancelled") {
        setErrorMessage(result.error);
      }
    }
  }, [onUnlocked]);

  useEffect(() => {
    tryBiometrics();
  }, [tryBiometrics]);

  // ─── PIN submission ────────────────────────────────────────────────────────

  async function handlePinSubmit() {
    if (pin.length < 4) {
      setErrorMessage("PIN must be at least 4 digits.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await authenticateWithPin(pin);
      if (result.success) {
        setLockState("unlocked");
        onUnlocked();
      } else if (result.error?.includes("Too many failed")) {
        setLockState("locked_out");
      } else {
        setErrorMessage(result.error ?? "Incorrect PIN");
        setPin("");
      }
    } finally {
      setLoading(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (lockState === "trying_biometric") {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>{Platform.OS === "ios" ? "👤" : "👆"}</Text>
        <Text style={styles.title}>Verifying {biometricLabel}…</Text>
        <ActivityIndicator color="#6366f1" style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (lockState === "locked_out") {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>🔒</Text>
        <Text style={styles.title}>Account Locked</Text>
        <Text style={styles.body}>
          Too many failed PIN attempts. Please contact support to regain
          access.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() =>
            // In production: open support URL via Linking.openURL
            console.log("Open support")
          }
          accessibilityRole="button"
          accessibilityLabel="Contact support"
        >
          <Text style={styles.primaryButtonText}>Contact Support</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (lockState === "unlocked") {
    return null;
  }

  // PIN input
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔐</Text>
      <Text style={styles.title}>Enter PIN</Text>
      <Text style={styles.body}>
        Enter your PIN to access Aura Vault.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="••••••"
        placeholderTextColor="#52525b"
        keyboardType="numeric"
        secureTextEntry
        maxLength={8}
        value={pin}
        onChangeText={setPin}
        autoFocus
        accessibilityLabel="Enter PIN"
        onSubmitEditing={handlePinSubmit}
      />

      {errorMessage ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.disabled]}
        onPress={handlePinSubmit}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Unlock"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Unlock</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={tryBiometrics}
        accessibilityRole="button"
        accessibilityLabel={`Use ${biometricLabel} instead`}
      >
        <Text style={styles.secondaryButtonText}>
          Use {biometricLabel} instead
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  icon: { fontSize: 56, marginBottom: 24 },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    color: "#a1a1aa",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 12,
    padding: 16,
    color: "#fff",
    fontSize: 24,
    letterSpacing: 8,
    marginBottom: 12,
    backgroundColor: "#18181b",
    textAlign: "center",
  },
  errorText: {
    color: "#f87171",
    fontSize: 13,
    marginBottom: 12,
    textAlign: "center",
  },
  primaryButton: {
    width: "100%",
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: {
    width: "100%",
    padding: 16,
    alignItems: "center",
    marginTop: 4,
  },
  secondaryButtonText: { color: "#6366f1", fontSize: 15 },
  disabled: { opacity: 0.6 },
});
