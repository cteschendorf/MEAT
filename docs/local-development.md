# Local development

Use Node.js 22 and Python 3. Install the root app and the independently locked Cloudflare Worker dependencies before running the complete gate:

```sh
npm ci
npm run proxy:install
npm run quality
npm run quality:ios-export
npm start
```

`npm run quality` runs four non-release checks:

1. `quality:runtime` — root TypeScript, ESLint, and runtime tests.
2. `quality:expo` — Expo dependency alignment and Expo Doctor.
3. `quality:usda` — fixture generator tests plus manifest, checksum, count, integrity, foreign-key, Branded-exclusion, and FTS checks for the bundled USDA database.
4. `quality:proxy` — Cloudflare Worker typecheck and tests.

`npm run quality:all` adds `quality:ios-export`. That export is a local Expo/Metro iOS JavaScript bundle written outside the repository. It is useful for catching bundling and asset-resolution failures, but it is not an Xcode archive, signed binary, App Store upload, TestFlight submission, or EAS build.

The branded icon, splash screen, permission strings, and native route configuration also require a local iOS prebuild/build check. That check needs a full Xcode installation selected with `xcode-select`, its first-launch components installed, and the license accepted. Expo Go cannot faithfully validate production icon or splash behavior.

GitHub Actions mirrors these checks on pull requests and pushes to `main`. The workflow has no EAS, signing, upload, submission, Cloudflare deployment, or secret-provisioning step.

## Data and proxy work

`npm run usda:rebuild` deliberately downloads the pinned official USDA releases and regenerates the corpus and manifest. Routine verification uses the checked-in asset and does not need to rebuild the corpus. A failed or empty official download must stop generation rather than produce placeholder records.

`npm run proxy:dev` starts the USDA Worker locally after `npm run proxy:install`. The production custom domain is `api.meatnutrition.app`; the production FoodData Central key belongs only in the Cloudflare secret `USDA_FDC_API_KEY`. Never put the key in source control or an `EXPO_PUBLIC_` value.

Prefer Expo Go for development when the current feature set is supported there. Never run `eas build` or invoke an EAS workflow without explicit approval for that specific build; prior approval does not carry forward.

Before approving a release, use a physical iPhone to test multi-food composition, camera and limited photo-library access, five-photo ordering, manual location and notes, edit/move/delete/Undo, Dynamic Type, VoiceOver, dark mode, and an update from build 1. After the first launch has initialized data, repeat USDA Core search and historical logging in airplane mode. Record local FTS timings and require the target-device search to remain below 250 ms.
