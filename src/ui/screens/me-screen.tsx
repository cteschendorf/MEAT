import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { ActionButton, ShellScreen, spacing, Surface, typography, useThemeColors } from '@/ui';

export function MeScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  return (
    <ShellScreen title="Me">
      <Text
        allowFontScaling
        selectable
        style={[typography.body, { color: colors.textSecondary, marginBottom: spacing.md }]}
      >
        Profile, goals, privacy, and tracking preferences live here.
      </Text>
      <Surface>
        <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }]}>Goals are optional</Text>
        <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Track without goals, or add and change them whenever they become useful.</Text>
        <ActionButton label="Review goals & units" tone="secondary" onPress={() => router.push('/onboarding')} />
      </Surface>
      <Surface>
        <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }]}>Food discovery</Text>
        <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Choose which independent food libraries MEAT searches.</Text>
        <ActionButton label="Food data sources" tone="secondary" onPress={() => router.push('/data-sources')} />
      </Surface>
    </ShellScreen>
  );
}

export default MeScreen;
