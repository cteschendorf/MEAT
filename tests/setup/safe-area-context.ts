// Component tests mount screens and their pieces directly, without the
// `<SafeAreaProvider>` expo-router installs at the real app's root — so
// `useSafeAreaInsets()` has nothing to read from and throws ("No safe area
// value available"). The library ships a jest mock built for exactly this;
// it returns zero insets absent a provider, which is the right default for
// a test bed with no notch to speak of.
jest.mock('react-native-safe-area-context', () => {
  // The mock is authored as `export default {...}`; unwrap the CommonJS
  // interop wrapper so named imports like `useSafeAreaInsets` resolve.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock's factory must require lazily, not import
  const mock = require('react-native-safe-area-context/jest/mock');
  return mock.default ?? mock;
});
