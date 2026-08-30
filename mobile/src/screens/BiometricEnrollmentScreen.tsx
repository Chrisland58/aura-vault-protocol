/**
 * BiometricEnrollmentScreen  (Issue #528)
 *
 * Shown on first login to prompt the user to set up biometric authentication.
 * User can opt-in or skip. Also collects a PIN for the fallback flow.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import {
  enrollBiometrics,
  savePin,
  getBiometricCapability,
} from "../services/biometricAuth.js";
import { AuthenticationType } from "expo-local-authentication";

type Step = "intro" | "pin_setup" | "biometric_prompt" | "done";

interface Props {
  onComplete: () => void;
}

export function BiometricEnrollmentScreen({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("intro");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Biometrics");

  useEffect(() => {
    (async () => {
      const cap = await getBiometricCapability();
      const isFaceId = cap.supportedTypes.includes(AuthenticationType.FACIAL_RECOGNITION);
      setBiometricLabel(isFaceId ? "Face ID" : "Fingerprint");
    })();
  }, []);

  // ─── PIN setup ─────────────────────────────────────────────────────────────

  async function handlePinSubmit() {
    if (pin.length < 6) {
      Alert.alert("PIN too short", "Please choose a 6-digit PIN.");
      return;
    }
    if (pin !== confirmPin) {
      Alert.alert("PINs don't match", "Please re-enter matching PINs.");
      return;
    }

    setLoading(true);
    try {
      await savePin(pin);
      setStep("biometric_prompt");
    } catch {
      Alert.alert("Error", "Failed to save PIN. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ─── Biometric opt-in ──────────────────────────────────────────────────────

  async function handleBiometricEnroll() {
    setLoading(true);
    try {
      const { enrolled, reason } = await enrollBiometrics();
      if (enrolled) {
        setStep("done");
        setTimeout(onComplete, 1200);
      } else {
        Alert.alert("Biometrics unavailable", reason ?? "Could not enroll biometrics.", [
          { text: "Skip", onPress: onComplete },
        ]);
      }
    } catch {
      Alert.alert("Error", "Enrollment failed. You can enable biometrics later in Settings.");
      onComplete();
    } finally {
      setLoading(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (step === "intro") {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>🔐</Text>
        <Text style={styles.title}>Secure Your Vault</Text>
        <Text style={styles.body}>
          Set up a PIN to protect access to your Aura Vault. You can also
          enable {biometricLabel} for faster sign-in.
        </Text>
        <Text style={styles.note}>
          Your private keys are never stored on this device — only session
          tokens are saved locally.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => setStep("pin_setup")}
          accessibilityRole="button"
          accessibilityLabel="Set up PIN"
        >
          <Text style={styles.primaryButtonText}>Set Up PIN</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={onComplete}
          accessibilityRole="button"
          accessibilityLabel="Skip security setup"
        >
          <Text style={styles.secondaryButtonText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === "pin_setup") {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>🔢</Text>
        <Text style={styles.title}>Create a PIN</Text>
        <Text style={styles.body}>
          Your PIN will be used as a fallback when {biometricLabel} is
          unavailable.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="6-digit PIN"
          placeholderTextColor="#52525b"
          keyboardType="numeric"
          secureTextEntry
          maxLength={8}
          value={pin}
          onChangeText={setPin}
          accessibilityLabel="Enter PIN"
        />
        <TextInput
          style={styles.input}
          placeholder="Confirm PIN"
          placeholderTextColor="#52525b"
          keyboardType="numeric"
          secureTextEntry
          maxLength={8}
          value={confirmPin}
          onChangeText={setConfirmPin}
          accessibilityLabel="Confirm PIN"
        />
        <TouchableOpacity
          style={[styles.primaryButton, loading && styles.disabled]}
          onPress={handlePinSubmit}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Confirm PIN"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Confirm PIN</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  if (step === "biometric_prompt") {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>{Platform.OS === "ios" ? "👤" : "👆"}</Text>
        <Text style={styles.title}>Enable {biometricLabel}?</Text>
        <Text style={styles.body}>
          Use {biometricLabel} for quick, secure sign-in each time you open
          the app after 5 minutes in the background.
        </Text>
        <TouchableOpacity
          style={[styles.primaryButton, loading && styles.disabled]}
          onPress={handleBiometricEnroll}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Enable ${biometricLabel}`}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Enable {biometricLabel}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={onComplete}
          accessibilityRole="button"
          accessibilityLabel="Skip biometrics"
        >
          <Text style={styles.secondaryButtonText}>Skip</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // done
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>✅</Text>
      <Text style={styles.title}>All Set!</Text>
      <Text style={styles.body}>Your vault is now secured.</Text>
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
    marginBottom: 12,
  },
  note: {
    fontSize: 12,
    color: "#52525b",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 8,
    padding: 12,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 12,
    padding: 16,
    color: "#fff",
    fontSize: 18,
    letterSpacing: 4,
    marginBottom: 12,
    backgroundColor: "#18181b",
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
