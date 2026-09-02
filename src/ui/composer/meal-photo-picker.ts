import * as ImagePicker from 'expo-image-picker';

import type { MediaAsset } from '@/domain';
import type { ISODateTime, MediaId } from '@/domain/shared/ids';
import type { LocalMealPhoto } from '@/platform';
import { defaultLocalIdFactory, type AppServices } from '@/services';
import {
  MealPhotoComposerCoordinator,
  type MealPhotoPickerAdapter,
} from '@/services/media/meal-photo-workflow';
import { currentIso } from '@/ui/composer/meal-time';

/**
 * Expo's camera and library, behind the adapter the workflow expects.
 *
 * `exif: false` at both call sites is a privacy decision, not a size one: a
 * meal photo carries the place and time it was taken, and MEAT keeps private
 * tracking local-first. The re-encode downstream strips what survives anyway,
 * but asking for it stripped is the cheaper guarantee.
 */
export const expoMealPhotoPicker: MealPhotoPickerAdapter<ImagePicker.ImagePickerAsset> = {
  async requestPermission(source) {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      return { granted: permission.granted, canAskAgain: permission.canAskAgain };
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return {
      granted: permission.granted,
      canAskAgain: permission.canAskAgain,
      ...(permission.accessPrivileges === undefined
        ? {}
        : { accessPrivileges: permission.accessPrivileges }),
    };
  },
  async launch(source, options) {
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 1,
          exif: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, options.selectionLimit),
          quality: 1,
          exif: false,
        });
    return { canceled: result.canceled, assets: result.assets ?? [] };
  },
};

export function photoCoordinator(services: Pick<AppServices, 'mealPhotoFiles'>) {
  return new MealPhotoComposerCoordinator(
    expoMealPhotoPicker,
    services.mealPhotoFiles,
    () => defaultLocalIdFactory('media') as MediaId,
    currentIso,
  );
}

/** A staged photo as the media record a saved meal points at. */
export function mediaAssetFor(photo: LocalMealPhoto, updatedAt: ISODateTime): MediaAsset {
  return {
    id: photo.id,
    kind: 'photo',
    storage: 'local',
    uri: photo.uri,
    mimeType: photo.mimeType,
    width: photo.width,
    height: photo.height,
    byteSize: photo.byteSize,
    createdAt: photo.createdAt,
    updatedAt,
  };
}
