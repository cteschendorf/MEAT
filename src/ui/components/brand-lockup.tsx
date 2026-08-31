import { Text, View, type ViewProps } from 'react-native';

import { BrandMark } from '@/ui/components/brand-mark';
import { spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface BrandLockupProps extends ViewProps {
  accessibilityLabel?: string;
  markSize?: number;
}

export function BrandLockup({ accessibilityLabel = 'MEAT', markSize = 36, style, ...props }: BrandLockupProps) {
  const colors = useThemeColors();

  return (
    <View
      {...props}
      accessibilityLabel={accessibilityLabel}
      accessible
      style={[{ alignItems: 'center', flexDirection: 'row', gap: spacing.xs }, style]}
    >
      <BrandMark decorative size={markSize} />
      <Text allowFontScaling style={[typography.wordmark, { color: colors.brand }]}>MEAT</Text>
    </View>
  );
}
