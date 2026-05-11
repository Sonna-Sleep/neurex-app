import React, { useCallback, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { View } from 'react-native';

import { colors } from './theme/tokens';
import { RootNavigator } from './navigation/RootNavigator';
import { getDb } from './lib/db/schema';
import { useAuthListener } from './lib/auth/useAuthListener';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  useAuthListener();

  useEffect(() => {
    getDb().catch(() => undefined);
  }, []);

  const onLayout = useCallback(async () => {
    await SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.bgPrimary }} onLayout={onLayout}>
          <StatusBar style="light" />
          <RootNavigator />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
