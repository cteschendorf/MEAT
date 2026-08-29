import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import type { ISODateTime } from '@/domain';
import { openAppServices, type AppServices } from '@/services/app-services';
import { ExclusiveActionGate } from '@/services/actions/exclusive-action';
import { normalizeRetailBarcode } from '@/services/logging/source-aware-barcode';
import type { ManualFoodInput } from '@/services/logging/food-logging';
import { ActionButton, Surface, spacing, typography, useThemeColors } from '@/ui';

const numberOrUndefined = (value: string) => (value.trim() === '' ? undefined : Number(value));

export default function ManualFoodScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode?: string }>();
  const initialBarcode = typeof params.barcode === 'string' ? params.barcode : '';
  const [services, setServices] = useState<AppServices | null>(null);
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState(initialBarcode);
  const [serving, setServing] = useState('100');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const saveGate = useRef(new ExclusiveActionGate()).current;

  useEffect(() => {
    let active = true;
    void openAppServices()
      .then((openedServices) => {
        if (active) setServices(openedServices);
      })
      .catch((error: unknown) =>
        active && setMessage(error instanceof Error ? error.message : 'Unable to open database.'),
      );
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (!services) return;

    await saveGate.run(async () => {
      setMessage(null);
      setSaving(true);
      try {
        const servingGrams = Number(serving);
        const normalizedBarcode = barcode.trim() ? normalizeRetailBarcode(barcode) : undefined;
        const parsed = {
          calories: numberOrUndefined(calories),
          protein: numberOrUndefined(protein),
          carbohydrate: numberOrUndefined(carbs),
          fat: numberOrUndefined(fat),
          fiber: numberOrUndefined(fiber),
        };

        if (Object.values(parsed).some((value) => value !== undefined && !Number.isFinite(value))) {
          setMessage('Nutrition values must be numbers.');
          return;
        }

        const input: ManualFoodInput = {
          name,
          servingGrams,
          ...(parsed.calories === undefined ? {} : { calories: parsed.calories }),
          ...(parsed.protein === undefined ? {} : { protein: parsed.protein }),
          ...(parsed.carbohydrate === undefined ? {} : { carbohydrate: parsed.carbohydrate }),
          ...(parsed.fat === undefined ? {} : { fat: parsed.fat }),
          ...(parsed.fiber === undefined ? {} : { fiber: parsed.fiber }),
        };

        const now = new Date().toISOString() as ISODateTime;
        const created = await services.logging.createManualFood(input, now);
        const food = normalizedBarcode
          ? { ...created, barcode: normalizedBarcode, updatedAt: now }
          : created;

        // Store the barcode-bearing personal record before logging so it remains
        // available to search and future scans even if meal creation fails.
        await services.personalFoods.save(food);
        try {
          await services.logging.logFood(food, servingGrams, now);
        } catch (error) {
          setMessage(
            `Food saved for later, but it could not be logged: ${
              error instanceof Error ? error.message : 'Please try logging it again.'
            }`,
          );
          return;
        }
        router.replace('/');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to save food.');
      } finally {
        setSaving(false);
      }
    });
  }

  const field = (label: string, value: string, set: (value: string) => void, keyboardType: 'default' | 'decimal-pad' | 'number-pad' = 'decimal-pad') => (
    <TextInput
      key={label}
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={colors.textSecondary}
      keyboardType={keyboardType}
      value={value}
      onChangeText={set}
      style={[
        typography.body,
        {
          color: colors.textPrimary,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          padding: 12,
        },
      ]}
    />
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>Manual food</Text>
      <Surface>
        {field('Food name', name, setName, 'default')}
        {field('Barcode (optional)', barcode, setBarcode, 'number-pad')}
        {field('Serving grams', serving, setServing)}
        {field('Calories per serving', calories, setCalories)}
        {field('Protein grams per serving', protein, setProtein)}
        {field('Carbohydrate grams per serving', carbs, setCarbs)}
        {field('Fat grams per serving', fat, setFat)}
        {field('Fiber grams per serving', fiber, setFiber)}
        <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>Leave an unknown nutrient blank. A blank value is not stored as zero. A saved barcode stays with this local food for future scans.</Text>
        <ActionButton label={saving ? 'Saving…' : 'Save and log'} onPress={() => void save()} disabled={!services || saving || !name.trim()} />
      </Surface>
      {message ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" selectable style={[typography.body, { color: colors.destructive }]}>{message}</Text> : null}
    </ScrollView>
  );
}
