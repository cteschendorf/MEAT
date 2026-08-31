import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import {
  compareTimelineEntriesChronologically,
  groupTimelineEntries,
  timelineDayHeading,
  type MealTimelineEntry,
  type MealTimelineSection,
} from '@/services/meals/meal-timeline-presentation';
import { Surface } from '@/ui/components/surface';
import { radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

function timelineTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function itemDetail(entry: MealTimelineEntry): string {
  const portions = entry.items
    .map((item) => item.portionText)
    .filter((value): value is string => value !== null);
  if (portions.length === entry.items.length && portions.length > 0) return portions.join(' · ');
  return `${entry.items.length} logged ${entry.items.length === 1 ? 'item' : 'items'}`;
}

function timelineAccessibilityLabel(entry: MealTimelineEntry): string {
  return [
    timelineTime(entry.occurredAt),
    entry.foodSummary,
    entry.mealTitle ? `Meal name: ${entry.mealTitle}` : null,
    entry.locationLabel ? `At ${entry.locationLabel}` : null,
    itemDetail(entry),
    entry.thumbnailUri ? 'Photo attached' : null,
  ].filter((value): value is string => value !== null).join('. ');
}

interface TimelineCardProps {
  readonly entry: MealTimelineEntry;
  readonly onPress?: ((entry: MealTimelineEntry) => void) | undefined;
}

function TimelineCard({ entry, onPress }: TimelineCardProps) {
  const colors = useThemeColors();
  const card = (
    <Surface
      accessible={!onPress}
      accessibilityLabel={!onPress ? timelineAccessibilityLabel(entry) : undefined}
      style={{ flex: 1, gap: spacing.sm, padding: spacing.md }}
    >
      <Text
        allowFontScaling
        selectable
        style={[typography.caption, { color: colors.action, fontVariant: ['tabular-nums'], fontWeight: '600' }]}
      >
        {timelineTime(entry.occurredAt)}
      </Text>
      <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }] }>
            {entry.foodSummary}
          </Text>
          {entry.mealTitle ? (
            <View
              style={{
                alignSelf: 'flex-start',
                backgroundColor: colors.surfaceMuted,
                borderCurve: 'continuous',
                borderRadius: radii.capsule,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xxs,
              }}
            >
              <Text allowFontScaling selectable style={[typography.caption, { color: colors.textPrimary }] }>
                {entry.mealTitle}
              </Text>
            </View>
          ) : null}
          {entry.locationLabel ? (
            <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }] }>
              At {entry.locationLabel}
            </Text>
          ) : null}
          <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }] }>
            {itemDetail(entry)}
          </Text>
        </View>
        {entry.thumbnailUri ? (
          <Image
            accessible
            accessibilityLabel={`Photo for ${entry.foodSummary}`}
            contentFit="cover"
            source={{ uri: entry.thumbnailUri }}
            style={{ borderRadius: radii.sm, height: 76, width: 76 }}
          />
        ) : null}
        {onPress ? (
          <Image
            accessibilityIgnoresInvertColors
            contentFit="contain"
            source="sf:chevron.right"
            style={{ alignSelf: 'center', height: 16, tintColor: colors.textSecondary, width: 10 }}
          />
        ) : null}
      </View>
    </Surface>
  );

  if (!onPress) return card;

  return (
    <Pressable
      accessibilityHint="Opens meal details"
      accessibilityLabel={timelineAccessibilityLabel(entry)}
      accessibilityRole="button"
      onPress={() => onPress(entry)}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.72 : 1 })}
    >
      {card}
    </Pressable>
  );
}

interface TimelineSectionViewProps {
  readonly onPressEntry?: ((entry: MealTimelineEntry) => void) | undefined;
  readonly section: MealTimelineSection;
}

function TimelineSectionView({ onPressEntry, section }: TimelineSectionViewProps) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: spacing.sm }}>
      {section.dayKey ? (
        <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }] }>
          {timelineDayHeading(section.dayKey)}
        </Text>
      ) : null}
      <View>
        {section.entries.map((entry, index) => {
          const first = index === 0;
          const last = index === section.entries.length - 1;
          return (
            <View key={entry.id} style={{ flexDirection: 'row', gap: spacing.sm, paddingBottom: last ? 0 : spacing.md }}>
              <View accessible={false} style={{ position: 'relative', width: 20 }}>
                {!first ? (
                  <View style={{ backgroundColor: colors.border, height: 23, left: 9, position: 'absolute', top: 0, width: 2 }} />
                ) : null}
                {!last ? (
                  <View style={{ backgroundColor: colors.border, bottom: -spacing.md, left: 9, position: 'absolute', top: 23, width: 2 }} />
                ) : null}
                <View
                  style={{
                    backgroundColor: colors.action,
                    borderColor: colors.background,
                    borderRadius: radii.capsule,
                    borderWidth: 3,
                    height: 14,
                    left: 3,
                    position: 'absolute',
                    top: 17,
                    width: 14,
                  }}
                />
              </View>
              <TimelineCard entry={entry} onPress={onPressEntry} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

export interface MealTimelineProps {
  readonly entries: readonly MealTimelineEntry[];
  readonly onPressEntry?: (entry: MealTimelineEntry) => void;
  readonly showDayHeadings?: boolean;
}

export function MealTimeline({ entries, onPressEntry, showDayHeadings = true }: MealTimelineProps) {
  const sections: readonly MealTimelineSection[] = showDayHeadings
    ? groupTimelineEntries(entries)
    : [{ dayKey: '', entries: [...entries].sort(compareTimelineEntriesChronologically) }];

  return (
    <View accessibilityLabel="Meal timeline" style={{ gap: spacing.lg }}>
      {sections.map((section) => (
        <TimelineSectionView key={section.dayKey || 'timeline'} onPressEntry={onPressEntry} section={section} />
      ))}
    </View>
  );
}
