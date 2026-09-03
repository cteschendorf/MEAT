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
  const textColor = tone === 'secondary' ? colors.textPrimary : colors.textOnAction;

  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={(state) => {
        const backgroundColor = tone === 'primary'
          ? state.pressed
            ? colors.actionPressed
            : colors.action
          : tone === 'destructive'
            ? state.pressed
              ? colors.destructiveActionPressed
              : colors.destructiveAction
            : state.pressed
              ? colors.surfaceMuted
              : colors.surfaceElevated;

        return [
          {
            alignItems: 'center',
            backgroundColor,
            borderCurve: 'continuous',
            borderColor: tone === 'secondary' ? colors.borderStrong : backgroundColor,
            borderRadius: radii.control,
            borderWidth: 1,
            flexDirection: 'row',
            gap: spacing.xs,
            justifyContent: 'center',
            minHeight: minimumTouchTarget,
            opacity: disabled ? 0.45 : 1,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
          typeof style === 'function' ? style(state) : style,
        ];
      }}
    >
      {icon}
      <Text allowFontScaling style={[typography.bodyStrong, { color: textColor }]}>
        {label}
      </Text>
    </Pressable>
  );
}
