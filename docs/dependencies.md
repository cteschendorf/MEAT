# Dependency policy

Add dependencies only when they materially reduce risk or provide platform capability that would be costly to implement correctly.

Before adding a package, check maintenance activity, license, bundle/runtime cost, privacy/telemetry behavior, Expo SDK compatibility, and whether Expo/React Native already provides the capability.

Prefer Expo SDK-aligned versions and platform APIs. Avoid packages added only to save a few lines of code.

Native dependencies do not authorize an EAS build. If a dependency eventually requires a custom build, stop and request explicit approval for that specific EAS build.

## Approved native dependencies

### `expo-camera` `~57.0.4`

Used for THI-269 packaged-food barcode scanning. This is the Expo-maintained SDK 57 camera module rather than a third-party scanner wrapper. Barcode scanning is enabled; Android audio recording is disabled. MEAT requests camera permission only after the user enters the barcode-scanning flow. The module does not change the rule above: adding it does not authorize or trigger an EAS build.
