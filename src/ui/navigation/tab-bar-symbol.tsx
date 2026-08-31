import { Image } from 'expo-image';
import type { ColorValue } from 'react-native';

export interface TabBarSymbolProps {
  readonly color: ColorValue;
  readonly focused: boolean;
  readonly name: string;
  readonly selectedName: string;
}

export function TabBarSymbol({ color, focused, name, selectedName }: TabBarSymbolProps) {
  return (
    <Image
      accessibilityIgnoresInvertColors
      contentFit="contain"
      source={`sf:${focused ? selectedName : name}`}
      style={{ height: 24, tintColor: color, width: 24 }}
    />
  );
}
