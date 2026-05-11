import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

type IconName = 'home' | 'history' | 'account';

type Props = {
  name: IconName;
  color: string;
  size?: number;
};

export function TabIcon({ name, color, size = 22 }: Props) {
  switch (name) {
    case 'home':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M4 11L12 4L20 11V20H14V14H10V20H4V11Z"
            stroke={color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      );
    case 'history':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle
            cx={12}
            cy={12}
            r={9}
            stroke={color}
            strokeWidth={1.6}
          />
          <Path
            d="M12 7V12L15.5 14"
            stroke={color}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );
    case 'account':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle
            cx={12}
            cy={8}
            r={4}
            stroke={color}
            strokeWidth={1.6}
          />
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
