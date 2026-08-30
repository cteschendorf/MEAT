import type { ISODateTime, MediaId } from '@/domain/shared/ids';

export type MediaKind = 'photo';
export type MediaStorage = 'local' | 'synced';

export interface MediaAsset {
  id: MediaId;
  kind: MediaKind;
  storage: MediaStorage;
  uri: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
