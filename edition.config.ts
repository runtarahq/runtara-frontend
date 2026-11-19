import path from 'path';
import type { Plugin } from 'vite';

// The console's edition (src/shared/edition/types.ts): this repository's by
// default, a distribution's module when RUNTARA_EDITION_DIR names one. The
// build (vite.config.ts) and the tests (vitest.config.ts) resolve it here, so
// an edition is found and built the same way by both.

/** The distribution's edition, or `undefined` for this repository's. */
export const editionDir = process.env.RUNTARA_EDITION_DIR
  ? path.resolve(process.env.RUNTARA_EDITION_DIR)
  : undefined;

/** What `@edition` and `@` stand for. */
export const editionAlias = {
  '@edition': editionDir ?? path.resolve(__dirname, './src/edition'),
  '@': path.resolve(__dirname, './src'),
};

/**
 * Resolves the packages an edition outside this directory imports (react,
 * lucide-react, ...) from this frontend, as if it sat in src: it has no
 * node_modules of its own, and it must share this build's one React.
 */
function editionPackages(dir: string): Plugin {
  const fromSrc = path.resolve(__dirname, 'src/main.tsx');
  return {
    name: 'runtara-edition-packages',
    enforce: 'pre',
    resolveId(source, importer, options) {
      const bare =
        !source.startsWith('.') &&
        !source.startsWith('/') &&
        !source.startsWith('\0') &&
        !source.startsWith('@/') &&
        source !== '@edition';
      if (!bare || !importer?.startsWith(dir + path.sep)) return null;
      return this.resolve(source, fromSrc, { ...options, skipSelf: true });
    },
  };
}

/** The plugins an edition outside this repository needs; none without one. */
export const editionPlugins: Plugin[] = editionDir
  ? [editionPackages(editionDir)]
  : [];
