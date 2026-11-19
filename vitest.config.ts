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
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      // The generated client is not ours to test.
      exclude: ['src/generated/**', '**/*.test.{ts,tsx}', 'src/test/**'],
      // A floor, just under what the suite covers today: a change that
      // lowers coverage fails, and the floor is raised as it grows.
      thresholds: {
        statements: 65,
        branches: 56,
        functions: 61,
        lines: 66,
      },
    },
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
