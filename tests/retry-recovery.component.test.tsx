import { fireEvent, render, waitFor } from '@testing-library/react-native';

import OnboardingScreen from '../app/onboarding';
import type { TodayMetric } from '../src/services/today/snapshot';
import { TodayScreen } from '../src/ui/screens/today-screen';

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockOpenMeatDatabase = jest.fn();
const mockOnboardingLoad = jest.fn();
const mockOnboardingSave = jest.fn();
const mockOpenAppServices = jest.fn();
const mockBuildTodaySnapshot = jest.fn();
const mockBuildMealTimelineEntries = jest.fn();

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]),
    useRouter: () => ({
      push: mockRouterPush,
      replace: mockRouterReplace,
    }),
  };
});

jest.mock('@/data', () => ({
  openMeatDatabase: (...args: unknown[]) => mockOpenMeatDatabase(...args),
  SqliteGoalRepository: jest.fn(),
  SqliteUserPreferencesRepository: jest.fn(),
}));

jest.mock('@/services/onboarding/setup', () => ({
  defaultUserPreferences: {
    massUnit: 'g',
    energyUnit: 'kcal',
    appearance: 'system',
    weekStartsOn: 0,
  },
  goalSetupDefinitions: [
    { nutrientCode: 'protein-g', label: 'Protein', unit: 'g' },
  ],
  OnboardingSetupService: jest.fn().mockImplementation(() => ({
    load: (...args: unknown[]) => mockOnboardingLoad(...args),
    save: (...args: unknown[]) => mockOnboardingSave(...args),
  })),
}));

jest.mock('@/services', () => ({
  openAppServices: (...args: unknown[]) => mockOpenAppServices(...args),
  buildTodaySnapshot: (...args: unknown[]) => mockBuildTodaySnapshot(...args),
  buildMealTimelineEntries: (...args: unknown[]) => mockBuildMealTimelineEntries(...args),
}));

const emptyMetrics: readonly TodayMetric[] = [
  { code: 'energy-kcal', value: null, state: 'unknown', goal: null },
  { code: 'protein-g', value: null, state: 'unknown', goal: null },
  { code: 'carbohydrate-g', value: null, state: 'unknown', goal: null },
  { code: 'fat-g', value: null, state: 'unknown', goal: null },
  { code: 'fiber-g', value: null, state: 'unknown', goal: null },
];

describe('retryable screen initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnboardingLoad.mockResolvedValue({
      preferences: {
        massUnit: 'g',
        energyUnit: 'kcal',
        appearance: 'system',
        weekStartsOn: 0,
      },
      goals: [],
      onboardingComplete: false,
    });
    mockBuildTodaySnapshot.mockResolvedValue({
      dateKey: '2026-08-30',
      meals: [],
      metrics: emptyMetrics,
      unavailableItems: [],
    });
    mockBuildMealTimelineEntries.mockResolvedValue([]);
  });

  it('retries onboarding after the local database fails to open', async () => {
    mockOpenMeatDatabase
      .mockRejectedValueOnce(new Error('Local settings could not be opened.'))
      .mockResolvedValueOnce({});

    const screen = await render(<OnboardingScreen />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('Local settings could not be opened.')).toBeTruthy();
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('Set up MEAT')).toBeTruthy());
    expect(mockOpenMeatDatabase).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Setup unavailable')).toBeNull();
  });

  it('retries Today after loading private history fails', async () => {
    const services = { meals: {}, foods: {}, goals: {} };
    mockOpenAppServices
      .mockRejectedValueOnce(new Error('Private history could not be read.'))
      .mockResolvedValueOnce(services);

    const screen = await render(<TodayScreen />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('Private history could not be read.')).toBeTruthy();
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('Nothing logged yet')).toBeTruthy());
    expect(mockOpenAppServices).toHaveBeenCalledTimes(2);
    expect(mockBuildTodaySnapshot).toHaveBeenCalledWith(
      expect.any(Date),
      { meals: services.meals, foods: services.foods, goals: services.goals },
    );
    expect(screen.queryByText('Today unavailable')).toBeNull();
  });
});
