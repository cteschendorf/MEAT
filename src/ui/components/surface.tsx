import type { PropsWithChildren } from 'react';
import { View, type ViewProps } from 'react-native';

import { radii, spacing } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export type SurfaceProps = PropsWithChildren<ViewProps> & {
  tone?: 'default' | 'muted' | 'elevated' | 'parchment';
};

export function Surface({ children, tone = 'default', style, ...props }: SurfaceProps) {
  const colors = useThemeColors();
  const backgroundColor = tone === 'muted'
    ? colors.surfaceMuted
    : tone === 'elevated'
      ? colors.surfaceElevated
      : tone === 'parchment'
        ? colors.parchment
        : colors.surface;

  return (
    <View
      {...props}
      style={[
        {
          backgroundColor,
          borderColor: tone === 'parchment' ? colors.parchmentBorder : colors.border,
          borderCurve: 'continuous',
          borderRadius: radii.card,
          borderWidth: 1,
          boxShadow: tone === 'elevated' ? `0 4px 14px ${colors.shadow}` : undefined,
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
