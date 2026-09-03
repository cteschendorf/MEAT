import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';

export interface TabBarSymbolProps {
  readonly color: ColorValue;
  readonly focused: boolean;
  readonly name: SFSymbol;
  readonly selectedName: SFSymbol;
  readonly androidName: AndroidSymbol;
  readonly androidSelectedName?: AndroidSymbol;
}

export function TabBarSymbol({
  androidName,
  androidSelectedName = androidName,
  color,
  focused,
  name,
  selectedName,
}: TabBarSymbolProps) {
  const iosName = focused ? selectedName : name;
  const materialName = focused ? androidSelectedName : androidName;

  return (
    <SymbolView
      accessible={false}
      name={{ android: materialName, ios: iosName, web: materialName }}
      size={18}
      tintColor={color}
    />
  );
}
