import type { ISODateTime, MediaId } from '@/domain/shared/ids';
import { assertPrivacySafeJpeg } from '@/services/media/jpeg-privacy';

export const MEAL_PHOTO_MAX_LONG_EDGE = 2048;
export const MEAL_PHOTO_JPEG_QUALITY = 0.85;

export interface PickedMealPhoto {
  uri: string;
  width: number;
  height: number;
}

export interface LocalMealPhoto {
  id: MediaId;
  uri: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  byteSize: number;
  createdAt: ISODateTime;
}

export type MealPhotoResizeAction = {
  readonly resize: { readonly width?: number; readonly height?: number };
};

export interface MealPhotoProcessedImage {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface MealPhotoProcessor {
  reencode(
    uri: string,
    actions: readonly MealPhotoResizeAction[],
    options: { readonly compress: number; readonly format: 'jpeg' },
  ): Promise<MealPhotoProcessedImage>;
}

export interface MealPhotoFile {
  readonly uri: string;
  readonly exists: boolean;
  readonly size: number;
  readonly lastModified: number | null;
  bytes(): Promise<Uint8Array>;
  move(destination: MealPhotoFile): Promise<void> | void;
  delete(): void;
}

export interface MealPhotoDirectory {
  readonly uri: string;
  create(options: { readonly intermediates: true; readonly idempotent: true }): void;
  listFiles(): readonly MealPhotoFile[];
}

export interface MealPhotoStorageAdapter {
  readonly drafts: MealPhotoDirectory;
  readonly durable: MealPhotoDirectory;
  file(uri: string): MealPhotoFile;
  fileIn(directory: MealPhotoDirectory, name: string): MealPhotoFile;
}

export function mealPhotoFileName(id: MediaId): string {
  return `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
}

export function mealPhotoResizeActions(photo: PickedMealPhoto): readonly MealPhotoResizeAction[] {
  const longEdge = Math.max(photo.width, photo.height);
  if (longEdge <= MEAL_PHOTO_MAX_LONG_EDGE) return [];
  return photo.width >= photo.height
    ? [{ resize: { width: MEAL_PHOTO_MAX_LONG_EDGE } }]
    : [{ resize: { height: MEAL_PHOTO_MAX_LONG_EDGE } }];
}

function deleteIfPresent(file: MealPhotoFile): void {
  if (file.exists) file.delete();
}

/**
 * Expo-independent implementation of MEAT's private photo file lifecycle.
 * The production adapter uses Expo FileSystem and ImageManipulator; tests use
 * an in-memory adapter so destructive and rollback paths are deterministic.
 */
export class LocalMealPhotoStoreCore {
  constructor(
    private readonly storage: MealPhotoStorageAdapter,
    private readonly processor: MealPhotoProcessor,
  ) {}

  private ensureDirectories(): void {
    this.storage.drafts.create({ intermediates: true, idempotent: true });
    this.storage.durable.create({ intermediates: true, idempotent: true });
  }

  async stage(photo: PickedMealPhoto, id: MediaId, createdAt: ISODateTime): Promise<LocalMealPhoto> {
    if (!(photo.width > 0) || !(photo.height > 0)) {
      throw new Error('The selected photo has invalid dimensions.');
    }
    this.ensureDirectories();

    const processed = await this.processor.reencode(photo.uri, mealPhotoResizeActions(photo), {
      compress: MEAL_PHOTO_JPEG_QUALITY,
      format: 'jpeg',
    });
    const processedFile = this.storage.file(processed.uri);
    try {
      assertPrivacySafeJpeg(await processedFile.bytes());
      const stagedFile = this.storage.fileIn(this.storage.drafts, mealPhotoFileName(id));
      deleteIfPresent(stagedFile);
      await processedFile.move(stagedFile);
      return {
        id,
        uri: stagedFile.uri,
        mimeType: 'image/jpeg',
        width: processed.width,
        height: processed.height,
        byteSize: stagedFile.size,
        createdAt,
      };
    } catch (error) {
      deleteIfPresent(processedFile);
      throw error;
    }
  }

  async promote(photo: LocalMealPhoto): Promise<LocalMealPhoto> {
    this.ensureDirectories();
    const source = this.storage.file(photo.uri);
    if (!source.exists) throw new Error('A staged meal photo is no longer available.');
    const destination = this.storage.fileIn(this.storage.durable, mealPhotoFileName(photo.id));
    deleteIfPresent(destination);
    await source.move(destination);
    return { ...photo, uri: destination.uri, byteSize: destination.size };
  }

  async restoreToDraft(photo: LocalMealPhoto): Promise<LocalMealPhoto> {
    this.ensureDirectories();
    const source = this.storage.file(photo.uri);
    if (!source.exists) throw new Error('A promoted meal photo is no longer available.');
    const destination = this.storage.fileIn(this.storage.drafts, mealPhotoFileName(photo.id));
    deleteIfPresent(destination);
    await source.move(destination);
    return { ...photo, uri: destination.uri, byteSize: destination.size };
  }

  discard(photo: Pick<LocalMealPhoto, 'uri'>): void {
    deleteIfPresent(this.storage.file(photo.uri));
  }

  delete(uri: string): void {
    deleteIfPresent(this.storage.file(uri));
  }

  /** Remove every confirmed, orphaned, and still-staged local meal photo. */
  deleteAll(): void {
    this.ensureDirectories();
    for (const entry of this.storage.drafts.listFiles()) deleteIfPresent(entry);
    for (const entry of this.storage.durable.listFiles()) deleteIfPresent(entry);
  }

  cleanup(options: {
    attachedUris: ReadonlySet<string>;
    now?: number;
    draftMaxAgeMs?: number;
    orphanGraceMs?: number;
  }): void {
    this.ensureDirectories();
    const now = options.now ?? Date.now();
    const draftCutoff = now - (options.draftMaxAgeMs ?? 24 * 60 * 60 * 1000);
    const orphanCutoff = now - (options.orphanGraceMs ?? 24 * 60 * 60 * 1000);

    for (const entry of this.storage.drafts.listFiles()) {
      if ((entry.lastModified ?? 0) < draftCutoff) deleteIfPresent(entry);
    }
    for (const entry of this.storage.durable.listFiles()) {
      if (!options.attachedUris.has(entry.uri) && (entry.lastModified ?? 0) < orphanCutoff) {
        deleteIfPresent(entry);
      }
    }
  }
}
