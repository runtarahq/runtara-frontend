import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { editionAlias, editionDir, editionPlugins } from './edition.config';

// The example edition's contract tests need the example to be the edition, so
// they run only when it is (npm run test:edition).
const exampleEdition = path.resolve(__dirname, 'examples/edition');

export default defineConfig({
  plugins: [react(), ...editionPlugins],
  define: {
    'import.meta.env.VITE_RUNTARA_API_BASE_URL': JSON.stringify(
      'http://localhost:8080'
    ),
    'import.meta.env.VITE_RUNTARA_API_OBJECT_MODEL_BASE_URL': JSON.stringify(
      'http://localhost:8097'
    ),
    // runtimeConfig defaults authMode to 'oidc', so oidcConfig.ts throws at
    // module load unless all three of these are set. They come from an
    // untracked .env on a dev machine, so the suite passed locally and failed
    // in CI (NodeFormItem / StepPickerModal, which import it transitively).
    // Pin stubs here for the same reason the API URLs above are pinned: tests
    // must not depend on a developer's local environment. Nothing dials these
    // — no test invokes signinRedirect.
    'import.meta.env.VITE_OIDC_AUTHORITY': JSON.stringify(
      'https://oidc.test.invalid'
    ),
    'import.meta.env.VITE_OIDC_CLIENT_ID': JSON.stringify('runtara-test'),
    'import.meta.env.VITE_OIDC_AUDIENCE': JSON.stringify(
      'https://api.test.invalid'
    ),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Exclude e2e tests - those are run with Playwright, not Vitest
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/*.e2e.ts',
      '**/*.e2e.tsx',
      ...(editionDir === exampleEdition ? [] : ['examples/**']),
    ],
  },
  resolve: {
    alias: editionAlias,
  },
});
