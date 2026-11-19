import { readdirSync, readFileSync, statSync } from 'node:fs';
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
