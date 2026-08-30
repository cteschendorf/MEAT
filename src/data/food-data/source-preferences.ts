import type { SQLiteDatabase } from 'expo-sqlite';
import type { FoodSourceId } from '@/domain/food/source';

export type { FoodSourceId } from '@/domain/food/source';

export interface FoodSourcePreference {
  sourceId: FoodSourceId;
  enabled: boolean;
  priority: number;
}

export const foodSourceMetadata: readonly {
  id: FoodSourceId;
  name: string;
  detail: string;
}[] = [
  { id: 'personal', name: 'My foods', detail: 'Foods you create and foods learned from your own history.' },
  { id: 'usda-core', name: 'USDA — on device', detail: 'Offline Foundation, FNDDS, and SR Legacy foods from FoodData Central.' },
  { id: 'usda-fdc', name: 'USDA — online', detail: 'Free FoodData Central network results for long-tail foods.' },
  { id: 'open-food-facts', name: 'Open Food Facts', detail: 'Independent packaged-food/barcode source kept separate for ODbL compliance.' },
];

export class FoodSourcePreferenceStore {
  constructor(private readonly db: SQLiteDatabase) {}

  async list(): Promise<readonly FoodSourcePreference[]> {
    const rows = await this.db.getAllAsync<{ source_id: FoodSourceId; enabled: number; priority: number }>(
      'SELECT source_id, enabled, priority FROM food_source_preferences ORDER BY priority ASC',
    );
    return rows.map((row) => ({
      sourceId: row.source_id,
      enabled: row.enabled === 1,
      priority: row.priority,
    }));
  }

  async isEnabled(sourceId: FoodSourceId): Promise<boolean> {
    const row = await this.db.getFirstAsync<{ enabled: number }>(
      'SELECT enabled FROM food_source_preferences WHERE source_id = ?',
      sourceId,
    );
    return row?.enabled !== 0;
  }

  async setEnabled(sourceId: FoodSourceId, enabled: boolean): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO food_source_preferences (source_id, enabled, priority)
       VALUES (?, ?, 100)
       ON CONFLICT(source_id) DO UPDATE SET enabled = excluded.enabled`,
      sourceId,
      enabled ? 1 : 0,
    );
  }

  async setPriority(sourceId: FoodSourceId, priority: number): Promise<void> {
    await this.db.runAsync(
      'UPDATE food_source_preferences SET priority = ? WHERE source_id = ?',
      priority,
      sourceId,
    );
  }
}
