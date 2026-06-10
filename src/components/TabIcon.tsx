import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

type IconName = 'sleep' | 'journal' | 'profile';

type Props = {
  name: IconName;
  color: string;
  size?: number;
};

export function TabIcon({ name, color, size = 22 }: Props) {
  switch (name) {
    case 'sleep':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z"
            stroke={color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      );
    case 'journal':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x={3.5} y={5} width={17} height={15.5} rx={2.5} stroke={color} strokeWidth={1.6} />
          <Path d="M3.5 9.5H20.5" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
          <Path d="M8 3.5V6.5M16 3.5V6.5" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      );
    case 'profile':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={1.6} />
          <Path
            d="M4 21C4 16.582 7.582 13 12 13C16.418 13 20 16.582 20 21"
            stroke={color}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </Svg>
      );
  }
}
