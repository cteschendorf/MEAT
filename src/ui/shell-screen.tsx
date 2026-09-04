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
      contentContainerStyle={{
        flexGrow: 1,
        paddingBottom: spacing.xxl,
        paddingHorizontal: 20,
        paddingTop: spacing.sm,
      }}
    >
      <View style={{ gap: spacing.md }}>
        <Text
          accessibilityRole="header"
          allowFontScaling
          selectable
          style={[typography.screenTitle, { color: colors.textPrimary, textTransform: 'uppercase' }]}
        >
          {title}
        </Text>
        {children}
      </View>
    </ScrollView>
  );
}
