import assert from 'node:assert/strict';
import test from 'node:test';

import type { ISODateTime, MediaId } from '../src/domain/shared/ids';
import {
  LocalMealPhotoStoreCore,
  MEAL_PHOTO_JPEG_QUALITY,
  MEAL_PHOTO_MAX_LONG_EDGE,
  type LocalMealPhoto,
  type MealPhotoDirectory,
  type MealPhotoFile,
  type MealPhotoProcessor,
  type MealPhotoResizeAction,
  type MealPhotoStorageAdapter,
} from '../src/platform/media/local-meal-photo-store-core';
import {
  cancelMealPhotoDraft,
  decideMealPhotoPermission,
  MealPhotoComposerCoordinator,
  pickMealPhotos,
  reconstructMealPhotoOrder,
  stageMealPhotoSelection,
  type MealPhotoPickerAdapter,
} from '../src/services/media/meal-photo-workflow';

const timestamp = '2026-08-29T14:00:00.000Z' as ISODateTime;
const ordinaryJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const exifJpeg = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a,
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x01, 0x02,
  0xff, 0xd9,
]);

function mediaId(value: string): MediaId {
  return value as MediaId;
}

interface MemoryEntry {
  bytes: Uint8Array;
  lastModified: number;
}

class MemoryPhotoFile implements MealPhotoFile {
  constructor(
    private readonly storage: MemoryPhotoStorage,
    readonly uri: string,
  ) {}

  get exists(): boolean { return this.storage.entries.has(this.uri); }
  get size(): number { return this.storage.entries.get(this.uri)?.bytes.length ?? 0; }
  get lastModified(): number | null {
    return this.storage.entries.get(this.uri)?.lastModified ?? null;
  }

  async bytes(): Promise<Uint8Array> {
    const entry = this.storage.entries.get(this.uri);
    if (!entry) throw new Error(`Missing ${this.uri}`);
    return entry.bytes;
  }

  async move(destination: MealPhotoFile): Promise<void> {
    if (!(destination instanceof MemoryPhotoFile)) throw new Error('Unexpected storage adapter.');
    if (this.storage.failMoveTo === destination.uri) throw new Error('Injected move failure.');
    const entry = this.storage.entries.get(this.uri);
    if (!entry) throw new Error(`Missing ${this.uri}`);
    this.storage.entries.set(destination.uri, entry);
    this.storage.entries.delete(this.uri);
  }

  delete(): void {
    this.storage.entries.delete(this.uri);
  }
}

class MemoryPhotoDirectory implements MealPhotoDirectory {
  constructor(
    private readonly storage: MemoryPhotoStorage,
    readonly uri: string,
  ) {}

  create(): void {
    this.storage.createdDirectories.add(this.uri);
  }

  listFiles(): readonly MealPhotoFile[] {
    const prefix = `${this.uri}/`;
    return [...this.storage.entries.keys()]
      .filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
      .sort()
      .map((uri) => new MemoryPhotoFile(this.storage, uri));
  }
}

class MemoryPhotoStorage implements MealPhotoStorageAdapter {
  readonly entries = new Map<string, MemoryEntry>();
  readonly createdDirectories = new Set<string>();
  readonly drafts = new MemoryPhotoDirectory(this, 'mem://cache/meat-media-drafts');
  readonly durable = new MemoryPhotoDirectory(this, 'mem://document/meat-media');
  failMoveTo: string | null = null;

  file(uri: string): MealPhotoFile {
    return new MemoryPhotoFile(this, uri);
  }

  fileIn(directory: MealPhotoDirectory, name: string): MealPhotoFile {
    return new MemoryPhotoFile(this, `${directory.uri}/${name}`);
  }

  write(uri: string, bytes: Uint8Array, lastModified = 1_000): void {
    this.entries.set(uri, { bytes, lastModified });
  }

  uris(): readonly string[] {
    return [...this.entries.keys()].sort();
  }
}

class MemoryPhotoProcessor implements MealPhotoProcessor {
  readonly calls: {
    uri: string;
    actions: readonly MealPhotoResizeAction[];
    options: { readonly compress: number; readonly format: 'jpeg' };
  }[] = [];

  constructor(
    private readonly storage: MemoryPhotoStorage,
    private readonly bytes: Uint8Array = ordinaryJpeg,
  ) {}

