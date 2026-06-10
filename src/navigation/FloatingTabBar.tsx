// Floating pill tab bar (reference-inspired): a rounded bar hovering above the
// bottom safe-area, the active tab highlighted by a lighter inner pill.
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { TabIcon } from '../components/TabIcon';
import { useSession } from '../state/session';
import { colors, radii, spacing, systemFontFamily } from '../theme/tokens';

// Vertical space the floating bar occupies — screens reserve this much bottom
// padding so scroll content clears it.
export const TAB_BAR_SPACE = 120;

const ICONS: Record<string, 'sleep' | 'journal' | 'profile'> = {
  Sleep: 'sleep',
  Journal: 'journal',
  Profile: 'profile',
};

export function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // A night finished processing but hasn't been opened → dot on the Journal tab.
  const hasNewNight = useSession((s) => s.unviewedNightIds.length > 0);
  return (
    <View style={[styles.wrap, { bottom: insets.bottom + spacing.sm }]} pointerEvents="box-none">
      <View style={styles.pill}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          const color = focused ? colors.textPrimary : colors.textTertiary;
          const showDot = route.name === 'Journal' && hasNewNight;
          return (
            <Pressable key={route.key} onPress={onPress} hitSlop={6}>
              <View style={[styles.item, focused && styles.itemActive]}>
                <TabIcon name={ICONS[route.name] ?? 'sleep'} color={color} size={21} />
                <Text style={[styles.label, { color }]}>{route.name}</Text>
                {showDot ? <View style={styles.dot} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 6,
    gap: spacing.xs,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
      },
      default: { elevation: 8 },
    }),
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    // Concrete radius, NOT radii.pill: oversized radii on background-only views
    // (no borderWidth) render square on some Android/new-arch builds. 26 ≈ this
    // item's stadium (height ~53) AND concentric with the container's rounding
    // minus its 6px padding, so the highlight nests evenly inside the bar.
    borderRadius: 26,
    gap: 3,
  },
  itemActive: {
    backgroundColor: colors.bgElevated,
  },
  label: {
    fontFamily: systemFontFamily,
    fontSize: 11,
    fontWeight: '600',
  },
  dot: {
    position: 'absolute',
    top: 2,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.bgSurface,
  },
});
