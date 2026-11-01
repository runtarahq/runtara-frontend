# Runtara Frontend Agent Guide

The Runtara console. The server, DSL and validator live in
[runtarahq/runtara](https://github.com/runtarahq/runtara); this repository
builds against a runtara release and never against its source.

- Feature code lives under `src/features`, shared code under `src/shared`.
- `src/generated/*.ts` is generated: regenerate with
  `npm run generate-api-runtime-release`, never by hand.
- The validation WASM is the `runtara-validation-wasm` dependency, a tarball
  from a runtara release. Change it by bumping its URL in `package.json`.
- A runtara distribution adds pages and controls through the `@edition` alias
  (`RUNTARA_EDITION_DIR`, see `src/shared/edition/types.ts`), never by patching
  this repository.
- Static hosting and runtime configuration: see `README.md`.
- Never read, print or commit credentials, `.env*` values or tokens.

## Verification

Run the narrowest relevant checks, then widen: `npm test`, `npm run lint`,
`npm run format:check`, `npx tsc -b`, `npm run knip`, `npm run build`, and
`npx playwright test --project=mocked` for UI flows. Do not claim checks that
were not run.