  async reencode(
    uri: string,
    actions: readonly MealPhotoResizeAction[],
    options: { readonly compress: number; readonly format: 'jpeg' },
  ) {
    this.calls.push({ uri, actions, options });
    const processedUri = `mem://processed/${this.calls.length}.jpg`;
    this.storage.write(processedUri, this.bytes);
    return {
      uri: processedUri,
      width: actions[0]?.resize.width ?? 1_000,
      height: actions[0]?.resize.height ?? 500,
    };
  }
}

function localPhoto(id: string, uri = `mem://cache/meat-media-drafts/${id}.jpg`): LocalMealPhoto {
  return {
    id: mediaId(id),
    uri,
    mimeType: 'image/jpeg',
    width: 1_000,
    height: 500,
    byteSize: ordinaryJpeg.length,
    createdAt: timestamp,
  };
}

test('camera denial never launches a picker, while limited library access remains usable', async () => {
  let launched = false;
  const denied: MealPhotoPickerAdapter = {
    requestPermission: async () => ({ granted: false, canAskAgain: false }),
    launch: async () => {
      launched = true;
      return { canceled: false, assets: [] };
    },
  };
  assert.deepEqual(await pickMealPhotos('camera', 0, denied), {
    kind: 'permission-denied',
    source: 'camera',
    canAskAgain: false,
    photos: [],
  });
  assert.equal(launched, false);
  assert.deepEqual(
    decideMealPhotoPermission('camera', {
      granted: false,
      canAskAgain: true,
      accessPrivileges: 'limited',
    }),
    { allowed: false, canAskAgain: true },
  );

  let requestedLimit = 0;
  const assets = Array.from({ length: 4 }, (_, index) => ({
    uri: `asset://${index}`,
    width: 100,
    height: 100,
  }));
  const limited: MealPhotoPickerAdapter = {
    requestPermission: async () => ({
      granted: false,
      canAskAgain: true,
      accessPrivileges: 'limited',
    }),
    launch: async (_source, options) => {
      requestedLimit = options.selectionLimit;
      return { canceled: false, assets };
    },
  };
  const result = await pickMealPhotos('library', 2, limited);
  assert.equal(requestedLimit, 3);
  assert.equal(result.kind, 'selected');
  if (result.kind !== 'selected') return;
  assert.equal(result.permissionScope, 'limited');
  assert.deepEqual(result.photos.map((photo) => photo.uri), ['asset://0', 'asset://1', 'asset://2']);
  assert.equal(result.remainingCapacity, 0);
});

test('picker cancellation returns no assets and the five-photo limit prevents any permission request', async () => {
  let permissionRequests = 0;
  const picker: MealPhotoPickerAdapter = {
    requestPermission: async () => {
      permissionRequests += 1;
      return { granted: true, canAskAgain: true };
    },
    launch: async () => ({ canceled: true, assets: [{ uri: 'ignored', width: 1, height: 1 }] }),
  };
  assert.deepEqual(await pickMealPhotos('camera', 0, picker), { kind: 'cancelled', photos: [] });
  assert.deepEqual(await pickMealPhotos('library', 5, picker), {
    kind: 'limit-reached',
    photos: [],
  });
  assert.equal(permissionRequests, 1);
});

test('production coordinator owns permission, five-photo staging order, and cancellation cleanup', async () => {
  const storage = new MemoryPhotoStorage();
  const processor = new MemoryPhotoProcessor(storage);
  const store = new LocalMealPhotoStoreCore(storage, processor);
  const prior = localPhoto('prior');
  storage.write(prior.uri, ordinaryJpeg);
  const launches: { source: string; limit: number }[] = [];
  const picker: MealPhotoPickerAdapter = {
    requestPermission: async (source) => {
      assert.equal(source, 'library');
      return { granted: true, canAskAgain: true, accessPrivileges: 'limited' };
    },
    launch: async (source, options) => {
      launches.push({ source, limit: options.selectionLimit });
      return {
        canceled: false,
        assets: Array.from({ length: 4 }, (_, index) => ({
          uri: `asset://coordinator-${index}`,
          width: 100,
          height: 100,
        })),
      };
    },
  };
  let nextId = 0;
  const coordinator = new MealPhotoComposerCoordinator(
    picker,
    store,
    () => mediaId(`coordinated:${nextId++}`),
    () => timestamp,
  );
  const result = await coordinator.pickAndStage({
    source: 'library',
    retainedCount: 1,
    stagedPhotos: [prior],
  });
  assert.equal(result.kind, 'selected');
  if (result.kind !== 'selected') return;
  assert.deepEqual(launches, [{ source: 'library', limit: 3 }]);
  assert.deepEqual(result.stagedPhotos.map((photo) => photo.id), [
    mediaId('prior'),
    mediaId('coordinated:0'),
    mediaId('coordinated:1'),
    mediaId('coordinated:2'),
  ]);
  assert.equal(processor.calls.length, 3);
  assert.equal(result.remainingCapacity, 0);

  await coordinator.cancel(result.stagedPhotos);
  assert.deepEqual(storage.uris(), []);
});

