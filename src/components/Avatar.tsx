// One avatar, used everywhere: shows the user's profile photo when set, and
// falls back to a monogram circle (first initial) otherwise. Single source of
// truth so the Profile screen and the Edit sheet stay visually identical.
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, systemFontFamily } from '../theme/tokens';

type Props = {
  uri: string | null;
  name: string;
  size: number;
};

export function Avatar({ uri, name, size }: Props) {
  // Fall back to the monogram if the stored photo can't be loaded (file deleted,
  // unreadable uri). Reset the flag whenever the uri changes.
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [uri]);

  const initial = (name.trim().charAt(0) || 'Y').toUpperCase();
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (uri && !failed) {
    return (
      <Image source={{ uri }} style={[styles.photo, shape]} onError={() => setFailed(true)} />
    );
  }

  return (
    <View style={[styles.monogram, shape]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    backgroundColor: colors.bgElevated,
  },
  monogram: {
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: systemFontFamily,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
