# MEAT development instructions

## Build approval gate

- Never run `eas build` or initiate an EAS Build through any workflow, agent, script, CI job, or external service without explicit user approval for that specific build.
- Approval does not carry forward to future builds.
- A native dependency change, Expo configuration change, QA need, issue completion, or release task is not implicit approval.
- Prefer Expo Go and non-EAS validation first.

## Engineering standards

- Treat AI-generated code exactly like production code: review architecture, correctness, security, privacy, accessibility, performance, and tests.
- Keep domain/business logic independent from React Native UI and Apple framework types.
- Nutrition arithmetic must be deterministic and testable.
- Capture trustworthy rich nutrient data while keeping the initial UI selective.
- Missing nutrient data is unknown, never automatically zero.
- Keep private tracking local-first; server dependencies must justify themselves.
- Use small, reviewable changes tied to Linear issues.
- Do not introduce secrets into source control.

## Expo / React Native

- Use Expo + React Native + TypeScript and Expo Router.
- Routes belong in `app/`; do not place reusable components, domain types, or utilities there.
- Use kebab-case filenames.
- Prefer native platform behavior and accessible controls.
- Configure path aliases and use them instead of deep relative imports.
- Do not introduce Tailwind/NativeWind unless a later explicit architecture decision approves it.
