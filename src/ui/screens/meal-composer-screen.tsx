import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Food, MealContextInput, MealLocation, MediaAsset } from '@/domain';
import type {
  FoodCandidate,
  FoodPortion,
  FoodSearchGroup,
  FoodSourceId,
} from '@/domain/food/source';
import { sourceIdFromFoodId } from '@/domain/food/source';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  MealItemId,
  MediaId,
} from '@/domain/shared/ids';
import type { LocalMealPhoto } from '@/platform';
import {
  defaultLocalIdFactory,
  openAppServices,
  type AppServices,
} from '@/services';
import { ExclusiveActionGate } from '@/services/actions/exclusive-action';
import { candidateFromFood } from '@/services/logging/food-discovery';
import type { FoodSuggestion } from '@/services/logging/food-suggestions';
import {
  MealPhotoComposerCoordinator,
  type MealPhotoPickerAdapter,
  type MealPhotoRollbackResult,
} from '@/services/media/meal-photo-workflow';
import type { MealDraft } from '@/services/meals/meal-composer';
import {
  ActionButton,
  ScreenState,
  Surface,
  minimumTouchTarget,
  radii,
  spacing,
  typography,
  useThemeColors,
} from '@/ui';
import {
  mealComposerSessions,
  type MealComposerSession,
} from '@/ui/meal-composer-session';
import {
  contextFromRawMealValues,
  isCustomMealTitle,
  rawMealContextForDraft,
  rebaseComposerAddition,
} from '@/ui/meal-composer-state';

const sourceDefinitions: readonly {
  id: FoodSourceId;
  name: string;
  detail: string;
}[] = [
  { id: 'personal', name: 'My Foods', detail: 'Foods you created and retained in your own library.' },
  { id: 'usda-core', name: 'USDA Core', detail: 'Foundation, FNDDS, and SR Legacy foods stored on this device.' },
  { id: 'usda-fdc', name: 'USDA Online', detail: 'Independent FoodData Central results from the MEAT proxy.' },
  { id: 'open-food-facts', name: 'Open Food Facts', detail: 'Independent packaged-food records from Open Food Facts.' },
];

const sourceNames: Readonly<Record<FoodSourceId, string>> = {
  personal: 'My Foods',
  'usda-core': 'USDA Core',
  'usda-fdc': 'USDA Online',
  'open-food-facts': 'Open Food Facts',
};

const presetMealNames = ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const;

interface MealContextPatch {
  readonly occurredAt?: ISODateTime;
  readonly title?: string | null;
  readonly caption?: string | null;
  readonly location?: MealLocation | null;
}

function sourceForFood(food: Food): FoodSourceId {
  return sourceIdFromFoodId(food.id) ?? 'personal';
}

function preferredPortion(candidate: FoodCandidate): FoodPortion | undefined {
  return (
    candidate.portions.find((portion) => portion.isDefault && (portion.gramWeight ?? 0) > 0) ??
    candidate.portions.find((portion) => (portion.gramWeight ?? 0) > 0)
  );
}

function portionLabel(portion: FoodPortion): string {
  const grams = portion.gramWeight === undefined ? '' : ` · ${Math.round(portion.gramWeight * 10) / 10} g`;
  return `${portion.label}${grams}`;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function currentIso(): ISODateTime {
  return new Date().toISOString() as ISODateTime;
}

function combineDatePart(current: Date, selected: Date, part: 'date' | 'time'): Date {
  const next = new Date(current);
  if (part === 'date') {
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  } else {
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  }
  return next;
}

function mediaAssetFor(photo: LocalMealPhoto, updatedAt: ISODateTime): MediaAsset {
  return {
    id: photo.id,
    kind: 'photo',
    storage: 'local',
    uri: photo.uri,
    mimeType: photo.mimeType,
    width: photo.width,
    height: photo.height,
    byteSize: photo.byteSize,
    createdAt: photo.createdAt,
    updatedAt,
  };
}

const expoMealPhotoPicker: MealPhotoPickerAdapter<ImagePicker.ImagePickerAsset> = {
  async requestPermission(source) {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      return { granted: permission.granted, canAskAgain: permission.canAskAgain };
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return {
      granted: permission.granted,
      canAskAgain: permission.canAskAgain,
      ...(permission.accessPrivileges === undefined
        ? {}
        : { accessPrivileges: permission.accessPrivileges }),
    };
  },
  async launch(source, options) {
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 1,
          exif: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, options.selectionLimit),
          quality: 1,
          exif: false,
        });
    return { canceled: result.canceled, assets: result.assets ?? [] };
  },
};

function photoCoordinator(services: AppServices) {
  return new MealPhotoComposerCoordinator(
    expoMealPhotoPicker,
    services.mealPhotoFiles,
    () => defaultLocalIdFactory('media') as MediaId,
    currentIso,
  );
}

