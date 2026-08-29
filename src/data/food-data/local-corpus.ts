import type { SQLiteDatabase } from 'expo-sqlite';

import type { Food } from '@/domain';

export interface LocalFoodCandidate {
  food: Food;
  popularity: number;
  dataType: string;
  sourceId: string;
}

export interface LocalFoodSearchResult {
  food: Food;
  score: number;
}

export class LocalFoodCorpus {
  constructor(private readonly db: SQLiteDatabase) {}

  async upsert(candidate: LocalFoodCandidate): Promise<void> {
    const brand = candidate.food.brand ?? null;
    const gtin = candidate.food.barcode ?? null;

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO food_corpus (id, source, source_id, data_type, name, brand, gtin, popularity, payload)
         VALUES (?, 'usda', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_id = excluded.source_id,
           data_type = excluded.data_type,
           name = excluded.name,
           brand = excluded.brand,
           gtin = excluded.gtin,
           popularity = excluded.popularity,
           payload = excluded.payload`,
        candidate.food.id,
        candidate.sourceId,
        candidate.dataType,
        candidate.food.name,
        brand,
        gtin,
        candidate.popularity,
        JSON.stringify(candidate.food),
      );
      await this.db.runAsync('DELETE FROM food_corpus_fts WHERE id = ?', candidate.food.id);
      await this.db.runAsync(
        'INSERT INTO food_corpus_fts (id, name, brand) VALUES (?, ?, ?)',
        candidate.food.id,
        candidate.food.name,
        brand ?? '',
      );
    });
  }

  async findByBarcode(gtin: string): Promise<Food | null> {
    const row = await this.db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM food_corpus WHERE gtin = ? ORDER BY popularity DESC LIMIT 1',
      gtin,
    );
    return row ? (JSON.parse(row.payload) as Food) : null;
  }

  async search(query: string, limit = 30): Promise<ReadonlyArray<LocalFoodSearchResult>> {
    const normalized = query.trim();
    if (!normalized) return [];

    const terms = normalized
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replaceAll('"', '""')}"*`)
      .join(' AND ');

    const rows = await this.db.getAllAsync<{ payload: string; rank: number; popularity: number }>(
      `SELECT c.payload, bm25(food_corpus_fts) AS rank, c.popularity
       FROM food_corpus_fts f
       JOIN food_corpus c ON c.id = f.id
       WHERE food_corpus_fts MATCH ?
       ORDER BY rank ASC, c.popularity DESC
       LIMIT ?`,
      terms,
      limit,
    );

    return rows.map((row) => ({
      food: JSON.parse(row.payload) as Food,
      score: -row.rank + Math.log1p(Math.max(0, row.popularity)),
    }));
  }
}
