import assert from 'node:assert/strict';
import test from 'node:test';

import type { MediaAsset } from '../src/domain/media/media';
import type { ISODateTime, MediaId } from '../src/domain/shared/ids';
import type { MediaRepository, PrivateDataRepository } from '../src/data/repositories/contracts';
import { PrivateDataLifecycleService } from '../src/services/privacy/private-data-lifecycle';

const asset = (id: string, uri: string): MediaAsset => ({
  id: id as MediaId,
  kind: 'photo',
  storage: 'local',
  uri,
  mimeType: 'image/jpeg',
  width: 100,
  height: 80,
  byteSize: 20,
  createdAt: '2026-08-29T12:00:00.000Z' as ISODateTime,
  updatedAt: '2026-08-29T12:00:00.000Z' as ISODateTime,
});

test('private-data deletion removes database records before every retained media file', async () => {
  const calls: string[] = [];
  const records: PrivateDataRepository = {
    exportJson: async () => '{"ok":true}',
    deleteAllPrivateData: async () => { calls.push('database'); },
  };
  const assets = [asset('media:1', 'file:///one.jpg'), asset('media:2', 'file:///two.jpg')];
  const media = {
    list: async () => assets,
  } as unknown as MediaRepository;
  const service = new PrivateDataLifecycleService(records, media, {
    delete: (uri) => { calls.push(uri); },
  });

  assert.equal(await service.exportJson(), '{"ok":true}');
  await service.deleteAll();
  assert.deepEqual(calls, ['database', 'file:///one.jpg', 'file:///two.jpg']);
});

test('private-data deletion never removes files if the database transaction fails', async () => {
  const deleted: string[] = [];
  const service = new PrivateDataLifecycleService(
    {
      exportJson: async () => '{}',
      deleteAllPrivateData: async () => { throw new Error('database failed'); },
    },
    { list: async () => [asset('media:1', 'file:///one.jpg')] } as unknown as MediaRepository,
    { delete: (uri) => { deleted.push(uri); } },
  );

  await assert.rejects(service.deleteAll(), /database failed/);
  assert.deepEqual(deleted, []);
});

test('private-data deletion uses a complete media purge when the file store provides one', async () => {
  const calls: string[] = [];
  const service = new PrivateDataLifecycleService(
    {
      exportJson: async () => '{}',
      deleteAllPrivateData: async () => { calls.push('database'); },
    },
    { list: async () => [asset('media:1', 'file:///confirmed.jpg')] } as unknown as MediaRepository,
    {
      delete: (uri) => { calls.push(uri); },
      deleteAll: () => { calls.push('all-files'); },
    },
  );

  await service.deleteAll();
  assert.deepEqual(calls, ['database', 'all-files']);
});
