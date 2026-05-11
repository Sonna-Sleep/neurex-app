import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

const WORDMARK = require('../../assets/images/logo-wordmark.png');

const SOURCE_W = 2000;
const SOURCE_H = 2000;
// The actual wordmark sits in roughly the middle 75% width / 12% height of the canvas.
// Aspect ratio for layout = source ratio.
const ASPECT = SOURCE_W / SOURCE_H;

type Props = {
  height?: number;
};

export function Logo({ height = 28 }: Props) {
  // The PNG is square with massive padding; render at a height that visually balances
  // and let the Image component preserve aspect ratio.
  const renderedHeight = height * 8;
  const renderedWidth = renderedHeight * ASPECT;

  return (
    <View style={[styles.wrap, { height, width: height * 4.5, overflow: 'hidden' }]}>
      <Image
        source={WORDMARK}
        style={{
          width: renderedWidth,
          height: renderedHeight,
          marginTop: -(renderedHeight / 2 - height / 2),
          marginLeft: -(renderedWidth / 2 - (height * 4.5) / 2),
        }}
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
