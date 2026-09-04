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
      style={{
        borderRadius: radii.card,
        gap: 0,
        minHeight: 72,
        overflow: 'hidden',
        padding: 0,
        width: '100%',
      }}
    >
      <View style={{ alignItems: 'stretch', flex: 1, flexDirection: 'row' }}>
        {entry.thumbnailUri ? (
          <Image
            accessible
            accessibilityLabel={`Photo for ${entry.foodSummary}`}
            contentFit="cover"
            source={{ uri: entry.thumbnailUri }}
            style={{ backgroundColor: colors.surfaceElevated, height: 72, width: 72 }}
          />
        ) : null}
        <View
          style={{
            flex: 1,
            gap: 2,
            justifyContent: 'center',
            minWidth: 0,
            paddingHorizontal: 14,
            paddingVertical: spacing.xs,
          }}
        >
          <Text
            allowFontScaling
            numberOfLines={2}
            selectable
            style={[typography.bodyStrong, { color: colors.textPrimary }]}
          >
            {entry.foodSummary}
          </Text>
          {entry.mealTitle || entry.locationLabel ? (
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minWidth: 0 }}>
              {entry.mealTitle ? (
                <Text
                  allowFontScaling
                  numberOfLines={1}
                  selectable
                  style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]}
                >
                  {entry.mealTitle}
                </Text>
              ) : null}
              {entry.locationLabel ? (
                <Text
                  allowFontScaling
                  numberOfLines={1}
                  selectable
                  style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]}
                >
                  At {entry.locationLabel}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={{ alignItems: 'baseline', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' }}>
            <Text
              allowFontScaling
              numberOfLines={1}
              selectable
              style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}
            >
              {itemDetail(entry)}
            </Text>
            <Text
              allowFontScaling
              selectable
              style={[typography.caption, { color: colors.textSecondary, fontVariant: ['tabular-nums'] }]}
            >
              {timelineTime(entry.occurredAt)}
            </Text>
          </View>
        </View>
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
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, width: '100%' })}
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
    <View style={{ gap: spacing.xs }}>
      {section.dayKey ? (
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' }}>
          <Text
            accessibilityRole="header"
            allowFontScaling
            selectable
            style={[typography.overline, { color: colors.textSecondary, flex: 1 }]}
          >
            · {timelineDayHeading(section.dayKey)}
          </Text>
          <Text allowFontScaling selectable style={[typography.tabLabel, { color: colors.textSecondary }] }>
            {section.entries.length} {section.entries.length === 1 ? 'meal' : 'meals'}
          </Text>
        </View>
      ) : null}
      <View style={{ gap: spacing.xs }}>
        {section.entries.map((entry) => (
          <TimelineCard entry={entry} key={entry.id} onPress={onPressEntry} />
        ))}
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
    <View accessibilityLabel="Meal timeline" style={{ gap: spacing.md }}>
      {sections.map((section) => (
        <TimelineSectionView key={section.dayKey || 'timeline'} onPressEntry={onPressEntry} section={section} />
      ))}
    </View>
  );
}
