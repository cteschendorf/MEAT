export type MassUnitPreference = 'g' | 'oz';
export type EnergyUnitPreference = 'kcal';
export type AppearancePreference = 'system' | 'light' | 'dark';

export interface UserPreferences {
  massUnit: MassUnitPreference;
  energyUnit: EnergyUnitPreference;
  appearance: AppearancePreference;
  weekStartsOn: 0 | 1;
}
