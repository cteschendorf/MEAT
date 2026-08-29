import type { ISODateTime, MediaId } from '@/domain/shared/ids';

export type MediaKind = 'photo';
export type MediaStorage = 'local' | 'synced';

export interface MediaAsset {
  id: MediaId;
  kind: MediaKind;
  storage: MediaStorage;
  uri: string;
  width?: number;
  height?: number;
  createdAt: ISODateTime;
}
