import { Text, View } from 'react-native';

import { spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface ScreenStateProps {
  title: string;
  message?: string;
  role?: 'status' | 'alert';
}

export function ScreenState({ title, message, role = 'status' }: ScreenStateProps) {
  const colors = useThemeColors();

  return (
    <View
      accessibilityRole={role === 'alert' ? 'alert' : undefined}
      accessibilityLiveRegion={role === 'alert' ? 'assertive' : 'polite'}
      accessible
      style={{ gap: spacing.xs, padding: spacing.lg }}
    >
      <Text allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }]}>
        {title}
      </Text>
      {message ? (
        <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}
