import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

const WORDMARK = require('../../assets/images/logo-wordmark.png');

// The source PNG is the wordmark cropped tight to its content bounds
// (1500 × 600, "neurex" + the wave underneath, with minimal padding).
// No magic cropping math needed — height drives width via the aspect ratio.
const SOURCE_W = 1500;
const SOURCE_H = 600;
const ASPECT = SOURCE_W / SOURCE_H;

type Props = {
  /** Logo height in pixels. Width is derived from the aspect ratio. */
  height?: number;
};

export function Logo({ height = 28 }: Props) {
  return (
    <View style={[styles.wrap, { height, width: height * ASPECT }]}>
      <Image
        source={WORDMARK}
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
