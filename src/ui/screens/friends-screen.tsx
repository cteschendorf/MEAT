import { Text } from 'react-native';

import { ShellScreen, typography, useThemeColors } from '@/ui';

export function FriendsScreen() {
  const colors = useThemeColors();

  return (
    <ShellScreen title="Friends">
      <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Shared food moments will live here.</Text>
    </ShellScreen>
  );
}

export default FriendsScreen;
