// Dedicated full-screen recording flow. Everything about starting/running a
// night lives here — pairing, the pre-bed signal check, the live recording, and
// syncing — so Home stays a clean results dashboard. Reuses the existing
// RecordingCard / ConnectDeviceCard lifecycle components; this screen is just
// their host with a clear back control.

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '../../components/BackButton';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { RecordingCard } from '../home/components/RecordingCard';
import { ConnectDeviceCard } from '../home/components/ConnectDeviceCard';

export function RecordScreen() {
  const pairedDeviceId = useSession((s) => s.pairedDeviceId);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <BackButton label="home" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {pairedDeviceId ? <RecordingCard /> : <ConnectDeviceCard />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  topBar: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: spacing.xxxl,
    justifyContent: 'center',
  },
});
