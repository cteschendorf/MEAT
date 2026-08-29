import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';

import {
  FoodSourcePreferenceStore,
  foodSourceMetadata,
  type FoodSourceId,
  type FoodSourcePreference,
} from '@/data';
import { openAppServices } from '@/services/app-services';
import { Surface, spacing, typography, useThemeColors } from '@/ui';

export default function DataSourcesScreen() {
  const colors = useThemeColors();
  const [store, setStore] = useState<FoodSourcePreferenceStore | null>(null);
  const [preferences, setPreferences] = useState<readonly FoodSourcePreference[]>([]);
  const [updatingSource, setUpdatingSource] = useState<FoodSourceId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(preferences.map((preference) => [preference.sourceId, preference])),
    [preferences],
  );

  useEffect(() => {
    let active = true;
    void openAppServices()
      .then(async (services) => {
        if (!active) return;
        const preferenceStore = services.preferences;
        const next = await preferenceStore.list();
        if (active) {
          setPreferences(next);
          setStore(preferenceStore);
        }
      })
      .catch((error: unknown) =>
        active && setMessage(error instanceof Error ? error.message : 'Unable to load food sources.'),
      );
    return () => {
      active = false;
    };
  }, []);

  async function setEnabled(sourceId: FoodSourceId, enabled: boolean) {
    if (!store) return;
    setMessage(null);
    setUpdatingSource(sourceId);
    try {
      await store.setEnabled(sourceId, enabled);
      setPreferences(await store.list());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update this source.');
    } finally {
      setUpdatingSource(null);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}
    >
      <Text accessibilityRole="header" allowFontScaling selectable style={[typography.title1, { color: colors.textPrimary }]}>Food data sources</Text>
      <Text allowFontScaling selectable style={[typography.body, { color: colors.textSecondary }]}>Each source remains independent. MEAT does not silently merge records from different databases. Disable any source you do not want used for search or barcode resolution.</Text>

      {foodSourceMetadata.map((source) => {
        const preference = byId.get(source.id);
        return (
          <Surface key={source.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text allowFontScaling selectable style={[typography.bodyStrong, { color: colors.textPrimary }]}>{source.name}</Text>
                <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>{source.detail}</Text>
              </View>
              <Switch
                accessibilityLabel={`Use ${source.name}`}
                accessibilityState={{
                  busy: updatingSource === source.id,
                  checked: preference?.enabled ?? true,
                  disabled: !store || updatingSource !== null,
                }}
                value={preference?.enabled ?? true}
                onValueChange={(enabled) => void setEnabled(source.id, enabled)}
                disabled={!store || updatingSource !== null}
              />
            </View>
          </Surface>
        );
      })}

      <Text allowFontScaling selectable style={[typography.caption, { color: colors.textSecondary }]}>Open Food Facts records and cache entries remain provider-scoped and are not copied into the USDA-derived on-device corpus.</Text>
      {message ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" selectable style={[typography.body, { color: colors.destructive }]}>{message}</Text> : null}
    </ScrollView>
  );
}
