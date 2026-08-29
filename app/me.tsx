import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { ActionButton, ShellScreen, spacing, typography, useThemeColors } from '@/ui';

export default function MeScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  return (
    <ShellScreen title="Me">
      <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary, marginBottom: spacing.md }]}>Profile, goals, privacy, and tracking preferences live here.</Text>
      <ActionButton label="Food data sources" tone="secondary" onPress={() => router.push('/data-sources')} />
    </ShellScreen>
  );
}
