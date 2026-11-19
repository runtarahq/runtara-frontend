#!/usr/bin/env node
// Regenerate src/generated/RuntaraRuntimeApi.ts from the openapi.json of the
// runtara release this console builds against: the version of the
// runtara-validation-wasm package it depends on (see package.json), so the
// client and the validator always come from the same runtara release.
// RUNTARA_VERSION=<x.y.z> picks another release.
//
// With --check, nothing is written: the client is generated aside and compared
// with the one checked in, and a difference fails. That is how CI tells that
// the checked-in client is not the pinned release's.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinned = JSON.parse(
  readFileSync(
    path.join(root, 'node_modules/runtara-validation-wasm/package.json'),
    'utf8'
  )
).version;
const version = process.env.RUNTARA_VERSION || pinned;
const url = `https://github.com/runtarahq/runtara/releases/download/v${version}/openapi.json`;

const check = process.argv.includes('--check');
const generated = 'src/generated';
const name = 'RuntaraRuntimeApi.ts';

const response = await fetch(url);
if (!response.ok) {
  console.error(`${url}: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const scratch = mkdtempSync(path.join(tmpdir(), 'runtara-openapi-'));
const spec = path.join(scratch, 'openapi.json');
writeFileSync(spec, Buffer.from(await response.arrayBuffer()));
console.log(`openapi.json of runtara v${version}`);

const result = spawnSync(
  'npx',
  [
    'swagger-typescript-api',
    'generate',
    '--axios',
    '--generate-union-enums',
    '-p',
    spec,
    '-o',
    check ? scratch : generated,
    '-n',
    name,
  ],
  { cwd: root, stdio: 'inherit' }
);
if (result.status !== 0 || !check) process.exit(result.status ?? 1);

// `git diff --no-index` exits 1 when the two files differ, and prints how.
const diff = spawnSync(
  'git',
  [
    'diff',
    '--no-index',
    '--stat',
    '--patch',
    path.join(generated, name),
    path.join(scratch, name),
  ],
  { cwd: root, stdio: 'inherit' }
);
if (diff.status === 0) {
  console.log(`${generated}/${name} is the client of runtara v${version}`);
} else {
  console.error(
    `${generated}/${name} is not the client of runtara v${version}: ` +
      'regenerate it with `npm run generate-api-runtime-release`, or pin the ' +
      'runtara release it was generated from (runtara-validation-wasm in package.json).'
  );
}
process.exit(diff.status ?? 1);
