import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { typeScale, colors } from './tokens';

type TypographyProps = TextProps & {
  children: React.ReactNode;
};

export function SerifHero({ style, children, ...rest }: TypographyProps) {
  return (
    <Text {...rest} style={[styles.serifHero, style]}>
      {children}
    </Text>
  );
}

export function SerifDisplay({ style, children, ...rest }: TypographyProps) {
  return (
    <Text {...rest} style={[styles.serifDisplay, style]}>
      {children}
    </Text>
  );
}

export function SerifHeadline({ style, children, ...rest }: TypographyProps) {
  return (
    <Text {...rest} style={[styles.serifHeadline, style]}>
      {children}
    </Text>
  );
}

export function Eyebrow({ style, children, ...rest }: TypographyProps) {
  return (
    <Text {...rest} style={[styles.eyebrow, style]}>
      {children}
    </Text>
  );
}

export function Body({ style, children, ...rest }: TypographyProps) {
  return (
    <Text {...rest} style={[styles.body, style]}>
      {children}
    </Text>
  );
}

export function Secondary({ style, children, ...rest }: TypographyProps) {
  return (
    <Text {...rest} style={[styles.secondary, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  serifHero: typeScale.serifHero,
  serifDisplay: typeScale.serifDisplay,
  serifHeadline: typeScale.serifHeadline,
  eyebrow: typeScale.sansEyebrow,
  body: typeScale.sansBody,
  secondary: typeScale.sansSecondary,
});

export { colors };
