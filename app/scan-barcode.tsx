import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { FoodCandidate, FoodSourceId } from '@/domain/food/source';
import type { ISODateTime } from '@/domain/shared/ids';
import { openAppServices, type AppServices } from '@/services/app-services';
import { ExclusiveActionGate } from '@/services/actions/exclusive-action';
import {
  BarcodeScanDeduplicator,
  cameraPermissionPlan,
  interpretScannedBarcode,
  SourceAwareBarcodeService,
  supportedScannerBarcodeFormats,
  type BarcodeSourceOutcome,
  type ScannerBarcodeFormat,
  type SourceAwareBarcodeResolution,
} from '@/services/logging/source-aware-barcode';
import { ActionButton, Surface, spacing, typography, useThemeColors } from '@/ui';
import { addCandidateToComposer } from '@/ui/meal-composer-entry';
import { useMutationRouteGuard } from '@/ui/navigation/use-mutation-route-guard';

const sourceNames: Readonly<Record<FoodSourceId, string>> = {
  personal: 'My foods',
  'usda-core': 'USDA — on device',
  'usda-fdc': 'USDA — online',
  'open-food-facts': 'Open Food Facts',
};

/** Roughly a second of unusable frames before offering the keyboard instead. */
const UNREADABLE_FRAME_HINT = 15;

/** EAN-8 or UPC-E, UPC-A, EAN-13. */
const retailBarcodeLengths: readonly number[] = [8, 12, 13];

function candidateKey(candidate: FoodCandidate): string {
  return `${candidate.ref.sourceId}:${candidate.ref.recordId}`;
}

function initialPortion(candidate: FoodCandidate): number {
  return (
    candidate.portions.find((portion) => portion.isDefault && portion.gramWeight)?.gramWeight ??
    candidate.portions.find((portion) => portion.gramWeight)?.gramWeight ??
    100
  );
}

function freshnessText(outcome: Extract<BarcodeSourceOutcome, { state: 'found' }>): string {
  if (outcome.freshness === 'stale-cache') return 'Saved result · may be out of date';
  if (outcome.freshness === 'fresh-cache') return 'Saved result';
  return 'Live result';
}

