// One night, opened on its own — reached by tapping the "Your night is ready"
// notification (and from anywhere else that deep-links a session). Fetches the
// session by id and renders the shared NightReport. Viewing it clears the
// Journal tab's "new" dot.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Secondary } from '../../theme/typography';
import { colors, layout, spacing, systemFontFamily } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import { useSession } from '../../state/session';
import { NightReport } from './NightReport';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';
import type { JournalStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<JournalStackParamList, 'SessionDetail'>;

function reportTitle(session: Session | null): string {
  if (!session) return '';
  const d = new Date(session.endMs);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
  const month = d.toLocaleDateString(undefined, { month: 'short' });
  return `${weekday} ${d.getDate()} ${month}`;
}

export function SessionDetailScreen({ route, navigation }: Props) {
  const { sessionId } = route.params;
  const markNightViewed = useSession((s) => s.markNightViewed);
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Opening this night clears its "new" dot, even before the fetch resolves.
  useEffect(() => {
    markNightViewed(sessionId);
  }, [sessionId, markNightViewed]);

  useEffect(() => {
    let active = true;
    Promise.all([sessionRepo.byId(sessionId), sessionRepo.list().catch(() => [])])
      .then(([s, list]) => {
        if (!active) return;
        setSession(s);
        setHistory(list);
        setLoaded(true);
      })
      .catch(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [sessionId]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
          >
            <Text style={styles.backChevron}>‹</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {reportTitle(session)}
          </Text>
        </View>

        {session ? (
          <NightReport session={session} history={history} />
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
    paddingTop: spacing.sm,
    // Clear the floating tab bar, which stays visible on this pushed screen.
    paddingBottom: TAB_BAR_SPACE,
    gap: spacing.xl,
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  backChevron: {
    fontFamily: systemFontFamily,
    fontSize: 44,
    lineHeight: 44,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  title: {
    flex: 1,
    fontFamily: systemFontFamily,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  center: {
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
});
