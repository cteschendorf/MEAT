export type AppConfig = Readonly<{
  environment: 'development' | 'production';
}>;

export const appConfig: AppConfig = {
  environment: __DEV__ ? 'development' : 'production',
};
