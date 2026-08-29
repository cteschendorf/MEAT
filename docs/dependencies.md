# Dependency policy

Add dependencies only when they materially reduce risk or provide platform capability that would be costly to implement correctly.

Before adding a package, check maintenance activity, license, bundle/runtime cost, privacy/telemetry behavior, Expo SDK compatibility, and whether Expo/React Native already provides the capability.

Prefer Expo SDK-aligned versions and platform APIs. Avoid packages added only to save a few lines of code.

Native dependencies do not authorize an EAS build. If a dependency eventually requires a custom build, stop and request explicit approval for that specific EAS build.
