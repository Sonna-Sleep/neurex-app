import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { View } from 'react-native';

import { colors } from './theme/tokens';
import { RootNavigator } from './navigation/RootNavigator';
import { useAuthListener } from './lib/auth/useAuthListener';
import { useSession } from './state/session';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

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
