// One night, opened on its own — reached by tapping the "Your night is ready"
// notification (and from anywhere else that deep-links a session). Fetches the
// session by id and renders the shared NightReport. Viewing it clears the
// Journal tab's "new" dot.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Secondary } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import { useSession } from '../../state/session';
import { NightReport } from './NightReport';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';
import type { JournalStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<JournalStackParamList, 'SessionDetail'>;

export function SessionDetailScreen({ route, navigation }: Props) {
  const { sessionId } = route.params;
  const markNightViewed = useSession((s) => s.markNightViewed);
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Opening this night clears its "new" dot, even before the fetch resolves.
  useEffect(() => {
    markNightViewed(sessionId);
  }, [sessionId, markNightViewed]);

  useEffect(() => {
    let active = true;
    sessionRepo
      .byId(sessionId)
      .then((s) => {
        if (!active) return;
        setSession(s);
        setLoaded(true);
        if (s) {
          const d = new Date(s.endMs);
          navigation.setOptions({
            title: `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`,
          });
        }
      })
      .catch(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [sessionId, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {session ? (
          <NightReport session={session} />
        ) : (
          <View style={styles.center}>
            {loaded ? (
              <Secondary>This night isn’t available.</Secondary>
            ) : (
              <ActivityIndicator color={colors.textSecondary} />
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    // Clear the floating tab bar, which stays visible on this pushed screen.
    paddingBottom: TAB_BAR_SPACE,
  },
  center: {
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
});
