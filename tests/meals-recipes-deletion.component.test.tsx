import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import MealsRecipesScreen from '../app/meals-recipes';
import type { Recipe, SavedMeal } from '../src/domain';
import type { ISODateTime, RecipeId, SavedMealId } from '../src/domain/shared/ids';
import { openAppServices, type AppServices } from '../src/services/app-services';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ dismissTo: jest.fn() }),
}));

jest.mock('../src/services/app-services', () => ({
  openAppServices: jest.fn(),
}));

jest.mock('../src/ui/navigation/use-mutation-route-guard', () => ({
  useMutationRouteGuard: () => (action: () => void) => action(),
}));

const now = '2026-08-29T15:00:00.000Z' as ISODateTime;
const savedMeal: SavedMeal = {
  id: 'saved-meal:weekend-prep' as SavedMealId,
  name: 'Weekend prep',
  items: [],
  createdAt: now,
  updatedAt: now,
};
const recipe: Recipe = {
  id: 'recipe:protein-pasta' as RecipeId,
  name: 'Protein pasta',
  ingredients: [],
  yieldServings: 2,
  totalYieldGrams: 400,
  createdAt: now,
  updatedAt: now,
};

function servicesWith(options?: {
  deleteRecipe?: jest.Mock<Promise<void>, [RecipeId]>;
  deleteSavedMeal?: jest.Mock<Promise<void>, [SavedMealId]>;
}): AppServices {
  return {
    foods: { list: jest.fn().mockResolvedValue([]) },
    recipeService: {
      list: jest.fn().mockResolvedValue([recipe]),
      delete: options?.deleteRecipe ?? jest.fn().mockResolvedValue(undefined),
    },
    savedMealService: {
      list: jest.fn().mockResolvedValue([savedMeal]),
      delete: options?.deleteSavedMeal ?? jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppServices;
}

function confirmationButton(buttons: readonly AlertButton[] | undefined, text: string) {
  const button = buttons?.find((candidate) => candidate.text === text);
  if (!button) throw new Error(`Missing ${text} confirmation button.`);
  return button;
}

describe('saved meal and recipe deletion confirmation', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

  beforeEach(() => {
    alert.mockClear();
    jest.mocked(openAppServices).mockReset();
  });

  afterAll(() => {
    alert.mockRestore();
  });

  it('requires destructive confirmation before deleting a saved meal and keeps duplicate confirms exclusive', async () => {
    let finishDelete: (() => void) | undefined;
    const deleteSavedMeal = jest.fn(
      () => new Promise<void>((resolve) => {
        finishDelete = resolve;
      }),
    );
    jest.mocked(openAppServices).mockResolvedValue(servicesWith({ deleteSavedMeal }));
    const screen = await render(<MealsRecipesScreen />);
    await screen.findByText(savedMeal.name);

    await fireEvent.press(screen.getByRole('button', { name: `Delete saved meal ${savedMeal.name}` }));

    expect(deleteSavedMeal).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Delete saved meal?',
      expect.stringContaining(savedMeal.name),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Delete saved meal', style: 'destructive' }),
      ]),
    );

    const confirm = confirmationButton(alert.mock.calls[0]?.[2], 'Delete saved meal');
    await act(async () => {
      confirm.onPress?.();
      confirm.onPress?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(deleteSavedMeal).toHaveBeenCalledTimes(1));

    await act(async () => {
      finishDelete?.();
      await Promise.resolve();
    });
    await screen.findByText(`${savedMeal.name} deleted.`);
  });

  it('requires destructive confirmation before deleting a recipe', async () => {
    const deleteRecipe = jest.fn().mockResolvedValue(undefined);
    jest.mocked(openAppServices).mockResolvedValue(servicesWith({ deleteRecipe }));
    const screen = await render(<MealsRecipesScreen />);
    await screen.findByText(recipe.name);

    await fireEvent.press(screen.getByRole('button', { name: `Delete recipe ${recipe.name}` }));

    expect(deleteRecipe).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Delete recipe?',
      expect.stringContaining(recipe.name),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Delete recipe', style: 'destructive' }),
      ]),
    );

    const confirm = confirmationButton(alert.mock.calls[0]?.[2], 'Delete recipe');
    await act(async () => {
      confirm.onPress?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(deleteRecipe).toHaveBeenCalledWith(recipe.id));
    await screen.findByText(`${recipe.name} deleted. Earlier logged nutrition was kept.`);
  });
});
