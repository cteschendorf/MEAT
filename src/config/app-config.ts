export type AppConfig = Readonly<{
  environment: 'development' | 'production';
  usdaProxyBaseUrl: string;
}>;

export const appConfig: AppConfig = {
  environment: __DEV__ ? 'development' : 'production',
  usdaProxyBaseUrl: process.env.EXPO_PUBLIC_USDA_PROXY_URL ?? 'https://api.meatnutrition.app',
};
