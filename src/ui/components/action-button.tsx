import type { ReactNode } from 'react';
import { Pressable, Text, type PressableProps } from 'react-native';

import { minimumTouchTarget, radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface ActionButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  icon?: ReactNode;
  tone?: 'primary' | 'secondary' | 'destructive';
}

export function ActionButton({ label, icon, tone = 'primary', disabled, style, ...props }: ActionButtonProps) {
  const colors = useThemeColors();
  const backgroundColor =
    tone === 'primary' ? colors.action : tone === 'destructive' ? colors.destructive : colors.surfaceMuted;
  const textColor = tone === 'secondary' ? colors.textPrimary : '#FFFFFF';

  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={({ pressed }) => [
        {
          alignItems: 'center',
          backgroundColor,
          borderCurve: 'continuous',
          borderRadius: radii.md,
          flexDirection: 'row',
          gap: spacing.xs,
          justifyContent: 'center',
          minHeight: minimumTouchTarget,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        typeof style === 'function' ? style({ pressed }) : style,
      ]}
    >
      {icon}
      <Text allowFontScaling style={[typography.bodyStrong, { color: textColor }]}>
        {label}
      </Text>
    </Pressable>
  );
}
