import { Image, type ImageProps } from 'expo-image';

export interface BrandMarkProps extends Omit<ImageProps, 'accessibilityLabel' | 'contentFit' | 'source'> {
  accessibilityLabel?: string;
  decorative?: boolean;
  size?: number;
}

const markSource = require('../../../assets/brand/meat-t-bone-mark.png');

export function BrandMark({
  accessibilityLabel = 'MEAT',
  decorative = false,
  size = 36,
  style,
  ...props
}: BrandMarkProps) {
  const accessibilityProps = decorative
    ? {
        accessibilityElementsHidden: true,
        accessible: false,
        importantForAccessibility: 'no-hide-descendants' as const,
      }
    : { accessibilityLabel, accessibilityRole: 'image' as const, accessible: true };

  return (
    <Image
      {...props}
      {...accessibilityProps}
      contentFit="contain"
      source={markSource}
      style={[{ height: size, width: size }, style]}
      transition={0}
    />
  );
}
