import type { PropsWithChildren } from 'react';
import { View, type ViewProps } from 'react-native';

import { radii, spacing } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export type SurfaceProps = PropsWithChildren<ViewProps> & {
  tone?: 'default' | 'muted' | 'elevated';
};

export function Surface({ children, tone = 'default', style, ...props }: SurfaceProps) {
  const colors = useThemeColors();
  const backgroundColor =
    tone === 'muted' ? colors.surfaceMuted : tone === 'elevated' ? colors.surfaceElevated : colors.surface;

  return (
    <View
      {...props}
      style={[
        {
          backgroundColor,
          borderColor: colors.border,
          borderCurve: 'continuous',
          borderRadius: radii.md,
          borderWidth: 1,
          boxShadow: tone === 'elevated' ? `0 6px 20px ${colors.shadow}` : undefined,
          gap: spacing.sm,
          padding: spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
