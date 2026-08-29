import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { migrateDatabase } from '@/data/sqlite/migrations';
import { retryableSingleFlight } from '@/data/sqlite/single-flight';

export const DATABASE_NAME = 'meat.db';

const openSharedDatabase = retryableSingleFlight(async (): Promise<SQLiteDatabase> => {
  const db = await openDatabaseAsync(DATABASE_NAME);
  await migrateDatabase(db);
  return db;
});

export function openMeatDatabase(): Promise<SQLiteDatabase> {
  return openSharedDatabase();
}

export async function withAtomicWrite<T>(
  db: SQLiteDatabase,
  operation: () => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  await db.withTransactionAsync(async () => {
    result = await operation();
  });

  if (result === undefined) {
    throw new Error('Atomic write completed without a result.');
  }

  return result;
}
