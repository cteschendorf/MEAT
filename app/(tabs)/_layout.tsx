import { Tabs } from 'expo-router';

import { TabBarSymbol } from '@/ui/navigation/tab-bar-symbol';
import { useThemeColors } from '@/ui';

export const unstable_settings = { anchor: '(today)' };

export default function TabsLayout() {
  const colors = useThemeColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="(today)"
        options={{
          href: '/',
          title: 'Today',
          tabBarAccessibilityLabel: 'Today tab',
          tabBarIcon: ({ color, focused }) => (
            <TabBarSymbol color={color} focused={focused} name="calendar" selectedName="calendar.circle.fill" />
          ),
        }}
      />
      <Tabs.Screen
        name="(journal)"
        options={{
          href: '/journal',
          title: 'Journal',
          tabBarAccessibilityLabel: 'Journal tab',
          tabBarIcon: ({ color, focused }) => (
            <TabBarSymbol color={color} focused={focused} name="book.closed" selectedName="book.closed.fill" />
          ),
        }}
      />
      <Tabs.Screen
        name="(friends)"
        options={{
          href: '/friends',
          title: 'Friends',
          tabBarAccessibilityLabel: 'Friends tab',
          tabBarIcon: ({ color, focused }) => (
            <TabBarSymbol color={color} focused={focused} name="person.2" selectedName="person.2.fill" />
          ),
        }}
      />
      <Tabs.Screen
        name="(me)"
        options={{
          href: '/me',
          title: 'Me',
          tabBarAccessibilityLabel: 'Me tab',
          tabBarIcon: ({ color, focused }) => (
            <TabBarSymbol color={color} focused={focused} name="person.crop.circle" selectedName="person.crop.circle.fill" />
          ),
        }}
      />
    </Tabs>
  );
}
