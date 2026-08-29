import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import type { ISODateTime } from '@/domain';
import { LocalFoodCorpus, openMeatDatabase, SqliteFoodRepository, SqliteMealRepository } from '@/data';
import { FoodLoggingService, defaultLocalIdFactory, type ManualFoodInput } from '@/services/logging/food-logging';
import { ActionButton, Surface, spacing, typography, useThemeColors } from '@/ui';

const numberOrUndefined = (value: string) => (value.trim() === '' ? undefined : Number(value));

export default function ManualFoodScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode?: string }>();
  const initialBarcode = typeof params.barcode === 'string' ? params.barcode : '';
  const [service, setService] = useState<FoodLoggingService | null>(null);
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState(initialBarcode);
  const [serving, setServing] = useState('100');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void openMeatDatabase()
      .then((db) =>
        setService(
          new FoodLoggingService(
            new LocalFoodCorpus(db),
            new SqliteFoodRepository(db),
            new SqliteMealRepository(db),
            defaultLocalIdFactory,
          ),
        ),
      )
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : 'Unable to open database.'),
      );
  }, []);

  async function save() {
    if (!service) return;

    try {
      const servingGrams = Number(serving);
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

      const created = await service.createManualFood(input, new Date().toISOString() as ISODateTime);
      const food = barcode.trim() ? { ...created, barcode: barcode.trim(), updatedAt: new Date().toISOString() as ISODateTime } : created;
      await service.logFood(food, servingGrams, new Date().toISOString() as ISODateTime);
      router.replace('/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save food.');
    }
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
      <Text allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>Manual food</Text>
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
        <ActionButton label="Save and log" onPress={() => void save()} disabled={!service || !name.trim()} />
      </Surface>
      {message ? <Text accessibilityLiveRegion="polite" selectable style={[typography.body, { color: colors.destructive }]}>{message}</Text> : null}
    </ScrollView>
  );
}
