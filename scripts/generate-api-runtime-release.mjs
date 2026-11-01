#!/usr/bin/env node
// Regenerate src/generated/RuntaraRuntimeApi.ts from the openapi.json of the
// runtara release this console builds against: the version of the
// runtara-validation-wasm package it depends on (see package.json), so the
// client and the validator always come from the same runtara release.
// RUNTARA_VERSION=<x.y.z> picks another release.

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

const response = await fetch(url);
if (!response.ok) {
  console.error(`${url}: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const spec = path.join(
  mkdtempSync(path.join(tmpdir(), 'runtara-openapi-')),
  'openapi.json'
);
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
    'src/generated',
    '-n',
    'RuntaraRuntimeApi.ts',
  ],
  { cwd: root, stdio: 'inherit' }
);
process.exit(result.status ?? 1);
