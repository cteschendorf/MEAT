import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, ScrollView, Text, View } from 'react-native';

import type { Meal, MediaAsset } from '@/domain';
import type { ISODateTime, MealId } from '@/domain/shared/ids';
import {
  buildMealTimelineEntries,
  openAppServices,
  type MealTimelineEntry,
} from '@/services';
import {
  ActionButton,
  ScreenState,
  Surface,
  radii,
  spacing,
  typography,
  useThemeColors,
} from '@/ui';
import { useMutationRouteGuard } from '@/ui/navigation/use-mutation-route-guard';

interface LoadedMealEvent {
  readonly entry: MealTimelineEntry;
  readonly meal: Meal;
  readonly media: readonly MediaAsset[];
}

function routeValue(value: string | readonly string[] | undefined): string | null {
  return typeof value === 'string' ? value : value?.[0] ?? null;
}

function eventDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return date.toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function MealDetailScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const mealId = routeValue(params.id);
  const [loaded, setLoaded] = useState<LoadedMealEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const requestGeneration = useRef(0);
  const queueRouteExit = useMutationRouteGuard(
    deleting,
    'Please wait while this meal event is deleted.',
  );

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    if (!mealId) {
      setLoaded(null);
      setError('This meal event does not have a valid identifier.');
      setLoading(false);
      return;
    }
    try {
      const services = await openAppServices();
      const meal = await services.meals.getById(mealId as MealId);
      if (!meal) throw new Error('This meal event is no longer available.');
      const [entries, media] = await Promise.all([
        buildMealTimelineEntries([meal], services.foods, { media: services.media }),
        services.media.listByIds(meal.mediaIds),
      ]);
      const entry = entries[0];
      if (!entry) throw new Error('This meal event could not be displayed.');
      if (requestGeneration.current !== generation) return;
      const mediaById = new Map(media.map((asset) => [asset.id, asset]));
      setLoaded({
        entry,
        meal,
        media: meal.mediaIds.flatMap((id) => {
          const asset = mediaById.get(id);
          return asset ? [asset] : [];
        }),
      });
      setError(null);
      setActionError(null);
      setLoading(false);
    } catch (caught) {
      if (requestGeneration.current !== generation) return;
      setLoaded(null);
      setError(caught instanceof Error ? caught.message : 'Unable to load this meal event.');
      setLoading(false);
    }
  }, [mealId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        requestGeneration.current += 1;
      };
    }, [load]),
  );

  const deleteEvent = useCallback(async () => {
    if (!mealId || deleting) return;
    setDeleting(true);
    setActionError(null);
    try {
      const services = await openAppServices();
      const pending = await services.mealHistory.deleteWithUndo(
        mealId as MealId,
        new Date().toISOString() as ISODateTime,
      );
      AccessibilityInfo.announceForAccessibility('Meal deleted. Undo is available for 10 seconds.');
      queueRouteExit(() => router.dismissTo({
        pathname: '/meal-deleted',
        params: { token: pending.token },
      }));
      setDeleting(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to delete this meal event.';
      setActionError(message);
      AccessibilityInfo.announceForAccessibility(message);
      setDeleting(false);
    }
  }, [deleting, mealId, queueRouteExit, router]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Delete this meal event?',
      'The event disappears immediately, but you will have 10 seconds to undo. Its photos remain protected during that window.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteEvent() },
      ],
    );
  }, [deleteEvent]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: spacing.lg, padding: spacing.md, paddingBottom: spacing.xxl }}
      style={{ backgroundColor: colors.background }}
    >
      {loading ? <ScreenState title="Loading meal" message="Gathering this event and its private photos…" /> : null}

      {error ? (
        <Surface>
          <ScreenState role="alert" title="Meal unavailable" message={error} />
          <ActionButton label="Return to Today" tone="secondary" onPress={() => router.dismissTo('/')} />
        </Surface>
      ) : null}

      {loaded ? (
        <>
          <View style={{ gap: spacing.xs }}>
            <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }] }>
              {loaded.entry.foodSummary}
            </Text>
            <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary, fontVariant: ['tabular-nums'] }] }>
              {eventDateTime(loaded.meal.occurredAt)}
            </Text>
            {loaded.meal.title ? (
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
                  {loaded.meal.title}
                </Text>
              </View>
            ) : null}
          </View>

          <Surface>
            <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }] }>
              Foods
            </Text>
            {loaded.entry.items.map((item) => (
              <View key={item.id} style={{ gap: spacing.xxs }}>
                <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }] }>
                  {item.name}
                </Text>
                <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }] }>
                  {item.portionText ?? 'Saved portion'}
                </Text>
              </View>
            ))}
          </Surface>

          {loaded.meal.location || loaded.meal.caption ? (
            <Surface>
              <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }] }>
                Context
              </Text>
              {loaded.meal.location ? (
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.xs }}>
                  <Image
                    accessibilityIgnoresInvertColors
                    contentFit="contain"
                    source="sf:mappin.and.ellipse"
                    style={{ height: 20, tintColor: colors.action, width: 20 }}
                  />
                  <Text allowFontScaling selectable style={[typography.body, { color: colors.textPrimary }] }>
                    {loaded.meal.location.label}
                  </Text>
                </View>
              ) : null}
              {loaded.meal.caption ? (
                <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }] }>
                  {loaded.meal.caption}
                </Text>
              ) : null}
            </Surface>
          ) : null}

          {loaded.media.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }] }>
                Photos
              </Text>
              <ScrollView
                accessibilityLabel="Meal photos"
                contentContainerStyle={{ gap: spacing.sm }}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {loaded.media.map((asset, index) => (
                  <Image
                    key={asset.id}
                    accessible
                    accessibilityLabel={`Meal photo ${index + 1} of ${loaded.media.length}`}
                    contentFit="cover"
                    source={{ uri: asset.uri }}
                    style={{ borderRadius: radii.md, height: 180, width: 180 }}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={{ gap: spacing.sm }}>
            {actionError ? <ScreenState role="alert" title="Action unavailable" message={actionError} /> : null}
            <ActionButton
              label="Edit event"
              onPress={() => router.push({ pathname: '/log-food', params: { mealId: loaded.meal.id } })}
            />
            <ActionButton
              disabled={deleting}
              label={deleting ? 'Deleting…' : 'Delete event'}
              onPress={confirmDelete}
              tone="destructive"
            />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

export default MealDetailScreen;
