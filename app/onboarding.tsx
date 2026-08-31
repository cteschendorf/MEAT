import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { CoreNutrientCode, GoalMode, ISODateTime, UserPreferences } from '@/domain';
import { openMeatDatabase, SqliteGoalRepository, SqliteUserPreferencesRepository } from '@/data';
import {
  defaultUserPreferences,
  goalSetupDefinitions,
  OnboardingSetupService,
  type GoalSetupInput,
} from '@/services/onboarding/setup';
import { ExclusiveActionGate } from '@/services/actions/exclusive-action';
import { ActionButton, ScreenState, Surface, spacing, typography, useThemeColors } from '@/ui';

interface GoalDraft {
  nutrientCode: CoreNutrientCode;
  mode: GoalMode;
  minimum: string;
  maximum: string;
}

const goalModes: readonly GoalMode[] = ['none', 'minimum', 'maximum', 'range'];
const modeLabel: Record<GoalMode, string> = {
  none: 'Off',
  minimum: 'Minimum',
  maximum: 'Maximum',
  range: 'Range',
};

function draftsFromInputs(inputs: readonly GoalSetupInput[]): readonly GoalDraft[] {
  return goalSetupDefinitions.map(({ nutrientCode }) => {
    const input = inputs.find((value) => value.nutrientCode === nutrientCode);
    return {
      nutrientCode,
      mode: input?.mode ?? 'none',
      minimum: input?.minimum === undefined ? '' : String(input.minimum),
      maximum: input?.maximum === undefined ? '' : String(input.maximum),
    };
  });
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const [service, setService] = useState<OnboardingSetupService | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(defaultUserPreferences);
  const [drafts, setDrafts] = useState<readonly GoalDraft[]>(draftsFromInputs([]));
  const [editingExisting, setEditingExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const saveGate = useRef(new ExclusiveActionGate()).current;

  useEffect(() => {
    let active = true;
    void openMeatDatabase()
      .then(async (db) => {
        const setupService = new OnboardingSetupService(
          new SqliteUserPreferencesRepository(db),
          new SqliteGoalRepository(db),
        );
        const now = new Date().toISOString() as ISODateTime;
        const loaded = await setupService.load(now);
        if (!active) return;
        setService(setupService);
        // Batch 3 accepts food quantities in grams throughout. Normalize any
        // earlier local draft preference so setup cannot promise an ounce UI
        // that the logging screens do not yet provide.
        setPreferences({ ...loaded.preferences, massUnit: 'g' });
        setDrafts(draftsFromInputs(loaded.goals));
        setEditingExisting(loaded.onboardingComplete);
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to load setup.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  const activeGoalCount = useMemo(() => drafts.filter((draft) => draft.mode !== 'none').length, [drafts]);

  function updateDraft(nutrientCode: CoreNutrientCode, patch: Partial<GoalDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.nutrientCode === nutrientCode ? { ...draft, ...patch } : draft)),
    );
  }

  function cycleMode(draft: GoalDraft) {
    const index = goalModes.indexOf(draft.mode);
    updateDraft(draft.nutrientCode, { mode: goalModes[(index + 1) % goalModes.length] ?? 'none' });
  }

  function retryInitialization() {
    setMessage(null);
    setLoading(true);
    setLoadAttempt((current) => current + 1);
  }

  async function save() {
    if (!service) return;
    await saveGate.run(async () => {
      setMessage(null);
      setSaving(true);
      try {
        const goals: GoalSetupInput[] = drafts.map((draft) => {
          const minimum = numberOrUndefined(draft.minimum);
          const maximum = numberOrUndefined(draft.maximum);
          if (Number.isNaN(minimum) || Number.isNaN(maximum)) throw new Error('Goal values must be numbers.');
          return {
            nutrientCode: draft.nutrientCode,
            mode: draft.mode,
            ...(minimum !== undefined ? { minimum } : {}),
            ...(maximum !== undefined ? { maximum } : {}),
          };
        });
        await service.save({ preferences, goals }, new Date().toISOString() as ISODateTime);
        router.replace('/');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to save setup.');
      } finally {
        setSaving(false);
      }
    });
  }

  async function skip() {
    if (!service) return;
    await saveGate.run(async () => {
      setMessage(null);
      setSaving(true);
      try {
        await service.save(
          {
            preferences,
            goals: goalSetupDefinitions.map(({ nutrientCode }) => ({ nutrientCode, mode: 'none' })),
          },
          new Date().toISOString() as ISODateTime,
        );
        router.replace('/');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to finish setup.');
      } finally {
        setSaving(false);
      }
    });
  }

  if (loading) return <ScreenState title="Loading setup" message="Preparing your local nutrition settings." />;

  if (!service) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.md, backgroundColor: colors.background }}
        style={{ backgroundColor: colors.background }}
      >
        <Surface>
          <ScreenState
            title="Setup unavailable"
            message={message ?? 'MEAT could not open your local nutrition settings.'}
            role="alert"
          />
          <ActionButton label="Try again" onPress={retryInitialization} />
        </Surface>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>
          {editingExisting ? 'Goals & units' : 'Set up MEAT'}
        </Text>
        <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>
          MEAT keeps ordinary food tracking local. Goals are optional, and you can add or change them at any time.
        </Text>
      </View>

      <Surface>
        <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Logging units</Text>
        <Text allowFontScaling style={[typography.body, { color: colors.textSecondary }]}>This candidate enters food quantities in grams. Ounce entry is not enabled yet.</Text>
      </Surface>

      <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Daily goals (optional)</Text>
        <Text allowFontScaling style={[typography.body, { color: colors.textSecondary }]}>
          {activeGoalCount === 0 ? 'No goals selected. You can start tracking now.' : `${activeGoalCount} active goal${activeGoalCount === 1 ? '' : 's'}.`}
        </Text>
        {goalSetupDefinitions.map((definition) => {
          const draft = drafts.find((value) => value.nutrientCode === definition.nutrientCode);
          if (!draft) return null;
          return (
            <Surface key={definition.nutrientCode}>
              <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>{definition.label}</Text>
              <ActionButton label={`Goal: ${modeLabel[draft.mode]}`} tone="secondary" onPress={() => cycleMode(draft)} />
              {draft.mode === 'minimum' || draft.mode === 'range' ? (
                <TextInput
                  accessibilityLabel={`${definition.label} minimum in ${definition.unit}`}
                  keyboardType="decimal-pad"
                  placeholder={`Minimum ${definition.unit}`}
                  placeholderTextColor={colors.textSecondary}
                  value={draft.minimum}
                  onChangeText={(minimum) => updateDraft(definition.nutrientCode, { minimum })}
                  style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]}
                />
              ) : null}
              {draft.mode === 'maximum' || draft.mode === 'range' ? (
                <TextInput
                  accessibilityLabel={`${definition.label} maximum in ${definition.unit}`}
                  keyboardType="decimal-pad"
                  placeholder={`Maximum ${definition.unit}`}
                  placeholderTextColor={colors.textSecondary}
                  value={draft.maximum}
                  onChangeText={(maximum) => updateDraft(definition.nutrientCode, { maximum })}
                  style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]}
                />
              ) : null}
            </Surface>
          );
        })}
      </View>

      <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>
        Camera and other permissions are requested only when you use features that need them. Advanced micronutrients stay out of initial setup.
      </Text>
      {message ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" allowFontScaling selectable style={[typography.body, { color: colors.destructive }]}>{message}</Text>
      ) : null}
      <ActionButton label={saving ? 'Saving…' : editingExisting ? 'Save changes' : 'Start tracking'} onPress={() => void save()} disabled={!service || saving} />
      {!editingExisting ? <ActionButton label="Start without goals" tone="secondary" onPress={() => void skip()} disabled={!service || saving} /> : null}
    </ScrollView>
  );
}
