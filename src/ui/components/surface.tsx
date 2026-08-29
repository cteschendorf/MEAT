import type { PropsWithChildren } from 'react';
import { View, type ViewProps } from 'react-native';

import { radii, spacing } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export type SurfaceProps = PropsWithChildren<ViewProps> & {
  tone?: 'default' | 'muted';
};

export function Surface({ children, tone = 'default', style, ...props }: SurfaceProps) {
  const colors = useThemeColors();

  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: tone === 'muted' ? colors.surfaceMuted : colors.surface,
          borderColor: colors.border,
          borderCurve: 'continuous',
          borderRadius: radii.md,
          borderWidth: 1,
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
