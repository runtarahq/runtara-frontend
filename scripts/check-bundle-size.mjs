#!/usr/bin/env node
// Holds the console's first load to a budget, after `npm run build`.
//
// The first load is what every page fetches before it shows anything: the
// entry script, the app chunk it imports (`bootstrap-*`), and every chunk
// those import statically. A page's own code is fetched after, by its route.
//
// Two things are checked:
// - their JavaScript, gzipped, is within FIRST_LOAD_BUDGET_KB;
// - none of them is a chunk that belongs to the editor alone (the canvas
//   library, the validator): one of those in the first load means something
//   outside the editor started importing it.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const FIRST_LOAD_BUDGET_KB = 280;
const EDITOR_ONLY = [/^workflow-/, /^rust-validation-wasm-/];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'dist/assets');

const html = readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const entry = /src="\.\/assets\/([^"]+\.js)"/.exec(html)?.[1];
const app = readdirSync(assets).find((name) => /^bootstrap-.*\.js$/.test(name));
if (!entry || !app) {
  console.error('dist/ has no entry script or app chunk: run `npm run build`.');
  process.exit(1);
}

/** The chunks a chunk imports statically (`from"./x.js"`, `import"./x.js"`). */
function staticImports(name) {
  const source = readFileSync(path.join(assets, name), 'utf8');
  return [...source.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)].map(
    (match) => match[1]
  );
}

const firstLoad = new Set();
const queue = [entry, app];
while (queue.length > 0) {
  const name = queue.pop();
  if (firstLoad.has(name)) continue;
  firstLoad.add(name);
  queue.push(...staticImports(name));
}

let total = 0;
const rows = [...firstLoad]
  .map((name) => {
    const size = gzipSync(readFileSync(path.join(assets, name))).length;
    total += size;
    return [name, size];
  })
  .sort((a, b) => b[1] - a[1]);
for (const [name, size] of rows) {
  console.log(`${(size / 1024).toFixed(1).padStart(7)} kB  ${name}`);
}
const totalKb = total / 1024;
console.log(`${totalKb.toFixed(1).padStart(7)} kB  first load, gzipped`);

const strays = [...firstLoad].filter((name) =>
  EDITOR_ONLY.some((pattern) => pattern.test(name))
);
if (strays.length > 0) {
  console.error(
    `The first load includes what only the editor needs: ${strays.join(', ')}`
  );
  process.exit(1);
}
if (totalKb > FIRST_LOAD_BUDGET_KB) {
  console.error(
    `The first load is over its budget of ${FIRST_LOAD_BUDGET_KB} kB gzipped.`
  );
  process.exit(1);
}
