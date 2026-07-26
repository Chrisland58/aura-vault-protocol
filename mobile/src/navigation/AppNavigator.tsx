/**
 * AppNavigator  (updated for Issue #528 — biometric auth)
 *
 * Added:
 *  - AppState listener for background → foreground re-auth (5-min timeout)
 *  - BiometricEnrollment screen shown on first login
 *  - LockScreen overlay on re-auth requirement
 */

import React, { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { NavigationContainer, LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/HomeScreen.js";
import { SettingsScreen } from "../screens/SettingsScreen.js";
import { LockScreen } from "../screens/LockScreen.js";
import { BiometricEnrollmentScreen } from "../screens/BiometricEnrollmentScreen.js";
import {
  isReauthRequired,
  isBiometricEnrolled,
  hasPinSet,
} from "../services/biometricAuth.js";

export type RootStackParamList = {
  Home: undefined;
  Deposit: undefined;
  Withdraw: undefined;
  Settings: undefined;
  BiometricEnrollment: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["aura-vault://", "https://auravault.app"],
  config: {
    screens: {
      Home: "",
      Deposit: "deposit",
      Withdraw: "withdraw",
      Settings: "settings",
    },
  },
};

export function AppNavigator() {
  // true  → show LockScreen overlay
  const [locked, setLocked] = useState(false);
  // true  → show enrollment flow
  const [showEnrollment, setShowEnrollment] = useState(false);
  // timestamp when app went to background
  const backgroundedAt = useRef<number | null>(null);

  // ─── First-launch enrollment check ───────────────────────────────────────

  useEffect(() => {
    (async () => {
      const enrolled = await isBiometricEnrolled();
      const pinSet = await hasPinSet();
      if (!enrolled && !pinSet) {
        setShowEnrollment(true);
      }
    })();
  }, []);

  // ─── Background/foreground re-auth ────────────────────────────────────────

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      async (nextState: AppStateStatus) => {
        if (nextState === "background" || nextState === "inactive") {
          backgroundedAt.current = Date.now();
        } else if (nextState === "active") {
          // App returned to foreground — check timeout
          const reauthNeeded = await isReauthRequired();
          if (reauthNeeded) {
            setLocked(true);
          }
        }
      }
    );
    return () => subscription.remove();
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (showEnrollment) {
    return (
      <BiometricEnrollmentScreen
        onComplete={() => setShowEnrollment(false)}
      />
    );
  }

  if (locked) {
    return <LockScreen onUnlocked={() => setLocked(false)} />;
  }

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#000" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: "#000" },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
