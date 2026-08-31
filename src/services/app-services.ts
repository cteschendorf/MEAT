import type { SQLiteDatabase } from 'expo-sqlite';

import { appConfig } from '@/config';
import {
  createProviderCache,
  createUsdaCoreFoodProvider,
  FoodSourcePreferenceStore,
  openMeatDatabase,
  SqliteFavoriteFoodRepository,
  SqliteFoodReferenceRepository,
  SqliteFoodRepository,
  SqliteGoalRepository,
  SqliteMealRepository,
  SqliteMediaRepository,
  SqlitePrivateDataRepository,
  SqliteRecipeRepository,
  SqliteSavedMealRepository,
  SqliteUserPreferencesRepository,
  transferLegacyProviderFoodSnapshots,
  SqliteTransactionRunner,
} from '@/data';
import { OpenFoodFactsProvider } from '@/data/providers/open-food-facts';
import { UsdaFdcProxyProvider } from '@/data/providers/usda-fdc-proxy';
import type {
  FoodLookupResult,
  FoodProvider,
  FoodProviderCapabilities,
  FoodSearchOptions,
} from '@/data/providers/contracts';
import type { FoodRef, FoodSearchGroup, FoodSourceId } from '@/domain/food/source';
import type { ISODateTime } from '@/domain/shared/ids';
import { LocalMealPhotoStore } from '@/platform';
import {
  CompositeFoodRepository,
  FoodDiscoveryService,
  PersonalFoodProvider,
} from '@/services/logging/food-discovery';
import { FoodLoggingService, defaultLocalIdFactory } from '@/services/logging/food-logging';
import { FoodSuggestionsService } from '@/services/logging/food-suggestions';
import { RecipeService, SavedMealService } from '@/services/meals/saved-meals';
import { MealComposerService } from '@/services/meals/meal-composer';
import { MealHistoryService } from '@/services/meals/meal-history';
import { PrivateDataLifecycleService } from '@/services/privacy/private-data-lifecycle';
import { PrivateDataWriteCoordinator } from '@/services/privacy/private-data-write-coordinator';
import { mealComposerSessions } from '@/ui/meal-composer-session';

class UnavailableFoodProvider implements FoodProvider {
  readonly capabilities: FoodProviderCapabilities;

  constructor(
    readonly id: FoodSourceId,
    private readonly message: string,
  ) {
    this.capabilities = {
      search: true,
      getById: true,
      lookupBarcode: id === 'open-food-facts',
      persist: false,
    };
  }

  async search(query: string, _options?: FoodSearchOptions): Promise<FoodSearchGroup> {
    return {
      sourceId: this.id,
      query,
      state: 'error',
      candidates: [],
      issue: { kind: 'error', code: 'source-unavailable', message: this.message },
    };
  }

  async getById(_ref: FoodRef): Promise<FoodLookupResult> {
    return {
      candidate: null,
      freshness: 'fresh-cache',
      issue: { kind: 'error', code: 'source-unavailable', message: this.message },
    };
  }

  async lookupBarcode(_barcode: string): Promise<FoodLookupResult> {
    return {
      candidate: null,
      freshness: 'fresh-cache',
      issue: { kind: 'error', code: 'source-unavailable', message: this.message },
    };
  }
}

export interface AppServices {
  readonly database: SQLiteDatabase;
  readonly personalFoods: SqliteFoodRepository;
  readonly foods: CompositeFoodRepository;
  readonly meals: SqliteMealRepository;
  readonly media: SqliteMediaRepository;
  readonly goals: SqliteGoalRepository;
  readonly favorites: SqliteFavoriteFoodRepository;
  readonly preferences: FoodSourcePreferenceStore;
  readonly userPreferences: SqliteUserPreferencesRepository;
  readonly recipes: SqliteRecipeRepository;
  readonly savedMeals: SqliteSavedMealRepository;
  readonly discovery: FoodDiscoveryService;
  readonly logging: FoodLoggingService;
  readonly suggestions: FoodSuggestionsService;
  readonly recipeService: RecipeService;
  readonly savedMealService: SavedMealService;
  readonly mealComposer: MealComposerService;
  readonly mealHistory: MealHistoryService;
  readonly mealPhotoFiles: LocalMealPhotoStore;
  readonly privateDataWrites: PrivateDataWriteCoordinator;
  readonly privateData: PrivateDataLifecycleService;
}

let servicesPromise: Promise<AppServices> | null = null;

