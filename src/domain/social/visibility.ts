export type SharingVisibility = 'private' | 'friends' | 'public';

export interface SharingPolicy {
  visibility: SharingVisibility;
  shareFoodContext: boolean;
  shareNutrition: boolean;
  shareCaption: boolean;
  shareLocation: boolean;
}
