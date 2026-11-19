import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The shape the source tree is held to. These read the imports as written,
// so a new dependency in the wrong direction fails here, at the file that
// introduced it.

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

/** The `@/…` modules a file imports, statically or lazily. */
function imports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [
    ...source.matchAll(/(?:from\s+|import\(\s*)['"]@\/([^'"]+)['"]/g),
  ].map((match) => match[1]);
}

/** The source file an import of the app's own code names, if it is one. */
function resolveSource(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith('@/')
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : undefined;
  if (!base) return undefined;
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ].find((file) => /\.tsx?$/.test(file) && existsSync(file));
}

/**
 * Every source file loaded when `entry` is: what it imports at top level,
 * and what those import. Types and `import()` calls load nothing then.
 */
function loadedWith(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(entry, 'utf8');
  const specifiers = [
    ...source.matchAll(
      /^(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
    ),
  ].map((match) => match[1]);
  for (const specifier of specifiers) {
    const file = resolveSource(entry, specifier);
    if (file) loadedWith(file, seen);
  }
  return seen;
}

const featureOf = (modulePath: string) =>
  /^features\/([^/]+)\//.exec(modulePath)?.[1];

const features = readdirSync(path.join(SRC, 'features'));

/** feature → the other features it imports, with one file that does. */
const dependencies = new Map<string, Map<string, string>>();
for (const feature of features) {
  const uses = new Map<string, string>();
  for (const file of sourceFiles(path.join(SRC, 'features', feature))) {
    for (const imported of imports(file)) {
      const other = featureOf(imported);
      if (other && other !== feature && !uses.has(other)) {
        uses.set(other, path.relative(SRC, file));
      }
    }
  }
  dependencies.set(feature, uses);
}

describe('the source tree', () => {
  it('keeps shared code free of features', () => {
    const offenders = sourceFiles(path.join(SRC, 'shared'))
      .filter((file) => imports(file).some((imported) => featureOf(imported)))
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('has no two features that depend on each other, directly or through others', () => {
    const cycles: string[] = [];
    const visit = (feature: string, trail: string[]) => {
      for (const next of dependencies.get(feature)?.keys() ?? []) {
        if (next === trail[0]) {
          cycles.push([...trail, next].join(' → '));
        } else if (!trail.includes(next)) {
          visit(next, [...trail, next]);
        }
      }
    };
    for (const feature of features) visit(feature, [feature]);
    expect(cycles).toEqual([]);
  });

  it('keeps what features share about a run below all of them', () => {
    // `runs` is what workflows, operations and the run history have in
    // common; it importing one of them is how their cycles began.
    expect([...(dependencies.get('runs') ?? new Map()).entries()]).toEqual([]);
  });

  it('keeps components out of the modules that talk to the server', () => {
    // A query returns what the server holds. One that imported a component
    // module was converting it into what a view draws, and caching that.
    const queryModules = sourceFiles(SRC).filter((file) =>
      /\/queries\//.test(file)
    );
    expect(queryModules.length).toBeGreaterThan(10);
    const offenders = queryModules
      .filter((file) =>
        imports(file).some((imported) => /(^|\/)components\//.test(imported))
      )
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('keeps an edition clear of the modules that read it while they load', () => {
    // The console reads the edition while it works out its own root
    // (shared/config/appBase), so an edition that imports appBase, or the
    // OIDC settings built on it, at top level would be read before it is
    // set (shared/edition/types.ts). Followed through what it imports.
    const editions = [
      path.join(SRC, 'edition/index.ts'),
      path.resolve(SRC, '../examples/edition/index.tsx'),
    ];
    const forbidden = ['shared/config/appBase', 'shared/config/oidcConfig'];

    for (const edition of editions) {
      const reached = loadedWith(edition);
      const offenders = [...reached]
        .map((file) => path.relative(SRC, file).replace(/\.tsx?$/, ''))
        .filter((file) => forbidden.includes(file));
      expect(offenders, path.relative(SRC, edition)).toEqual([]);
      expect(reached.size).toBeGreaterThan(0);
    }
  });

  it('explains every dependency override, and has none that does nothing', () => {
    const root = path.resolve(SRC, '..');
    const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
    const overrides = JSON.parse(read('package.json')).overrides as Record<
      string,
      string | Record<string, string>
    >;
    const installed = Object.keys(
      JSON.parse(read('package-lock.json')).packages as Record<string, unknown>
    );
    const explained = read('docs/dependency-overrides.md');

    // An override names a package, or a package inside one that asks for it.
    const names = Object.entries(overrides).flatMap(([name, value]) =>
      typeof value === 'string' ? [name] : Object.keys(value)
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(
        explained,
        `${name} is not in docs/dependency-overrides.md`
      ).toContain(`\`${name}\``);
      expect(
        installed.some((entry) => entry.endsWith(`node_modules/${name}`)),
        `the override of ${name} applies to nothing installed`
      ).toBe(true);
    }
  });

  it('does not import the app entry from anywhere but main', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => path.relative(SRC, file) !== 'main.tsx')
      .filter((file) =>
        imports(file).some((imported) => /^bootstrap(\.tsx)?$/.test(imported))
      )
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
