import Stack from 'expo-router/stack';

import { BrandLockup, useThemeColors } from '@/ui';

export interface TabStackProps {
  readonly screenName: string;
}

export function TabStack({ screenName }: TabStackProps) {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.chrome },
        headerTintColor: colors.brand,
        headerTitle: () => <BrandLockup markSize={30} />,
      }}
    >
      <Stack.Screen name={screenName} />
    </Stack>
  );
}
