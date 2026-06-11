// Floating pill tab bar (reference-inspired): a rounded bar hovering above the
// bottom safe-area, the active tab highlighted by a lighter inner pill.
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
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

// ≈ the item's stadium radius (it's ~53px tall) and concentric with the bar's
// rounding minus its 6px padding, so the highlight nests evenly inside.
const HIGHLIGHT_RADIUS = 26;

// Active-tab pill, drawn with SVG instead of a View background: toggling
// backgroundColor on a mounted View loses its corner rounding on Android's
// renderer (the square-highlight bug). The Svg needs EXPLICIT pixel dimensions
// — percentage sizing resolves against a default tiny viewport, not the
// absolute-fill — so measure the item once and draw at that exact size.
function TabHighlight() {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0 && (size?.w !== width || size?.h !== height)) {
          setSize({ w: width, h: height });
        }
      }}
    >
      {size ? (
        <Svg width={size.w} height={size.h}>
          <Rect
            x={0}
            y={0}
            width={size.w}
            height={size.h}
            rx={HIGHLIGHT_RADIUS}
            ry={HIGHLIGHT_RADIUS}
            fill={colors.bgElevated}
          />
        </Svg>
      ) : null}
    </View>
  );
}

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
              <View style={styles.item}>
                {focused ? <TabHighlight /> : null}
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
    gap: 3,
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
    backgroundColor: colors.positive,
    borderWidth: 1,
    borderColor: colors.bgSurface,
  },
});
