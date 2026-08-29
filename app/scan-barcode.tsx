import { CameraView, useCameraPermissions } from 'expo-camera';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { Food } from '@/domain';
import type { ISODateTime } from '@/domain/shared/ids';
import {
  ExternalFoodCache,
  FoodSourcePreferenceStore,
  LocalFoodCorpus,
  OpenFoodFactsProvider,
  openMeatDatabase,
  SqliteFoodRepository,
  SqliteMealRepository,
} from '@/data';
import { BarcodeLookupService, type BarcodeResolution } from '@/services/logging/barcode';
import { FoodLoggingService, defaultLocalIdFactory } from '@/services/logging/food-logging';
import { ActionButton, ScreenState, Surface, spacing, typography, useThemeColors } from '@/ui';

const supportedBarcodeTypes = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

function initialPortion(food: Food): number {
  return food.servings.find((serving) => serving.isDefault)?.gramWeight ?? food.servings[0]?.gramWeight ?? 100;
}

export default function ScanBarcodeScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [lookup, setLookup] = useState<BarcodeLookupService | null>(null);
  const [logging, setLogging] = useState<FoodLoggingService | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [resolution, setResolution] = useState<BarcodeResolution | null>(null);
  const [grams, setGrams] = useState('100');
  const [resolving, setResolving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void openMeatDatabase()
      .then((db) => {
        if (!active) return;
        const foods = new SqliteFoodRepository(db);
        const meals = new SqliteMealRepository(db);
        const corpus = new LocalFoodCorpus(db);
        const preferences = new FoodSourcePreferenceStore(db);
        setLookup(
          new BarcodeLookupService(
            foods,
            corpus,
            [new OpenFoodFactsProvider('MEAT/0.1.0 (com.thingcorp.meat)')],
            new ExternalFoodCache(db),
            preferences,
          ),
        );
        setLogging(new FoodLoggingService(corpus, foods, meals, defaultLocalIdFactory));
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to open the food database.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function resolveBarcode(value: string) {
    if (!lookup || resolving) return;
    setMessage(null);
    setResolving(true);
    try {
      const result = await lookup.resolve(value);
      setResolution(result);
      setManualBarcode(result.barcode);
      if (result.status === 'found') setGrams(String(initialPortion(result.food)));
    } catch (error) {
      setResolution(null);
      setMessage(error instanceof Error ? error.message : 'Unable to read that barcode.');
    } finally {
      setResolving(false);
    }
  }

  async function logResolvedFood() {
    if (!logging || resolution?.status !== 'found') return;
    const amount = Number(grams);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a portion greater than zero grams.');
      return;
    }
    setMessage(null);
    try {
      await logging.logFood(resolution.food, amount, new Date().toISOString() as ISODateTime);
      router.replace('/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to log food.');
    }
  }

  if (permission === null) return <ScreenState title="Loading camera" message="Checking camera availability." />;

  const found = resolution?.status === 'found' ? resolution : null;
  const scanningEnabled = permission.granted && !resolving && !found;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>Scan barcode</Text>
        <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>MEAT checks your saved foods and the on-device index first, then uses enabled free/open sources only when needed.</Text>
      </View>

      {!permission.granted ? (
        <Surface>
          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Camera permission</Text>
          <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Camera access is used only while you are scanning a food barcode.</Text>
          <ActionButton label={permission.canAskAgain ? 'Allow camera' : 'Camera access unavailable'} onPress={() => void requestPermission()} disabled={!permission.canAskAgain} />
        </Surface>
      ) : (
        <View accessible={false} style={{ borderRadius: 16, overflow: 'hidden', minHeight: 320 }}>
          <CameraView
            style={{ flex: 1, minHeight: 320 }}
            facing="back"
            active={scanningEnabled}
            barcodeScannerSettings={{ barcodeTypes: [...supportedBarcodeTypes] }}
            onBarcodeScanned={scanningEnabled ? ({ data }) => void resolveBarcode(data) : undefined}
          />
        </View>
      )}

      <Surface>
        <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Enter a barcode instead</Text>
        <TextInput
          accessibilityLabel="Barcode number"
          keyboardType="number-pad"
          placeholder="UPC, EAN, or GTIN"
          placeholderTextColor={colors.textSecondary}
          value={manualBarcode}
          onChangeText={setManualBarcode}
          onSubmitEditing={() => void resolveBarcode(manualBarcode)}
          style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]}
        />
        <ActionButton label={resolving ? 'Looking up…' : 'Look up barcode'} onPress={() => void resolveBarcode(manualBarcode)} disabled={!lookup || resolving || !manualBarcode.trim()} />
      </Surface>

      {found ? (
        <Surface tone="muted">
          <Text allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }]}>{found.food.name}</Text>
          {found.food.brand ? <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>{found.food.brand}</Text> : null}
          <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>Source: {found.food.primarySource?.provider ?? found.sourceId}</Text>
          {found.food.servings.filter((serving) => serving.gramWeight !== undefined).map((serving) => (
            <ActionButton key={serving.id} label={`${serving.label} · ${Math.round(serving.gramWeight ?? 0)} g`} tone="secondary" onPress={() => setGrams(String(serving.gramWeight))} />
          ))}
          <ActionButton label="100 g" tone="secondary" onPress={() => setGrams('100')} />
          <TextInput
            accessibilityLabel="Portion in grams"
            keyboardType="decimal-pad"
            value={grams}
            onChangeText={setGrams}
            style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]}
          />
          <ActionButton label="Log food" onPress={() => void logResolvedFood()} disabled={!logging} />
          <ActionButton label="Scan another" tone="secondary" onPress={() => setResolution(null)} />
        </Surface>
      ) : null}

      {resolution?.status === 'not-found' ? (
        <Surface>
          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Product not found</Text>
          <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>The barcode was not found in your local data or enabled free/open sources. Keep the barcode attached while creating the product so future scans resolve locally.</Text>
          <Link href={{ pathname: '/manual-food', params: { barcode: resolution.barcode } }} asChild>
            <ActionButton label="Create product manually" />
          </Link>
          <ActionButton label="Scan nutrition label" tone="secondary" disabled onPress={() => undefined} />
          <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>On-device nutrition-label OCR plugs into this fallback in its dedicated implementation; manual creation is available now.</Text>
          <ActionButton label="Try another barcode" tone="secondary" onPress={() => setResolution(null)} />
        </Surface>
      ) : null}

      {resolution?.status === 'offline' ? (
        <Surface>
          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Network unavailable</Text>
          <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>No local match was found and the enabled external source could not be reached. You can retry or create the product manually; cached products remain available offline.</Text>
          <ActionButton label="Retry lookup" onPress={() => void resolveBarcode(resolution.barcode)} disabled={resolving} />
          <Link href={{ pathname: '/manual-food', params: { barcode: resolution.barcode } }} asChild>
            <ActionButton label="Create product manually" tone="secondary" />
          </Link>
        </Surface>
      ) : null}

      {message ? <Text accessibilityLiveRegion="assertive" allowFontScaling selectable style={[typography.body, { color: colors.destructive }]}>{message}</Text> : null}
    </ScrollView>
  );
}
