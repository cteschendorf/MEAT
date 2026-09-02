import { Image } from 'expo-image';
import { View } from 'react-native';

import { radii } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

/**
 * The raised plus in the middle of the tab bar.
 *
 * Every other tab is a place; this one is an action, and the shape says so
 * before the label does. It sits a little proud of the bar because logging a
 * food is the thing the app is for, and the control for the thing the app is
 * for should not look like one of four peers (Charles, 2 Sep).
 */
const SIZE = 52;

export function AddFoodTabIcon() {
  const colors = useThemeColors();
  return (
    <View
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: radii.capsule,
        backgroundColor: colors.action,
        alignItems: 'center',
        justifyContent: 'center',
        // Lifted above the bar's baseline so it reads as a button on the bar
        // rather than an icon in it.
        marginTop: -18,
        shadowColor: colors.shadow,
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 6,
      }}
    >
      <Image
        accessibilityIgnoresInvertColors
        contentFit="contain"
        source="sf:plus"
        style={{ width: 26, height: 26, tintColor: colors.textOnAction }}
      />
    </View>
  );
}