test('staging re-encodes to a 2048px JPEG at 0.85 and rejects EXIF derivatives', async () => {
  const storage = new MemoryPhotoStorage();
  const processor = new MemoryPhotoProcessor(storage);
  const store = new LocalMealPhotoStoreCore(storage, processor);
  const photo = await store.stage(
    { uri: 'asset://wide', width: 4_096, height: 1_000 },
    mediaId('media:wide'),
    timestamp,
  );

  assert.deepEqual(processor.calls, [{
    uri: 'asset://wide',
    actions: [{ resize: { width: MEAL_PHOTO_MAX_LONG_EDGE } }],
    options: { compress: MEAL_PHOTO_JPEG_QUALITY, format: 'jpeg' },
  }]);
  assert.equal(photo.width, 2_048);
  assert.equal(photo.mimeType, 'image/jpeg');
  assert.deepEqual(storage.uris(), ['mem://cache/meat-media-drafts/media_wide.jpg']);

  const exifStorage = new MemoryPhotoStorage();
  const exifStore = new LocalMealPhotoStoreCore(
    exifStorage,
    new MemoryPhotoProcessor(exifStorage, exifJpeg),
  );
  await assert.rejects(
    exifStore.stage(
      { uri: 'asset://exif', width: 100, height: 100 },
      mediaId('media:exif'),
      timestamp,
    ),
    /EXIF metadata/,
  );
  assert.deepEqual(exifStorage.uris(), []);
});

test('batch staging preserves order, slices at five, and cleans partial output on failure', async () => {
  const existing = [localPhoto('existing:1'), localPhoto('existing:2')];
  const selected = Array.from({ length: 5 }, (_, index) => ({
    uri: `asset://${index}`,
    width: 100,
    height: 100,
  }));
  let nextId = 0;
  const stagedUris: string[] = [];
  const discardedUris: string[] = [];
  const result = await stageMealPhotoSelection({
    existing,
    selected,
    createId: () => mediaId(`new:${nextId++}`),
    now: () => timestamp,
    store: {
      stage: async (_photo, id) => {
        const result = localPhoto(id, `draft://${id}`);
        stagedUris.push(result.uri);
        return result;
      },
      discard: ({ uri }) => { discardedUris.push(uri); },
    },
  });
  assert.deepEqual(result.map((photo) => photo.id), [
    mediaId('existing:1'),
    mediaId('existing:2'),
    mediaId('new:0'),
    mediaId('new:1'),
    mediaId('new:2'),
  ]);
  assert.equal(stagedUris.length, 3);
  assert.deepEqual(discardedUris, []);

  let attempts = 0;
  const cleaned: string[] = [];
  await assert.rejects(stageMealPhotoSelection({
    existing: [],
    selected,
    createId: () => mediaId(`partial:${attempts}`),
    now: () => timestamp,
    store: {
      stage: async (_photo, id) => {
        attempts += 1;
        if (attempts === 3) throw new Error('Injected processing failure.');
        return localPhoto(id, `draft://${id}`);
      },
      discard: ({ uri }) => { cleaned.push(uri); },
    },
  }), /Injected processing failure/);
  assert.deepEqual(cleaned, ['draft://partial:1', 'draft://partial:0']);
});

test('composer cancellation attempts every staged-file cleanup even when one delete fails', async () => {
  const attempted: string[] = [];
  await assert.rejects(cancelMealPhotoDraft(
    [localPhoto('one', 'draft://one'), localPhoto('two', 'draft://two')],
    {
      discard: ({ uri }) => {
        attempted.push(uri);
        if (uri === 'draft://one') throw new Error('Injected delete failure.');
      },
    },
  ), /could not be removed/);
  assert.deepEqual(attempted, ['draft://one', 'draft://two']);
});

