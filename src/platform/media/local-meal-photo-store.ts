import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import {
  LocalMealPhotoStoreCore,
  type MealPhotoDirectory,
  type MealPhotoFile,
  type MealPhotoProcessor,
  type MealPhotoStorageAdapter,
} from '@/platform/media/local-meal-photo-store-core';

export * from '@/platform/media/local-meal-photo-store-core';

class ExpoMealPhotoFile implements MealPhotoFile {
  constructor(readonly native: File) {}

  get uri(): string { return this.native.uri; }
  get exists(): boolean { return this.native.exists; }
  get size(): number { return this.native.size; }
  get lastModified(): number | null { return this.native.lastModified; }
  bytes(): Promise<Uint8Array> { return this.native.bytes(); }
  delete(): void { this.native.delete(); }

  async move(destination: MealPhotoFile): Promise<void> {
    if (!(destination instanceof ExpoMealPhotoFile)) {
      throw new Error('Expo meal photos can only move to Expo file destinations.');
    }
    await this.native.move(destination.native);
  }
}

class ExpoMealPhotoDirectory implements MealPhotoDirectory {
  constructor(readonly native: Directory) {}

  get uri(): string { return this.native.uri; }

  create(options: { readonly intermediates: true; readonly idempotent: true }): void {
    this.native.create(options);
  }

  listFiles(): readonly MealPhotoFile[] {
    return this.native.list()
      .filter((entry): entry is File => entry instanceof File)
      .map((entry) => new ExpoMealPhotoFile(entry));
  }
}

class ExpoMealPhotoStorage implements MealPhotoStorageAdapter {
  readonly drafts = new ExpoMealPhotoDirectory(new Directory(Paths.cache, 'meat-media-drafts'));
  readonly durable = new ExpoMealPhotoDirectory(new Directory(Paths.document, 'meat-media'));

  file(uri: string): MealPhotoFile {
    return new ExpoMealPhotoFile(new File(uri));
  }

  fileIn(directory: MealPhotoDirectory, name: string): MealPhotoFile {
    if (!(directory instanceof ExpoMealPhotoDirectory)) {
      throw new Error('Expo meal photos require an Expo directory.');
    }
    return new ExpoMealPhotoFile(new File(directory.native, name));
  }
}

const expoMealPhotoProcessor: MealPhotoProcessor = {
  async reencode(uri, actions, options) {
    return manipulateAsync(uri, [...actions], {
      compress: options.compress,
      format: SaveFormat.JPEG,
    });
  },
};

/** Production SDK 57 implementation backed by Expo's private app directories. */
export class LocalMealPhotoStore extends LocalMealPhotoStoreCore {
  constructor() {
    super(new ExpoMealPhotoStorage(), expoMealPhotoProcessor);
  }
}
