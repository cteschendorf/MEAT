import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

type ShellScreenProps = {
  title: string;
  children?: ReactNode;
};

export function ShellScreen({ title, children }: ShellScreenProps) {
  const colors = useThemeColors();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1, padding: spacing.xl, gap: spacing.lg }}
    >
      <View style={{ gap: spacing.sm }}>
        <Text
          accessibilityRole="header"
          allowFontScaling
          selectable
          style={[typography.largeTitle, { color: colors.textPrimary }]}
        >
          {title}
        </Text>
        {children}
      </View>
    </ScrollView>
  );
}
