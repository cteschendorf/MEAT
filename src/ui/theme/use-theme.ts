import { useColorScheme } from 'react-native';

import { darkColors, lightColors } from '@/ui/theme/colors';

export function useThemeColors() {
  return useColorScheme() === 'dark' ? darkColors : lightColors;
}
