// Glowing contact-quality ring around the Sleep-screen circle. Driven by a
// ContactBand from contactQuality.ts. Drawn with react-native-svg at a FIXED px
// size (no % → avoids the rn-svg percent-sizing bug; same measured-SVG idea as the
// tab highlight). A gentle pulse on an outer halo gives the "glow"; the band color
// is hysteresis-smoothed upstream so swaps are infrequent and calm.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { ContactBand } from '../../../lib/ble/contactQuality';

export const BAND_COLORS: Record<ContactBand, string> = {
  red: '#E5484D', // bad — railed / no contact
  orange: '#E8924D', // not good enough
  yellow: '#E0B560', // usable
  green: '#5FB89C', // good
};

export const BAND_LABEL: Record<ContactBand, string> = {
  red: 'Poor contact',
  orange: 'Adjust the headband',
  yellow: 'Usable contact',
  green: 'Good contact',
};

type Props = {
  band: ContactBand;
  /** Diameter of the circle the ring wraps. */
  size?: number;
  /** Padding around the circle for the glow halo. */
  glowPad?: number;
  /** When false, no ring is drawn (e.g. not connected) — children render alone. */
  active?: boolean;
  children: React.ReactNode;
};

export function ContactRing({ band, size = 218, glowPad = 20, active = true, children }: Props) {
  const box = size + glowPad * 2;
  const color = BAND_COLORS[band];
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });

  const c = box / 2;
  const rMain = size / 2 + 3; // crisp ring just outside the circle
  const rGlow1 = rMain + 5;
  const rGlow2 = rMain + 11;

  return (
    <View style={[styles.box, { width: box, height: box }]}>
      {active ? (
        <>
          {/* Pulsing soft halo (the "glow"). */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.center, { opacity: glowOpacity }]}
          >
            <Svg width={box} height={box}>
              <Circle cx={c} cy={c} r={rGlow2} stroke={color} strokeWidth={10} fill="none" opacity={0.18} />
              <Circle cx={c} cy={c} r={rGlow1} stroke={color} strokeWidth={7} fill="none" opacity={0.38} />
            </Svg>
          </Animated.View>
          {/* Crisp main ring. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
            <Svg width={box} height={box}>
              <Circle cx={c} cy={c} r={rMain} stroke={color} strokeWidth={4} fill="none" />
            </Svg>
          </View>
        </>
      ) : null}
      <View style={styles.center}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
