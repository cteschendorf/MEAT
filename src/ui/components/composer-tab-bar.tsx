import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { entryTabs, isEntryTabReady, type EntryTabId } from '@/ui/composer/entry-tabs';
import { iconSizes, minimumTouchTarget, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface ComposerTabBarProps {
  readonly active: EntryTabId;
  readonly onSelect: (id: EntryTabId) => void;
}

/**
 * Scan · Search · AI · Quick Add · Library, as one row of peers.
 *
 * Each tab is a glyph and a word, and the active one is underlined rather than
 * filled. That is the same grammar as the app's own bottom bar, so the two rows
 * on screen at once read as the same kind of thing — and an underline costs no
 * width, which matters when five labels share a phone.
 *
 * Every tab stays pressable, including the ones whose feature has not shipped:
 * the mode below says what is missing, which teaches more than a control that
 * will not respond. Nothing here disables on a write in flight either —
 * switching tabs mid-save is harmless, because the draft belongs to the sheet
 * rather than to any mode (THI-328).
 *
 * The row scrolls rather than compressing. At the largest accessibility text
 * sizes five labels do not fit, and a tab whose text is clipped to three
 * letters is not a tab anyone can use.
 */
export function ComposerTabBar({ active, onSelect }: ComposerTabBarProps) {
  const colors = useThemeColors();

  return (
    <View
      accessibilityRole="tablist"
      style={{
        borderBottomColor: colors.border,
        borderBottomWidth: 1,
        backgroundColor: colors.surface,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: spacing.xs }}
      >
        {entryTabs.map((tab) => {
          const selected = tab.id === active;
          const ready = isEntryTabReady(tab.id);
          // A tab with nothing behind it reads as available but quieter,
          // which is what it is.
          const tone = selected
            ? colors.brandStrong
            : ready
              ? colors.textPrimary
              : colors.textSecondary;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityLabel={tab.accessibilityLabel}
              accessibilityState={{ selected }}
              accessibilityHint={ready ? undefined : 'This way of adding food is not built yet.'}
              onPress={() => onSelect(tab.id)}
              style={(state) => ({
                flexGrow: 1,
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: minimumTouchTarget,
                paddingHorizontal: spacing.sm,
                paddingTop: spacing.xs,
                opacity: state.pressed ? 0.7 : 1,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xxs }}>
                <Image
                  accessibilityIgnoresInvertColors
                  contentFit="contain"
                  source={`sf:${tab.icon}`}
                  style={{ width: iconSizes.control, height: iconSizes.control, tintColor: tone }}
                />
                <Text
                  allowFontScaling
                  numberOfLines={1}
                  style={[selected ? typography.bodyStrong : typography.body, { color: tone }]}
                >
                  {tab.title}
                </Text>
              </View>
              <View
                accessible={false}
                style={{
                  alignSelf: 'stretch',
                  height: 2,
                  marginTop: spacing.xs,
                  borderRadius: 1,
                  backgroundColor: selected ? colors.brand : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
