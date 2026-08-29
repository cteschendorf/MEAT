import { Tabs, type ErrorBoundaryProps } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

function AppScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text selectable style={{ fontSize: 20, fontWeight: '600' }}>
        Something went wrong
      </Text>
      <Text selectable>{error.message}</Text>
      <Pressable accessibilityRole="button" onPress={retry}>
        <Text style={{ fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export const unstable_settings = {
  screenErrorBoundary: AppScreenErrorBoundary,
};

export default function RootLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="me" options={{ title: 'Me' }} />
    </Tabs>
  );
}