export default function ScanBarcodeScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ draftId?: string }>();
  const draftId = typeof params.draftId === 'string' ? params.draftId : undefined;
  const [permission, requestPermission] = useCameraPermissions();
  const [services, setServices] = useState<AppServices | null>(null);
  const [service, setService] = useState<SourceAwareBarcodeService | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [resolution, setResolution] = useState<SourceAwareBarcodeResolution | null>(null);
  const [selected, setSelected] = useState<FoodCandidate | null>(null);
  const [grams, setGrams] = useState('100');
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Frames the camera saw but could not use. Not an error — just the cue for
  // offering the keyboard once it is clear the label is not going to read.
  const [unreadableFrames, setUnreadableFrames] = useState(0);
  const inFlight = useRef(false);
  const abortController = useRef<AbortController | null>(null);
  const deduplicator = useRef(new BarcodeScanDeduplicator());
  const logGate = useRef(new ExclusiveActionGate()).current;
  const queueRouteExit = useMutationRouteGuard(
    resolving || adding,
    resolving
      ? 'Please wait while the barcode sources finish checking.'
      : 'Please wait while this food is added.',
  );

  useEffect(() => {
    let active = true;
    void openAppServices()
      .then((services) => {
        if (active) {
          setServices(services);
          setService(new SourceAwareBarcodeService(services.discovery, services.logging));
        }
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to open food data sources.');
      });
    return () => {
      active = false;
      abortController.current?.abort();
    };
  }, []);

  function chooseCandidate(candidate: FoodCandidate) {
    setSelected(candidate);
    setGrams(String(initialPortion(candidate)));
  }

  async function startCamera() {
    setMessage(null);
    const plan = cameraPermissionPlan(permission);
    if (plan === 'ready') {
      deduplicator.current.reset();
      setUnreadableFrames(0);
      setResolution(null);
      setSelected(null);
      setCameraActive(true);
      return;
    }
    if (plan === 'checking') {
      setMessage('Camera access is still being checked. You can enter the barcode below.');
      return;
    }
    if (plan === 'blocked') {
      setMessage('Camera access is disabled in Settings. You can still enter the barcode below.');
      return;
    }
    // The operating-system permission prompt is reached only from this user action.
    const next = await requestPermission();
    if (next.granted) {
      deduplicator.current.reset();
      setUnreadableFrames(0);
      setCameraActive(true);
    } else {
      setMessage('Camera access was not granted. You can still enter the barcode below.');
    }
  }

  async function resolveBarcode(value: string, format?: ScannerBarcodeFormat) {
    if (!service || inFlight.current) return;
    inFlight.current = true;
    setResolving(true);
    setMessage(null);
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    try {
      const result = await service.lookup(value, {
        ...(format ? { format } : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setManualBarcode(result.barcode);
      setCameraActive(false);
      if (result.status === 'not-found') {
        queueRouteExit(() => router.dismissTo({
          pathname: '/manual-food',
          params: { barcode: result.barcode, ...(draftId ? { draftId } : {}) },
        }));
        return;
      }
      setResolution(result);
      const first = result.sources.find(
        (outcome): outcome is Extract<BarcodeSourceOutcome, { state: 'found' }> =>
          outcome.state === 'found',
      );
      if (first) chooseCandidate(first.candidate);
      else setSelected(null);
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(error instanceof Error ? error.message : 'Unable to read that barcode.');
      }
    } finally {
      if (abortController.current === controller) abortController.current = null;
      inFlight.current = false;
      setResolving(false);
    }
  }

  function handleCameraBarcode(data: string, rawType: string) {
    const scan = interpretScannedBarcode(data, rawType);
    if (!scan.ok) {
      // A frame that does not resolve is normal while aiming, so it never
      // becomes a message. Only a run of them earns the fallback hint, and a
      // symbology we never asked for is not evidence of a struggling scan.
      if (scan.reason !== 'unsupported-symbology') {
        setUnreadableFrames((count) => count + 1);
      }
      return;
    }
    if (!deduplicator.current.accept(scan.digits, scan.format)) return;
    setUnreadableFrames(0);
    void resolveBarcode(scan.digits, scan.format);
  }

  async function addToEvent() {
    if (!services || !selected) return;
    const amount = Number(grams);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a portion greater than zero grams.');
      return;
    }
    await logGate.run(async () => {
      setAdding(true);
      setMessage(null);
      try {
        const result = await addCandidateToComposer(
          services,
          draftId,
          selected,
          amount,
          new Date().toISOString() as ISODateTime,
        );
        queueRouteExit(() => router.dismissTo({
          pathname: '/log-food',
          params: { draftId: result.session.draft.id },
        }));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to retain and add this food.');
      } finally {
        setAdding(false);
      }
    });
  }

  function scanAnother() {
    deduplicator.current.reset();
    setUnreadableFrames(0);
    setResolution(null);
    setSelected(null);
    setMessage(null);
    setCameraActive(permission?.granted ?? false);
  }

  const manualBarcodeReady = retailBarcodeLengths.includes(manualBarcode.length);
  const permissionPlan = cameraPermissionPlan(permission);
  const cameraButtonLabel = permissionPlan === 'ready'
    ? 'Scan barcode'
    : permissionPlan === 'checking'
      ? 'Checking camera access…'
      : permissionPlan === 'request'
        ? 'Scan and allow camera'
        : 'Camera access unavailable';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>Scan barcode</Text>
        <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Each enabled source is checked independently. MEAT keeps provider records separate and can use a marked saved result when the network is offline.</Text>
      </View>

      {cameraActive && permission?.granted ? (
        <Surface>
          <View accessible={false} style={{ borderRadius: 16, overflow: 'hidden', minHeight: 320 }}>
            <CameraView
              style={{ flex: 1, minHeight: 320 }}
              facing="back"
              active={!resolving && !resolution}
              barcodeScannerSettings={{ barcodeTypes: [...supportedScannerBarcodeFormats] }}
              onBarcodeScanned={
                resolving || resolution
                  ? undefined
                  : ({ data, type }) => handleCameraBarcode(data, type)
              }
            />
          </View>
          <Text
            accessibilityLiveRegion="polite"
            allowFontScaling
            style={[typography.caption, { color: colors.textSecondary }]}
          >
            {unreadableFrames >= UNREADABLE_FRAME_HINT
              ? 'Still not reading that label. Try more light or a flatter angle, or type the number below.'
              : 'Hold the barcode inside the frame.'}
          </Text>
          <ActionButton label="Stop camera" tone="secondary" onPress={() => setCameraActive(false)} />
        </Surface>
      ) : (
        <Surface>
          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Use the camera</Text>
          <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Camera permission is requested only after you choose to scan. The camera is active only on this screen.</Text>
          <ActionButton
            label={cameraButtonLabel}
            onPress={() => void startCamera()}
            disabled={!service || permissionPlan === 'checking' || permissionPlan === 'blocked'}
          />
        </Surface>
      )}

      <Surface>
        <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Enter a barcode instead</Text>
        <TextInput
          accessibilityLabel="Barcode number"
          keyboardType="number-pad"
          placeholder="EAN or UPC"
          placeholderTextColor={colors.textSecondary}
          value={manualBarcode}
          // Separators are printed on packages but never part of the number, so
          // they are dropped as they are typed rather than rejected afterwards.
          onChangeText={(text) => setManualBarcode(text.replace(/\D/g, ''))}
          onSubmitEditing={() => { if (manualBarcodeReady) void resolveBarcode(manualBarcode); }}
          maxLength={13}
          style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]}
        />
        {manualBarcode.length > 0 && !manualBarcodeReady ? (
          <Text accessibilityLiveRegion="polite" allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
            {manualBarcode.length} of 8, 12, or 13 digits.
          </Text>
        ) : null}
        <ActionButton
          label={resolving ? 'Checking sources…' : 'Look up barcode'}
          onPress={() => void resolveBarcode(manualBarcode)}
          disabled={!service || resolving || !manualBarcodeReady}
        />
      </Surface>

      {resolving ? (
        <Surface tone="muted">
          <Text accessibilityLiveRegion="polite" allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Checking each enabled source…</Text>
        </Surface>
      ) : null}

      {resolution ? (
        <View style={{ gap: spacing.sm }}>
          <Text allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>Source results</Text>
          {resolution.sources.length === 0 ? (
            <Surface>
              <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>No enabled source currently supports barcode lookup.</Text>
            </Surface>
          ) : null}
          {resolution.sources.map((outcome) => (
            <Surface key={outcome.sourceId} tone={outcome.state === 'found' ? 'muted' : 'default'}>
              <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>{sourceNames[outcome.sourceId]}</Text>
              {outcome.state === 'found' ? (
                <>
                  <Text allowFontScaling selectable style={[typography.title3, { color: colors.textPrimary }]}>{outcome.candidate.food.name}</Text>
                  {outcome.candidate.food.brand ? <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>{outcome.candidate.food.brand}</Text> : null}
                  <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>{freshnessText(outcome)}</Text>
                  {outcome.issue ? <Text accessibilityLiveRegion="polite" allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>{outcome.issue.message}</Text> : null}
                  <ActionButton
                    label={selected && candidateKey(selected) === candidateKey(outcome.candidate) ? 'Selected' : 'Use this result'}
                    tone="secondary"
                    onPress={() => chooseCandidate(outcome.candidate)}
                  />
                </>
              ) : outcome.state === 'empty' ? (
                <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>No matching product in this source.</Text>
              ) : (
                <Text accessibilityLiveRegion="polite" allowFontScaling selectable style={[typography.caption, { color: colors.destructive }]}>{outcome.issue.message}</Text>
              )}
            </Surface>
          ))}
        </View>
      ) : null}

      {selected ? (
        <Surface>
          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Portion for {selected.food.name}</Text>
          {selected.portions.filter((portion) => portion.gramWeight !== undefined).map((portion) => (
            <ActionButton
              key={portion.id}
              label={`${portion.label} · ${Math.round(portion.gramWeight ?? 0)} g`}
              tone="secondary"
              onPress={() => setGrams(String(portion.gramWeight))}
            />
          ))}
          <ActionButton label="100 g" tone="secondary" onPress={() => setGrams('100')} />
          <TextInput
            accessibilityLabel="Portion in grams"
            keyboardType="decimal-pad"
            value={grams}
            onChangeText={setGrams}
            style={[typography.body, { color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }]}
          />
          <ActionButton
            label={adding ? 'Saving and adding…' : 'Add to event'}
            onPress={() => void addToEvent()}
            disabled={adding}
          />
        </Surface>
      ) : null}

      {resolution?.status === 'unavailable' ? (
        <Surface>
          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>Some sources could not be checked</Text>
          <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>A source outage is not treated as a confirmed unknown product. Retry when convenient or create the food manually with this barcode attached.</Text>
          <ActionButton label="Retry lookup" onPress={() => void resolveBarcode(resolution.barcode)} disabled={resolving} />
          <ActionButton
            label="Create product manually"
            tone="secondary"
            onPress={() => router.push({
              pathname: '/manual-food',
              params: { barcode: resolution.barcode, ...(draftId ? { draftId } : {}) },
            })}
          />
        </Surface>
      ) : null}

      {resolution ? <ActionButton label="Scan another" tone="secondary" onPress={scanAnother} /> : null}
      {message ? <Text accessibilityLiveRegion="assertive" allowFontScaling selectable style={[typography.body, { color: colors.destructive }]}>{message}</Text> : null}
    </ScrollView>
  );
}