export function MealComposerScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    draftId?: string;
    mealId?: string;
    occurredAt?: string;
  }>();
  const [initialParams] = useState(() => ({
    draftId: typeof params.draftId === 'string' ? params.draftId : undefined,
    mealId: typeof params.mealId === 'string' ? params.mealId : undefined,
    occurredAt: typeof params.occurredAt === 'string' ? params.occurredAt : undefined,
  }));
  const [services, setServices] = useState<AppServices | null>(null);
  const [session, setSession] = useState<MealComposerSession | null>(null);
  const [foodById, setFoodById] = useState<ReadonlyMap<FoodId, Food>>(new Map());
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [groups, setGroups] = useState<Partial<Record<FoodSourceId, FoodSearchGroup>>>({});
  const [enabledSources, setEnabledSources] = useState<ReadonlySet<FoodSourceId>>(
    () => new Set(sourceDefinitions.map((source) => source.id)),
  );
  const [suggestions, setSuggestions] = useState<readonly FoodSuggestion[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<ReadonlySet<FoodId>>(new Set());
  const [selected, setSelected] = useState<FoodCandidate | null>(null);
  const [selectedServingId, setSelectedServingId] = useState<FoodServingId | undefined>();
  const [grams, setGrams] = useState('100');
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [customMealName, setCustomMealName] = useState(false);
  const [titleText, setTitleText] = useState('');
  const [locationText, setLocationText] = useState('');
  const [captionText, setCaptionText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [savedWithoutNavigation, setSavedWithoutNavigation] = useState(false);
  const [deletionTokenWithoutNavigation, setDeletionTokenWithoutNavigation] = useState<string | null>(null);
  const searchGeneration = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  const initialExistingMedia = useRef<readonly MediaAsset[]>([]);
  const completed = useRef(false);
  const [actionGate] = useState(() => new ExclusiveActionGate());
  const [locallyPublishedDrafts] = useState(() => new WeakSet<object>());

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    void openAppServices()
      .then(async (nextServices) => {
        if (!active) return;
        let nextSession: MealComposerSession | null = initialParams.draftId
          ? mealComposerSessions.get(initialParams.draftId as MealId)
          : null;
        if (!nextSession && initialParams.mealId) {
          const draft = await nextServices.mealComposer.loadDraft(initialParams.mealId as MealId);
          const existingMedia = await nextServices.media.listByIds(draft.context.mediaIds ?? []);
          initialExistingMedia.current = existingMedia;
          nextSession = { draft, existingMedia, stagedPhotos: [] };
        }
        if (!nextSession) {
          const now = currentIso();
          const requestedTime = initialParams.occurredAt
            ? new Date(initialParams.occurredAt)
            : new Date(now);
          const occurredAt = (Number.isNaN(requestedTime.getTime()) ? now : requestedTime.toISOString()) as ISODateTime;
          nextSession = {
            draft: nextServices.mealComposer.createDraft({ occurredAt }, now),
            existingMedia: [],
            stagedPhotos: [],
          };
        }
        nextServices.mealComposer.assertDraftWritable(nextSession.draft);
        locallyPublishedDrafts.add(nextSession.draft);
        mealComposerSessions.put(nextSession);
        setServices(nextServices);
        setSession(nextSession);
        setShowContext(
          Boolean(
            nextSession.draft.context.caption ||
            nextSession.draft.context.location ||
            nextSession.existingMedia.length ||
            nextSession.stagedPhotos.length,
          ),
        );
        const existingTitle = nextSession.draft.context.title;
        setTitleText(existingTitle ?? '');
        setLocationText(nextSession.draft.context.location?.label ?? '');
        setCaptionText(nextSession.draft.context.caption ?? '');
        setCustomMealName(
          Boolean(existingTitle && !presetMealNames.includes(existingTitle as (typeof presetMealNames)[number])),
        );
        router.setParams({ draftId: nextSession.draft.id });
        unsubscribe = mealComposerSessions.subscribe(nextSession.draft.id, () => {
          if (!active) return;
          const updated = mealComposerSessions.get(nextSession.draft.id);
          if (updated && !locallyPublishedDrafts.has(updated.draft)) {
            const raw = rawMealContextForDraft(updated.draft);
            setTitleText(raw.title);
            setLocationText(raw.location);
            setCaptionText(raw.caption);
            setCustomMealName(isCustomMealTitle(raw.title, presetMealNames));
            locallyPublishedDrafts.add(updated.draft);
          }
          setSession(updated);
        });

        const now = currentIso();
        const [nextSuggestions, nextFavorites, preferences] = await Promise.all([
          nextServices.suggestions.listSuggestions(now),
          nextServices.favorites.listFavoriteIds(),
          nextServices.preferences.list(),
        ]);
        if (!active) return;
        setSuggestions(nextSuggestions);
        setFavoriteIds(new Set(nextFavorites));
        setEnabledSources(
          new Set(preferences.filter((preference) => preference.enabled).map((preference) => preference.sourceId)),
        );
      })
      .catch((error: unknown) => {
        if (active) setMessage(messageFor(error, 'Unable to prepare the meal composer.'));
      });

    return () => {
      active = false;
      unsubscribe();
      searchGeneration.current += 1;
      searchController.current?.abort();
    };
  }, [initialParams, locallyPublishedDrafts, router]);

  useEffect(() => {
    if (!services || !session) return;
    let active = true;
    void Promise.allSettled(session.draft.items.map((item) => services.foods.getById(item.foodId)))
      .then((results) => {
        if (!active) return;
        const resolved = new Map<FoodId, Food>();
        results.forEach((result, index) => {
          if (result.status !== 'fulfilled' || !result.value) return;
          const item = session.draft.items[index];
          if (item) resolved.set(item.foodId, result.value);
        });
        setFoodById(resolved);
      });
    return () => {
      active = false;
    };
  }, [services, session]);

  useEffect(() => {
    const cleanup = navigation.addListener('beforeRemove', (event) => {
      if (completed.current || !session) return;
      if (actionGate.isActive) {
        event.preventDefault();
        AccessibilityInfo.announceForAccessibility('Please wait for the current meal action to finish.');
        return;
      }
      if (services && session.stagedPhotos.length > 0) {
        event.preventDefault();
        completed.current = true;
        mealComposerSessions.clear(session.draft.id);
        void photoCoordinator(services)
          .cancel(session.stagedPhotos)
          .catch(() => undefined)
          .finally(() => navigation.dispatch(event.data.action));
        return;
      }
      mealComposerSessions.clear(session.draft.id);
    });
    return cleanup;
  }, [actionGate, navigation, services, session]);

  function publishDraft(draft: MealDraft): void {
    if (!services || !session) return;
    services.mealComposer.assertDraftWritable(draft);
    locallyPublishedDrafts.add(draft);
    mealComposerSessions.updateDraft(draft);
    setSession(mealComposerSessions.get(draft.id));
  }

  function rebaseAddedItems(base: MealDraft, added: MealDraft): MealDraft {
    const latest = mealComposerSessions.get(base.id)?.draft;
    return rebaseComposerAddition(base, added, latest ?? null);
  }

  function contextWithRawValues(draft: MealDraft): MealContextInput {
    return contextFromRawMealValues(draft, {
      title: titleText,
      location: locationText,
      caption: captionText,
    });
  }

  function openComposerChild(pathname: '/meals-recipes' | '/scan-barcode' | '/manual-food'): void {
    if (!services || !session || actionGate.isActive) return;
    try {
      const draft = services.mealComposer.withContext(session.draft, contextWithRawValues(session.draft));
      publishDraft(draft);
      router.push({ pathname, params: { draftId: draft.id } });
    } catch (error) {
      setMessage(messageFor(error, 'Unable to open this food option.'));
    }
  }

  function updateContext(values: MealContextPatch): void {
    if (!services || !session || actionGate.isActive) return;
    try {
      const current = session.draft.context;
      const title = 'title' in values ? values.title ?? undefined : current.title;
      const caption = 'caption' in values ? values.caption ?? undefined : current.caption;
      const location = 'location' in values ? values.location ?? undefined : current.location;
      const next: MealContextInput = {
        occurredAt: values.occurredAt ?? current.occurredAt,
        ...(title === undefined ? {} : { title }),
        ...(caption === undefined ? {} : { caption }),
        ...(location === undefined ? {} : { location }),
        ...(current.mediaIds === undefined ? {} : { mediaIds: current.mediaIds }),
      };
      publishDraft(services.mealComposer.withContext(session.draft, next));
      setMessage(null);
    } catch (error) {
      setMessage(messageFor(error, 'That meal detail is not valid.'));
    }
  }

  async function refreshSuggestions(nextServices = services): Promise<void> {
    if (!nextServices) return;
    const now = currentIso();
    const [nextSuggestions, nextFavorites] = await Promise.all([
      nextServices.suggestions.listSuggestions(now),
      nextServices.favorites.listFavoriteIds(),
    ]);
    setSuggestions(nextSuggestions);
    setFavoriteIds(new Set(nextFavorites));
  }

  async function runAction(name: string, action: () => Promise<void>): Promise<void> {
    await actionGate.run(async () => {
      setBusyAction(name);
      setMessage(null);
      try {
        await action();
      } finally {
        setBusyAction(null);
      }
    });
  }

  async function search(): Promise<void> {
    if (!services) return;
    const normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 80) {
      setMessage('Enter a search term between 2 and 80 characters.');
      return;
    }

    const generation = searchGeneration.current + 1;
    searchGeneration.current = generation;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSubmittedQuery(normalized);
    setSelected(null);
    setMessage(null);

    const preferences = await services.preferences.list();
    if (generation !== searchGeneration.current) return;
    const enabled = new Set(
      preferences.filter((preference) => preference.enabled).map((preference) => preference.sourceId),
    );
    setEnabledSources(enabled);
    const loading: Partial<Record<FoodSourceId, FoodSearchGroup>> = {};
    for (const source of sourceDefinitions) {
      if (enabled.has(source.id)) loading[source.id] = { sourceId: source.id, query: normalized, state: 'loading' };
    }
    setGroups(loading);

    try {
      const results = await services.discovery.search(normalized, {
        limit: 12,
        signal: controller.signal,
        onGroup: (group) => {
          if (generation === searchGeneration.current) {
            setGroups((current) => ({ ...current, [group.sourceId]: group }));
          }
        },
      });
      if (generation !== searchGeneration.current) return;
      const resolved: Partial<Record<FoodSourceId, FoodSearchGroup>> = {};
      results.forEach((group) => {
        resolved[group.sourceId] = group;
      });
      for (const source of sourceDefinitions) {
        if (enabled.has(source.id) && !resolved[source.id]) {
          resolved[source.id] = {
            sourceId: source.id,
            query: normalized,
            state: 'error',
            candidates: [],
            issue: {
              kind: 'error',
              code: 'source-unavailable',
              message: `${source.name} did not return a search status.`,
            },
          };
        }
      }
      setGroups(resolved);
    } catch (error) {
      if (generation !== searchGeneration.current) return;
      setMessage(messageFor(error, 'Search could not start.'));
    }
  }

  function selectCandidate(candidate: FoodCandidate, portion = preferredPortion(candidate)): void {
    setSelected(candidate);
    setSelectedServingId(portion?.id as FoodServingId | undefined);
    setGrams(String(portion?.gramWeight ?? 100));
    setMessage(null);
  }

  async function candidateForFood(food: Food): Promise<FoodCandidate> {
    if (!services) return candidateFromFood(food, sourceForFood(food));
    try {
      return (await services.discovery.getByFoodId(food.id)) ?? candidateFromFood(food, sourceForFood(food));
    } catch {
      return candidateFromFood(food, sourceForFood(food));
    }
  }

  async function addCandidate(candidate: FoodCandidate, gramWeight: number, servingId?: FoodServingId): Promise<void> {
    if (!services || !session) return;
    if (!Number.isFinite(gramWeight) || gramWeight <= 0) {
      setMessage('Enter a portion greater than zero grams.');
      return;
    }
    const base = session.draft;
    const added = await services.mealComposer.addCandidate(base, candidate, {
      portion: { quantity: 1, gramWeight, ...(servingId ? { servingId } : {}) },
    });
    publishDraft(rebaseAddedItems(base, added));
    setSelected(null);
    setMessage(`${candidate.food.name} added. Add another food or confirm the event.`);
  }

  async function addSelected(): Promise<void> {
    if (!selected) return;
    const gramWeight = Number(grams);
    await runAction(`add:${selected.food.id}`, async () => {
      try {
        await addCandidate(selected, gramWeight, selectedServingId);
      } catch (error) {
        setMessage(messageFor(error, 'Unable to add this food.'));
      }
    });
  }

  async function addSuggestion(suggestion: FoodSuggestion): Promise<void> {
    await runAction(`quick:${suggestion.food.id}`, async () => {
      try {
        const candidate = await candidateForFood(suggestion.food);
        await addCandidate(candidate, suggestion.suggestedGramWeight);
      } catch (error) {
        setMessage(messageFor(error, 'Unable to add this food.'));
      }
    });
  }

  async function toggleFavorite(candidate: FoodCandidate): Promise<void> {
    if (!services) return;
    await runAction(`favorite:${candidate.food.id}`, async () => {
      try {
        await services.discovery.persist(candidate);
        await services.suggestions.setFavorite(candidate.food, !favoriteIds.has(candidate.food.id), currentIso());
        await refreshSuggestions(services);
      } catch (error) {
        setMessage(messageFor(error, 'Unable to update this favorite.'));
      }
    });
  }

  function updateItemGrams(itemId: MealItemId, value: string): void {
    if (!services || !session || actionGate.isActive) return;
    const gramWeight = Number(value);
    if (!Number.isFinite(gramWeight) || gramWeight <= 0) {
      setMessage('Portions must be greater than zero grams.');
      return;
    }
    try {
      const item = session.draft.items.find((candidate) => candidate.id === itemId);
      if (!item) return;
      publishDraft(services.mealComposer.updateItemPortion(session.draft, itemId, {
        ...item.portion,
        gramWeight,
      }));
      setMessage(null);
    } catch (error) {
      setMessage(messageFor(error, 'Unable to change this portion.'));
    }
  }

  function removeItem(itemId: MealItemId): void {
    if (!services || !session || actionGate.isActive) return;
    if (initialParams.mealId && session.draft.items.length === 1) {
      Alert.alert(
        'Delete this event?',
        'Removing its final food deletes the entire timeline event. You will have 10 seconds to undo.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete event', style: 'destructive', onPress: () => void deleteExistingEvent() },
        ],
      );
      return;
    }
    try {
      publishDraft(services.mealComposer.removeItem(session.draft, itemId));
    } catch (error) {
      setMessage(messageFor(error, 'Unable to remove this food.'));
    }
  }

  async function deleteExistingEvent(): Promise<void> {
    if (!services || !session || !initialParams.mealId) return;
    await runAction('delete', async () => {
      try {
        const deletion = await services.mealHistory.deleteWithUndo(session.draft.id, currentIso());
        completed.current = true;
        mealComposerSessions.clear(session.draft.id);
        await photoCoordinator(services).cancel(session.stagedPhotos).catch(() => undefined);
        try {
          router.replace({ pathname: '/meal-deleted', params: { token: deletion.token } });
        } catch {
          setDeletionTokenWithoutNavigation(deletion.token);
          setMessage('The event was deleted. Open the Undo screen to restore it within 10 seconds.');
        }
      } catch (error) {
        setMessage(messageFor(error, 'Unable to delete this event.'));
      }
    });
  }

  function chooseTime(event: DateTimePickerEvent, selected?: Date): void {
    const part = pickerMode;
    setPickerMode(null);
    if (!part || event.type === 'dismissed' || !selected || !session) return;
    const next = combineDatePart(new Date(session.draft.context.occurredAt), selected, part);
    if (next.getTime() > Date.now()) {
      setMessage('Meal time cannot be in the future.');
      return;
    }
    updateContext({ occurredAt: next.toISOString() as ISODateTime });
  }

  async function addPhotos(source: 'camera' | 'library'): Promise<void> {
    if (!services || !session) return;
    await runAction(source, async () => {
      try {
        const result = await services.mealComposer.runDraftWrite(
          session.draft,
          () => photoCoordinator(services).pickAndStage({
            source,
            retainedCount: session.existingMedia.length,
            stagedPhotos: session.stagedPhotos,
          }),
        );
        if (result.kind === 'permission-denied') {
          setMessage(
            source === 'camera'
              ? 'Camera access was not granted. You can continue without a photo.'
              : 'Photo-library access was not granted. You can continue without a photo.',
          );
          return;
        }
        if (result.kind === 'limit-reached') {
          setMessage('A meal can contain up to five photos.');
          return;
        }
        if (result.kind === 'cancelled') return;
        const activeSession = mealComposerSessions.get(session.draft.id);
        if (!activeSession) {
          await photoCoordinator(services).cancel(result.stagedPhotos).catch(() => undefined);
          setMessage('This meal draft is no longer available.');
          return;
        }
        try {
          services.mealComposer.assertDraftWritable(activeSession.draft);
        } catch (error) {
          await photoCoordinator(services).cancel(result.stagedPhotos).catch(() => undefined);
          throw error;
        }
        mealComposerSessions.setStagedPhotos(session.draft.id, result.stagedPhotos);
        setMessage(null);
      } catch (error) {
        setMessage(messageFor(
          error,
          source === 'camera'
            ? 'Unable to add a camera photo.'
            : 'Unable to add a library photo.',
        ));
      }
    });
  }

  async function addFromCamera(): Promise<void> {
    await addPhotos('camera');
  }

  async function addFromLibrary(): Promise<void> {
    await addPhotos('library');
  }

  function removePhoto(id: MediaId): void {
    if (!services || !session || actionGate.isActive) return;
    const staged = session.stagedPhotos.find((photo) => photo.id === id);
    if (staged) services.mealPhotoFiles.discard(staged);
    mealComposerSessions.removePhoto(session.draft.id, id);
  }

  async function cancel(): Promise<void> {
    if (actionGate.isActive) return;
    if (!services || !session) {
      router.back();
      return;
    }
    await photoCoordinator(services).cancel(session.stagedPhotos).catch(() => undefined);
    completed.current = true;
    mealComposerSessions.clear(session.draft.id);
    router.back();
  }

  async function confirm(): Promise<void> {
    if (!services || !session) return;
    if (session.draft.items.length === 0) {
      setMessage('Add at least one food before saving this event.');
      return;
    }
    await runAction('confirm', async () => {
      let promoted: readonly LocalMealPhoto[] = [];
      const confirmationRollback: { result?: MealPhotoRollbackResult } = {};
      let committed = false;
      try {
        const now = currentIso();
        const coordinator = photoCoordinator(services);
        const retainedMediaIds = session.existingMedia.map((asset) => asset.id);
        const mediaIds = [...retainedMediaIds, ...session.stagedPhotos.map((photo) => photo.id)];
        const draft = services.mealComposer.withContext(session.draft, {
          ...contextWithRawValues(session.draft),
          mediaIds,
        });
        await services.mealComposer.saveWithMedia(draft, now, async () => {
          promoted = await coordinator.promote(session.stagedPhotos);
          return promoted.map((photo) => mediaAssetFor(photo, now));
        }, async (assets) => {
          await services.media.deleteMany(assets.map((asset) => asset.id)).catch(() => undefined);
          confirmationRollback.result = await coordinator.restoreForRetry(promoted);
        });
        committed = true;

        const retained = new Set(mediaIds);
        const removed = initialExistingMedia.current.filter((asset) => !retained.has(asset.id));
        try {
          await services.mealComposer.runDraftWrite(draft, async () => {
            removed.forEach((asset) => services.mealPhotoFiles.delete(asset.uri));
            await services.media.deleteMany(removed.map((asset) => asset.id));
          });
        } catch {
          // Startup orphan cleanup safely retries a post-commit media cleanup failure.
        }
        completed.current = true;
        mealComposerSessions.clear(session.draft.id);
        try {
          router.dismissTo('/');
        } catch {
          setSavedWithoutNavigation(true);
          setMessage('Your meal was saved, but Today could not open automatically.');
        }
      } catch (error) {
        if (committed) {
          completed.current = true;
          mealComposerSessions.clear(session.draft.id);
          setSavedWithoutNavigation(true);
          setMessage('Your meal was saved, but final screen cleanup could not finish.');
          return;
        }
        const activeSession = mealComposerSessions.get(session.draft.id);
        const rollbackResult = confirmationRollback.result;
        if (rollbackResult && activeSession) {
          const restoredById = new Map(
            rollbackResult.restored.map((photo) => [photo.id, photo]),
          );
          const promotedIds = new Set(promoted.map((photo) => photo.id));
          const restoredSessionPhotos = activeSession.stagedPhotos.flatMap((photo) => {
            const restored = restoredById.get(photo.id);
            if (restored) return [restored];
            return promotedIds.has(photo.id) ? [] : [photo];
          });
          mealComposerSessions.setStagedPhotos(session.draft.id, restoredSessionPhotos);
        }
        setMessage(messageFor(error, 'Unable to save this meal event.'));
      }
    });
  }

  const occurredAt = session ? new Date(session.draft.context.occurredAt) : new Date();
  const currentTitle = titleText;
  const totalPhotos = (session?.existingMedia.length ?? 0) + (session?.stagedPhotos.length ?? 0);
  const inputStyle = useMemo(
    () => [
      typography.body,
      {
        color: colors.textPrimary,
        backgroundColor: colors.surface,
        borderColor: colors.borderStrong,
        borderWidth: 1,
        borderRadius: radii.sm,
        padding: spacing.sm,
      },
    ],
    [colors],
  );

  if (savedWithoutNavigation) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.md }}>
        <Surface>
          <ScreenState title="Meal saved" message="Your meal is safely on the timeline." />
          <ActionButton label="Return to Today" onPress={() => router.dismissTo('/')} />
        </Surface>
      </View>
    );
  }

  if (deletionTokenWithoutNavigation) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.md }}>
        <Surface>
          <ScreenState title="Meal deleted" message="Undo remains available for 10 seconds." role="alert" />
          <ActionButton
            label="Open Undo"
            onPress={() => router.replace({ pathname: '/meal-deleted', params: { token: deletionTokenWithoutNavigation } })}
          />
        </Surface>
      </View>
    );
  }

  function renderCandidate(candidate: FoodCandidate) {
    const selectedHere = selected?.food.id === candidate.food.id;
    const favorite = favoriteIds.has(candidate.food.id);
    return (
      <Surface key={`${candidate.ref.sourceId}:${candidate.ref.recordId}`} tone={selectedHere ? 'muted' : 'default'}>
        <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>
          {candidate.food.name}
        </Text>
        <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
          {candidate.food.brand ? `${candidate.food.brand} · ` : ''}
          {candidate.portions.length
            ? candidate.portions.slice(0, 3).map(portionLabel).join(', ')
            : '100 g portion'}
        </Text>
        <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
          {sourceNames[candidate.ref.sourceId]} · Record {candidate.provenance.recordId}
        </Text>
        <ActionButton
          label={selectedHere ? 'Selected' : 'Choose portion'}
          tone="secondary"
          disabled={busyAction !== null}
          onPress={() => selectCandidate(candidate)}
        />
        <ActionButton
          label={favorite ? 'Remove favorite' : 'Favorite'}
          tone="secondary"
          disabled={busyAction !== null}
          onPress={() => void toggleFavorite(candidate)}
        />
      </Surface>
    );
  }

  function renderProvider(source: (typeof sourceDefinitions)[number]) {
    const enabled = enabledSources.has(source.id);
    const group = groups[source.id];
    let content;
    if (!enabled) {
      content = <ScreenState title="Disabled" message="Enable this source under Me → Food data sources." />;
    } else if (!group || group.state === 'loading') {
      content = <ScreenState title="Searching…" message={`Checking ${source.name}.`} />;
    } else if (group.state === 'empty') {
      content = <ScreenState title="No matches" message={`${source.name} found no matches.`} />;
    } else if (group.state === 'ready') {
      content = <View style={{ gap: spacing.sm }}>{group.candidates.map(renderCandidate)}</View>;
    } else {
      content = (
        <View style={{ gap: spacing.sm }}>
          <ScreenState
            title={group.state === 'offline' ? 'Offline' : group.state === 'throttled' ? 'Temporarily limited' : 'Source unavailable'}
            message={`${group.issue.message}${group.candidates.length ? ' Showing saved results.' : ''}`}
            role={group.state === 'error' ? 'alert' : 'status'}
          />
          {group.candidates.map(renderCandidate)}
        </View>
      );
    }
    return (
      <Surface key={source.id}>
        <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.brand }]}>
          {source.name}
        </Text>
        <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
          {source.detail}
        </Text>
        {content}
      </Surface>
    );
  }

  if (!services || !session) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {message
          ? <ScreenState title="Meal composer unavailable" message={message} role="alert" />
          : <ScreenState title="Preparing your meal" message="Opening food sources and private history…" />}
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
    >
      <Text accessibilityRole="header" allowFontScaling style={[typography.title1, { color: colors.brandStrong }]}>
        {initialParams.mealId ? 'Edit meal event' : 'Build a meal event'}
      </Text>
      <Text allowFontScaling style={[typography.body, { color: colors.textSecondary }]}>
        Add every food from this meal, snack, or sitting, then save it once on your timeline.
      </Text>

      <Surface tone="elevated">
        <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>
          Event foods · {session.draft.items.length}
        </Text>
        {session.draft.items.length === 0 ? (
          <ScreenState title="No foods yet" message="Search, scan, create, or choose a saved meal below." />
        ) : (
          session.draft.items.map((item) => {
            const food = foodById.get(item.foodId);
            return (
              <View key={item.id} style={{ gap: spacing.xs, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm }}>
                <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                  {food?.name ?? 'Unavailable food'}
                </Text>
                <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                  {sourceNames[item.foodRef?.sourceId ?? sourceForFood(food ?? ({ id: item.foodId } as Food))]}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <TextInput
                    accessibilityLabel={`Portion for ${food?.name ?? 'unavailable food'} in grams`}
                    defaultValue={String(item.portion.gramWeight ?? 100)}
                    keyboardType="decimal-pad"
                    onEndEditing={(event) => updateItemGrams(item.id, event.nativeEvent.text)}
                    style={[inputStyle, { flex: 1 }]}
                  />
                  <Text allowFontScaling style={[typography.body, { color: colors.textSecondary }]}>g</Text>
                  <ActionButton label="Remove" tone="secondary" disabled={busyAction !== null} onPress={() => removeItem(item.id)} />
                </View>
              </View>
            );
          })
        )}
      </Surface>

      {suggestions.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Quick add</Text>
          {suggestions.slice(0, 4).map((suggestion) => (
            <Surface key={suggestion.food.id}>
              <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>{suggestion.food.name}</Text>
              <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                {sourceNames[sourceForFood(suggestion.food)]} · {Math.round(suggestion.suggestedGramWeight)} g
              </Text>
              <ActionButton
                label={`Add ${Math.round(suggestion.suggestedGramWeight)} g`}
                disabled={busyAction !== null}
                onPress={() => void addSuggestion(suggestion)}
              />
            </Surface>
          ))}
        </View>
      ) : null}

      <Surface>
        <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Find a food</Text>
        <TextInput
          accessibilityLabel="Search foods"
          accessibilityHint="Search begins only when you press Search."
          placeholder="Search foods"
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          maxLength={80}
          onSubmitEditing={() => void search()}
          returnKeyType="search"
          style={inputStyle}
        />
        <ActionButton label="Search" disabled={busyAction !== null || query.trim().length < 2} onPress={() => void search()} />
        <ActionButton
          label="Saved meals & recipes"
          tone="secondary"
          disabled={busyAction !== null}
          onPress={() => openComposerChild('/meals-recipes')}
        />
        <ActionButton
          label="Scan packaged food"
          tone="secondary"
          disabled={busyAction !== null}
          onPress={() => openComposerChild('/scan-barcode')}
        />
        <ActionButton
          label="Create a food manually"
          tone="secondary"
          disabled={busyAction !== null}
          onPress={() => openComposerChild('/manual-food')}
        />
      </Surface>

      {submittedQuery ? (
        <View style={{ gap: spacing.md }}>
          <Text accessibilityRole="header" allowFontScaling style={[typography.title2, { color: colors.textPrimary }]}>
            Results for “{submittedQuery}”
          </Text>
          {sourceDefinitions.map(renderProvider)}
        </View>
      ) : null}

      {selected ? (
        <Surface tone="muted">
          <Text accessibilityRole="header" allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
            Portion for {selected.food.name}
          </Text>
          <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
            {sourceNames[selected.ref.sourceId]}
          </Text>
          {selected.portions.filter((portion) => (portion.gramWeight ?? 0) > 0).slice(0, 5).map((portion) => (
            <ActionButton
              key={portion.id}
              label={`Use ${portionLabel(portion)}`}
              tone="secondary"
              disabled={busyAction !== null}
              onPress={() => {
                setSelectedServingId(portion.id as FoodServingId);
                setGrams(String(portion.gramWeight));
              }}
            />
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <TextInput
              accessibilityLabel="Portion in grams"
              value={grams}
              onChangeText={setGrams}
              keyboardType="decimal-pad"
              style={[inputStyle, { flex: 1 }]}
            />
            <Text allowFontScaling style={[typography.body, { color: colors.textSecondary }]}>g</Text>
          </View>
          <ActionButton label="Add to event" disabled={busyAction !== null} onPress={() => void addSelected()} />
        </Surface>
      ) : null}

      <Surface>
        <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>When</Text>
        <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
          {occurredAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <ActionButton label="Change date" tone="secondary" disabled={busyAction !== null} style={{ flex: 1 }} onPress={() => { if (!actionGate.isActive) setPickerMode('date'); }} />
          <ActionButton label="Change time" tone="secondary" disabled={busyAction !== null} style={{ flex: 1 }} onPress={() => { if (!actionGate.isActive) setPickerMode('time'); }} />
        </View>
        {pickerMode ? (
          <DateTimePicker
            value={occurredAt}
            mode={pickerMode}
            maximumDate={new Date()}
            onChange={chooseTime}
          />
        ) : null}
      </Surface>

      <Surface>
        <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Meal name · optional</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          <ActionButton label="None" tone={currentTitle ? 'secondary' : 'primary'} disabled={busyAction !== null} onPress={() => { if (actionGate.isActive) return; setCustomMealName(false); setTitleText(''); updateContext({ title: null }); }} />
          {presetMealNames.map((name) => (
            <ActionButton key={name} label={name} tone={currentTitle === name ? 'primary' : 'secondary'} disabled={busyAction !== null} onPress={() => { if (actionGate.isActive) return; setCustomMealName(false); setTitleText(name); updateContext({ title: name }); }} />
          ))}
          <ActionButton label="Custom" tone={customMealName ? 'primary' : 'secondary'} disabled={busyAction !== null} onPress={() => { if (!actionGate.isActive) setCustomMealName(true); }} />
        </View>
        {customMealName ? (
          <TextInput
            accessibilityLabel="Custom meal name"
            placeholder="Meal name"
            placeholderTextColor={colors.textSecondary}
            value={currentTitle}
            maxLength={80}
            onChangeText={setTitleText}
            onBlur={() => updateContext({ title: titleText || null })}
            style={inputStyle}
          />
        ) : null}
      </Surface>

      <Surface>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showContext }}
          onPress={() => { if (!actionGate.isActive) setShowContext((visible) => !visible); }}
          style={{ minHeight: minimumTouchTarget, justifyContent: 'center' }}
        >
          <Text allowFontScaling style={[typography.title3, { color: colors.brand }]}>
            {showContext ? 'Hide context' : 'Add context'}
          </Text>
        </Pressable>
        {showContext ? (
          <View style={{ gap: spacing.sm }}>
            <TextInput
              accessibilityLabel="Meal location"
              accessibilityHint="Optional manual label. MEAT does not request your device location."
              placeholder="Location (optional)"
              placeholderTextColor={colors.textSecondary}
              value={locationText}
              maxLength={120}
              onChangeText={setLocationText}
              onBlur={() => updateContext({ location: locationText ? { label: locationText } : null })}
              style={inputStyle}
            />
            <TextInput
              accessibilityLabel="Meal notes"
              placeholder="Notes (optional)"
              placeholderTextColor={colors.textSecondary}
              value={captionText}
              maxLength={500}
              multiline
              onChangeText={setCaptionText}
              onBlur={() => updateContext({ caption: captionText || null })}
              style={[inputStyle, { minHeight: 96, textAlignVertical: 'top' }]}
            />
            <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Photos · {totalPhotos}/5</Text>
            <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>Photos stay private on this device. MEAT re-encodes them without EXIF metadata.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {[...session.existingMedia, ...session.stagedPhotos].map((photo) => (
                <View key={photo.id} style={{ width: 112, gap: spacing.xs }}>
                  <Image
                    source={{ uri: photo.uri }}
                    accessibilityLabel="Meal photo"
                    style={{ width: 112, height: 84, borderRadius: radii.sm }}
                    contentFit="cover"
                  />
                  <ActionButton label="Remove photo" tone="secondary" disabled={busyAction !== null} onPress={() => removePhoto(photo.id)} />
                </View>
              ))}
            </View>
            <ActionButton label="Take photo" tone="secondary" disabled={busyAction !== null || totalPhotos >= 5} onPress={() => void addFromCamera()} />
            <ActionButton label="Choose from library" tone="secondary" disabled={busyAction !== null || totalPhotos >= 5} onPress={() => void addFromLibrary()} />
          </View>
        ) : null}
      </Surface>

      {message ? (
        <Text accessibilityLiveRegion="polite" selectable style={[typography.body, { color: message.includes('added') ? colors.positive : colors.destructive }]}>
          {message}
        </Text>
      ) : null}

      <ActionButton
        label={busyAction === 'confirm' ? 'Saving event…' : initialParams.mealId ? 'Save changes' : 'Save meal event'}
        disabled={busyAction !== null || session.draft.items.length === 0}
        onPress={() => void confirm()}
      />
      <ActionButton label="Cancel" tone="secondary" disabled={busyAction !== null} onPress={() => void cancel()} />
    </ScrollView>
  );
}
