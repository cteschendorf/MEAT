import { Tabs, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { AddFoodTabIcon } from '@/ui/navigation/add-food-tab-icon';
import { TabBarSymbol } from '@/ui/navigation/tab-bar-symbol';
import { typography, useThemeColors } from '@/ui';

export const unstable_settings = { anchor: '(today)' };

export default function TabsLayout() {
  const colors = useThemeColors();
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentOnChrome,
        tabBarInactiveTintColor: colors.textSecondaryOnChrome,
        tabBarLabelStyle: typography.tabLabel,
        tabBarStyle: {
          backgroundColor: colors.chrome,
          borderTopColor: colors.chromeBorder,
          borderTopWidth: 1,
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
            <TabBarSymbol
              androidName="home"
              color={color}
              focused={focused}
              name="house"
              selectedName="house.fill"
            />
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
            <TabBarSymbol
              androidName="calendar_month"
              androidSelectedName="calendar_today"
              color={color}
              focused={focused}
              name="calendar"
              selectedName="calendar.circle.fill"
            />
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
          tabBarButton: ({ children, onLongPress, style, testID }) => (
            <Pressable
              accessibilityLabel="Add food"
              accessibilityRole="button"
              onLongPress={onLongPress ?? undefined}
              onPress={() => router.push('/log-food')}
              style={style}
              testID={testID}
            >
              {children}
            </Pressable>
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
            <TabBarSymbol
              androidName="group"
              color={color}
              focused={focused}
              name="person.2"
              selectedName="person.2.fill"
            />
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
            <TabBarSymbol
              androidName="person"
              color={color}
              focused={focused}
              name="person"
              selectedName="person.fill"
            />
          ),
        }}
      />
    </Tabs>
  );
}
