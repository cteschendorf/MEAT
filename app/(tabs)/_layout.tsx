import { Tabs, useRouter } from 'expo-router';

import { AddFoodTabIcon } from '@/ui/navigation/add-food-tab-icon';
import { TabBarSymbol } from '@/ui/navigation/tab-bar-symbol';
import { useThemeColors } from '@/ui';

export const unstable_settings = { anchor: '(today)' };

export default function TabsLayout() {
  const colors = useThemeColors();
  const router = useRouter();

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
      {/* The middle of the bar is a button, not a place. Its press is
          intercepted here so the tab never becomes the selected one: the
          composer opens on top of whatever the user was looking at, and
          closing it returns them there rather than to an empty "Add" tab. */}
      <Tabs.Screen
        name="(add)"
        options={{
          title: 'Add food',
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: 'Add food',
          tabBarIcon: () => <AddFoodTabIcon />,
        }}
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.push('/log-food');
          },
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