async function createOptionalProvider(
  sourceId: FoodSourceId,
  create: () => Promise<FoodProvider>,
): Promise<FoodProvider> {
  try {
    return await create();
  } catch (error) {
    return new UnavailableFoodProvider(
      sourceId,
      error instanceof Error ? error.message : `${sourceId} could not be opened.`,
    );
  }
}

export function openAppServices(): Promise<AppServices> {
  if (servicesPromise) return servicesPromise;
  servicesPromise = (async () => {
    const database = await openMeatDatabase();
    const personalFoods = new SqliteFoodRepository(database);
    const meals = new SqliteMealRepository(database);
    const media = new SqliteMediaRepository(database);
    const mealPhotoFiles = new LocalMealPhotoStore();
    const privateDataRepository = new SqlitePrivateDataRepository(database);
    const transactions = new SqliteTransactionRunner(database);
    const privateDataWrites = new PrivateDataWriteCoordinator();
    const goals = new SqliteGoalRepository(database);
    const favorites = new SqliteFavoriteFoodRepository(database);
    const references = new SqliteFoodReferenceRepository(database);
    const preferences = new FoodSourcePreferenceStore(database);
    const userPreferences = new SqliteUserPreferencesRepository(database);
    const recipes = new SqliteRecipeRepository(database);
    const savedMeals = new SqliteSavedMealRepository(database);

    const [usdaCore, usdaOnline, openFoodFacts] = await Promise.all([
      createOptionalProvider('usda-core', createUsdaCoreFoodProvider),
      createOptionalProvider('usda-fdc', async () =>
        new UsdaFdcProxyProvider({
          cache: await createProviderCache('usda-fdc'),
          baseUrl: appConfig.usdaProxyBaseUrl,
        }),
      ),
      createOptionalProvider('open-food-facts', async () =>
        new OpenFoodFactsProvider({ cache: await createProviderCache('open-food-facts') }),
      ),
    ]);
    const providers: readonly FoodProvider[] = [
      new PersonalFoodProvider(personalFoods),
      usdaCore,
      usdaOnline,
      openFoodFacts,
    ];
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    await transferLegacyProviderFoodSnapshots(database, async (candidate) => {
      const provider = providerById.get(candidate.ref.sourceId);
      if (!provider?.persist) {
        throw new Error(`Legacy ${candidate.ref.sourceId} food could not be retained.`);
      }
      await provider.persist(candidate);
    });
    const discovery = new FoodDiscoveryService(providers, preferences);
    const foods = new CompositeFoodRepository(personalFoods, discovery, references);
    const logging = new FoodLoggingService(
      foods,
      meals,
      defaultLocalIdFactory,
    );
    const mealComposer = new MealComposerService(
      foods,
      meals,
      discovery,
      defaultLocalIdFactory,
      media,
      transactions,
      privateDataWrites,
    );
    const mealHistory = new MealHistoryService(
      meals,
      media,
      defaultLocalIdFactory,
      mealPhotoFiles,
      transactions,
    );
    const cleanupNow = new Date();
    const cleanupCutoff = cleanupNow.toISOString() as ISODateTime;
    try {
      const retainedMedia = await media.list(2_147_483_647);
      mealPhotoFiles.cleanup({
        attachedUris: new Set(retainedMedia.map((asset) => asset.uri)),
        now: cleanupNow.getTime(),
        draftMaxAgeMs: 0,
        orphanGraceMs: 0,
      });
      // Composer drafts and the ten-second Undo token are session-local. After
      // a restart no UI can resume them, so every unattached row/file is an
      // orphan and can be finalized immediately instead of lingering 24 hours.
      await mealHistory.cleanupUnattached(cleanupCutoff, 2_147_483_647);
    } catch {
      // Cleanup is retryable and must not make otherwise-valid private history unavailable.
    }

    return {
      database,
      personalFoods,
      foods,
      meals,
      media,
      goals,
      favorites,
      preferences,
      userPreferences,
      recipes,
      savedMeals,
      discovery,
      logging,
      suggestions: new FoodSuggestionsService(meals, foods, favorites),
      recipeService: new RecipeService(recipes, foods),
      savedMealService: new SavedMealService(savedMeals, meals, defaultLocalIdFactory),
      mealComposer,
      mealHistory,
      mealPhotoFiles,
      privateDataWrites,
      privateData: new PrivateDataLifecycleService(
        privateDataRepository,
        media,
        mealPhotoFiles,
        mealHistory,
        mealComposerSessions,
        privateDataWrites,
      ),
    };
  })().catch((error: unknown) => {
    servicesPromise = null;
    throw error;
  });
  return servicesPromise;
}
