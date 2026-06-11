import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { View } from 'react-native';

// Side-effect import: constructs the singleton BleManager at module-load
// time so iOS state preservation/restoration works on a cold background
// start (e.g. when a paired Neurex device advertises while the app is
// suspended). Must happen before React renders. See src/lib/ble/manager.ts.
import './lib/ble';

import { colors } from './theme/tokens';
import { RootNavigator } from './navigation/RootNavigator';
import { useAuthListener } from './lib/auth/useAuthListener';
import { useSession } from './state/session';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Surface notifications that arrive while the app is foregrounded (e.g. a
// backend "night is ready" push landing while the user is in the app) instead
// of silently dropping them.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  useAuthListener();
  const hydrated = useSession((s) => s.hydrated);

  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => undefined);
  }, [hydrated]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
          <StatusBar style="light" />
          <RootNavigator />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
