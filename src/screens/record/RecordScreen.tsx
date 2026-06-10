// Dedicated full-screen recording flow. Everything about starting/running a
// night lives here — pairing, the pre-bed signal check, the live recording, and
// syncing — so Home stays a clean results dashboard. Reuses the existing
// RecordingCard / ConnectDeviceCard lifecycle components; this screen is just
// their full-screen host with a close affordance.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { Eyebrow, Body } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { RecordingCard } from '../home/components/RecordingCard';
import { ConnectDeviceCard } from '../home/components/ConnectDeviceCard';

export function RecordScreen() {
  const navigation = useNavigation();
  const pairedDeviceId = useSession((s) => s.pairedDeviceId);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Eyebrow>sleep</Eyebrow>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Body style={styles.close}>close</Body>
        </Pressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    color: colors.textSecondary,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: spacing.xxxl,
    justifyContent: 'center',
  },
});