test('mid-promotion failure restores prior files and reconstruction preserves explicit display order', async () => {
  const storage = new MemoryPhotoStorage();
  const store = new LocalMealPhotoStoreCore(storage, new MemoryPhotoProcessor(storage));
  const photos = [localPhoto('one'), localPhoto('two'), localPhoto('three')];
  for (const photo of photos) storage.write(photo.uri, ordinaryJpeg);
  storage.failMoveTo = 'mem://document/meat-media/two.jpg';

  const unusedPicker: MealPhotoPickerAdapter = {
    requestPermission: async () => ({ granted: true, canAskAgain: true }),
    launch: async () => ({ canceled: true, assets: [] }),
  };
  const coordinator = new MealPhotoComposerCoordinator(
    unusedPicker,
    store,
    () => mediaId('unused'),
    () => timestamp,
  );
  await assert.rejects(coordinator.promote(photos), /Injected move failure/);
  assert.deepEqual(storage.uris(), [
    'mem://cache/meat-media-drafts/one.jpg',
    'mem://cache/meat-media-drafts/three.jpg',
    'mem://cache/meat-media-drafts/two.jpg',
  ]);

  assert.deepEqual(
    reconstructMealPhotoOrder(
      [mediaId('three'), mediaId('one'), mediaId('two')],
      photos,
    ).map((photo) => photo.id),
    [mediaId('three'), mediaId('one'), mediaId('two')],
  );
  assert.throws(
    () => reconstructMealPhotoOrder([mediaId('missing')], photos),
    /is missing/,
  );
});

test('production coordinator reconstructs retry order and drops only an unrestorable promoted file', async () => {
  const storage = new MemoryPhotoStorage();
  const store = new LocalMealPhotoStoreCore(storage, new MemoryPhotoProcessor(storage));
  const promoted = [
    localPhoto('one', `${storage.durable.uri}/one.jpg`),
    localPhoto('two', `${storage.durable.uri}/two.jpg`),
  ];
  for (const photo of promoted) storage.write(photo.uri, ordinaryJpeg);
  storage.failMoveTo = `${storage.drafts.uri}/two.jpg`;
  const coordinator = new MealPhotoComposerCoordinator(
    {
      requestPermission: async () => ({ granted: true, canAskAgain: true }),
      launch: async () => ({ canceled: true, assets: [] }),
    },
    store,
    () => mediaId('unused'),
    () => timestamp,
  );

  const rollback = await coordinator.restoreForRetry(promoted);
  assert.deepEqual(rollback.restored.map((photo) => photo.id), [mediaId('one')]);
  assert.deepEqual(rollback.unavailableIds, [mediaId('two')]);
  assert.deepEqual(storage.uris(), [`${storage.drafts.uri}/one.jpg`]);
});

test('orphan cleanup retains attached and fresh files while removing expired drafts and orphans', () => {
  const storage = new MemoryPhotoStorage();
  const store = new LocalMealPhotoStoreCore(storage, new MemoryPhotoProcessor(storage));
  const oldDraft = `${storage.drafts.uri}/old.jpg`;
  const freshDraft = `${storage.drafts.uri}/fresh.jpg`;
  const attached = `${storage.durable.uri}/attached.jpg`;
  const oldOrphan = `${storage.durable.uri}/orphan.jpg`;
  const freshOrphan = `${storage.durable.uri}/fresh-orphan.jpg`;
  storage.write(oldDraft, ordinaryJpeg, 100);
  storage.write(freshDraft, ordinaryJpeg, 900);
  storage.write(attached, ordinaryJpeg, 100);
  storage.write(oldOrphan, ordinaryJpeg, 100);
  storage.write(freshOrphan, ordinaryJpeg, 900);

  store.cleanup({
    attachedUris: new Set([attached]),
    now: 1_000,
    draftMaxAgeMs: 200,
    orphanGraceMs: 200,
  });
  assert.deepEqual(storage.uris(), [attached, freshOrphan, freshDraft].sort());
});

test('deleteAll purges both unconfirmed drafts and confirmed durable media', () => {
  const storage = new MemoryPhotoStorage();
  const store = new LocalMealPhotoStoreCore(storage, new MemoryPhotoProcessor(storage));
  storage.write(`${storage.drafts.uri}/draft.jpg`, ordinaryJpeg);
  storage.write(`${storage.durable.uri}/confirmed.jpg`, ordinaryJpeg);
  store.deleteAll();
  assert.deepEqual(storage.uris(), []);
  assert.deepEqual([...storage.createdDirectories].sort(), [
    storage.drafts.uri,
    storage.durable.uri,
  ].sort());
});
